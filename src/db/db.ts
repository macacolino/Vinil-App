import Dexie, { type EntityTable, type Transaction } from 'dexie'
import type { Album, Artist, Copy, Setting, Tombstone } from './types'
import { albumUid, artistUid, copyUid } from './uid'
import { IRON_MAIDEN_MBID } from '../seed/ironMaiden'
import { SEED_TIMESTAMP, seedIronMaiden } from '../seed/seed'

/**
 * Banco local (IndexedDB). Cada tabela lista apenas os campos indexados;
 * os demais campos são gravados normalmente, sem índice.
 */
export class VinilDB extends Dexie {
  artists!: EntityTable<Artist, 'id'>
  albums!: EntityTable<Album, 'id'>
  copies!: EntityTable<Copy, 'id'>
  settings!: EntityTable<Setting, 'key'>
  tombstones!: EntityTable<Tombstone, 'uid'>

  constructor() {
    super('vinil')
    this.version(1).stores({
      artists: '++id, name',
      albums: '++id, artistId, status, year, title, [artistId+year]',
      copies: '++id, &albumId',
      settings: 'key',
    })
    // v2: índices para o MBID (importação do MusicBrainz) e raridade.
    this.version(2).stores({
      artists: '++id, name, mbid',
      albums: '++id, artistId, status, year, title, rarity, mbid, [artistId+year]',
    })
    // v3: marca o Iron Maiden (lista curada) como já revisado, para a revisão
    // automática de discografias só rodar nos artistas importados.
    this.version(3)
      .stores({})
      .upgrade((tx) =>
        tx
          .table('artists')
          .toCollection()
          .modify((a: Artist) => {
            if (a.mbid === IRON_MAIDEN_MBID && !a.discographyReviewedAt) a.discographyReviewedAt = Date.now()
          }),
      )
    // v4: uid global + flag dirty em tudo, e tabela de exclusões (sincronização).
    this.version(4)
      .stores({
        artists: '++id, name, mbid, &uid, dirty',
        albums: '++id, artistId, status, year, title, rarity, mbid, &uid, dirty, [artistId+year]',
        copies: '++id, &albumId, &uid, dirty',
        settings: 'key, dirty',
        tombstones: 'uid',
      })
      .upgrade(async (tx) => {
        const artists = tx.table<Artist>('artists')
        const albums = tx.table<Album>('albums')
        const copies = tx.table<Copy>('copies')
        // Dados pré-carregados que o usuário nunca mexeu recebem a data fixa
        // do seed e dirty = 0 (todo aparelho já tem a mesma lista). O resto
        // é marcado para envio à nuvem.
        const artistUidById = new Map<number, string>()
        let seedArtistId: number | undefined
        await artists.toCollection().modify((a: Artist) => {
          a.uid = artistUid(a)
          const isSeed = a.mbid === IRON_MAIDEN_MBID
          if (isSeed) seedArtistId = a.id
          const untouched = isSeed && a.updatedAt === a.createdAt
          a.dirty = untouched ? 0 : 1
          if (untouched) a.updatedAt = SEED_TIMESTAMP
          artistUidById.set(a.id!, a.uid)
        })
        const albumUidById = new Map<number, string>()
        await albums.toCollection().modify((al: Album) => {
          al.uid = albumUid(al, artistUidById.get(al.artistId) ?? 'n-')
          const untouched = al.artistId === seedArtistId && al.updatedAt === al.createdAt && al.status === 'none'
          al.dirty = untouched ? 0 : 1
          if (untouched) al.updatedAt = SEED_TIMESTAMP
          albumUidById.set(al.id!, al.uid)
        })
        await copies.toCollection().modify((c: Copy) => {
          c.uid = copyUid(albumUidById.get(c.albumId) ?? 'a-')
          c.dirty = 1
        })
        await tx.table<Setting>('settings').toCollection().modify((st: Setting) => {
          st.dirty = 1
          st.updatedAt = st.updatedAt ?? Date.now()
        })
      })

    // Toda gravação feita pelo app marca dirty=1 e atualiza updatedAt. A
    // sincronização desliga isso marcando a transação com fromSync = true.
    this.use({
      stack: 'dbcore',
      name: 'marcaAlteracoes',
      create: (down) => ({
        ...down,
        table: (name) => {
          const table = down.table(name)
          if (name === 'tombstones') return table
          return {
            ...table,
            mutate: (req) => {
              const tx = Dexie.currentTransaction as (Transaction & { fromSync?: boolean }) | null
              if (!tx?.fromSync && (req.type === 'add' || req.type === 'put')) {
                const now = Date.now()
                for (const v of req.values as Record<string, unknown>[]) {
                  v.dirty = 1
                  v.updatedAt = now
                }
                notifyLocalChange()
              }
              return table.mutate(req)
            },
          }
        },
      }),
    })

    // Roda só na primeira vez que o banco é criado neste navegador.
    this.on('populate', () => seedIronMaiden(this))
  }
}

type ChangeListener = () => void
const changeListeners = new Set<ChangeListener>()

/** Avisa quem quiser saber (a sincronização) que algo mudou localmente. */
export function onLocalChange(listener: ChangeListener): () => void {
  changeListeners.add(listener)
  return () => changeListeners.delete(listener)
}

function notifyLocalChange() {
  changeListeners.forEach((l) => l())
}

/**
 * Executa uma transação marcada como "vinda da sincronização": as gravações
 * não recebem dirty=1 nem updatedAt novo.
 */
export function syncTransaction<T>(tables: Dexie.Table[], fn: () => Promise<T>): Promise<T> {
  return db.transaction('rw', tables, async () => {
    ;(Dexie.currentTransaction as Transaction & { fromSync?: boolean }).fromSync = true
    return fn()
  })
}

export const db = new VinilDB()

/** Chaves usadas na tabela settings. */
export const SETTINGS = {
  usdToBrl: 'usdToBrl',
} as const

export const DEFAULT_USD_TO_BRL = 5.5
