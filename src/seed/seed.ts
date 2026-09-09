import Dexie, { type Transaction } from 'dexie'
import type { VinilDB } from '../db/db'
import type { Album, AlbumType, Track } from '../db/types'
import { albumUid, artistUid } from '../db/uid'
import { IRON_MAIDEN_MBID, ironMaidenAlbums } from './ironMaiden'

export interface SeedAlbum {
  title: string
  year: number
  type: AlbumType
  label?: string
  rarity: number
  estimatedPriceUsd?: number
  mbid?: string
  coverUrl?: string
  tracks: Track[]
}

/**
 * Data fixa e antiga para os dados pré-carregados: assim qualquer edição
 * feita pelo usuário (em qualquer aparelho) é mais nova e ganha na
 * sincronização. Os registros nascem com dirty = 0: não vão para a nuvem
 * enquanto o usuário não mexer neles, já que todo aparelho tem a mesma lista.
 */
export const SEED_TIMESTAMP = Date.UTC(2024, 0, 1)

/** Cria o Iron Maiden com a discografia completa. Roda no primeiro uso do app. */
export async function seedIronMaiden(db: VinilDB) {
  const now = SEED_TIMESTAMP
  const tx = Dexie.currentTransaction as (Transaction & { fromSync?: boolean }) | null
  if (tx) tx.fromSync = true // não marcar dirty nem trocar a data
  const uid = artistUid({ mbid: IRON_MAIDEN_MBID, name: 'Iron Maiden' })
  const artistId = (await db.artists.add({
    uid,
    dirty: 0,
    name: 'Iron Maiden',
    country: 'Reino Unido',
    mbid: IRON_MAIDEN_MBID,
    discographyReviewedAt: now, // lista curada à mão; não passa pela revisão automática
    createdAt: now,
    updatedAt: now,
  })) as number
  await db.albums.bulkAdd(
    ironMaidenAlbums.map<Album>((a) => ({
      ...a,
      uid: albumUid(a, uid),
      dirty: 0,
      artistId,
      status: 'none',
      createdAt: now,
      updatedAt: now,
    })),
  )
}

/**
 * Recoloca os álbuns do Iron Maiden que estiverem faltando (por título + ano),
 * sem mexer nos que já existem. Usado no botão de Configurações.
 * Devolve quantos álbuns foram adicionados.
 */
export async function restoreIronMaiden(db: VinilDB): Promise<number> {
  return db.transaction('rw', db.artists, db.albums, async () => {
    const now = Date.now()
    let artist = await db.artists.where('name').equalsIgnoreCase('Iron Maiden').first()
    if (!artist) {
      const id = await db.artists.add({
        uid: artistUid({ mbid: IRON_MAIDEN_MBID, name: 'Iron Maiden' }),
        name: 'Iron Maiden',
        country: 'Reino Unido',
        mbid: IRON_MAIDEN_MBID,
        discographyReviewedAt: now,
        createdAt: now,
        updatedAt: now,
      })
      artist = { id, uid: artistUid({ mbid: IRON_MAIDEN_MBID, name: 'Iron Maiden' }), name: 'Iron Maiden', createdAt: now, updatedAt: now }
    }
    const existing = await db.albums.where('artistId').equals(artist.id!).toArray()
    const key = (title: string, year: number) => `${title.toLowerCase()}|${year}`
    const have = new Set(existing.map((a) => key(a.title, a.year)))
    const missing = ironMaidenAlbums.filter((a) => !have.has(key(a.title, a.year)))
    if (missing.length) {
      await db.albums.bulkAdd(
        missing.map<Album>((a) => ({
          ...a,
          uid: albumUid(a, artist!.uid),
          artistId: artist!.id!,
          status: 'none',
          createdAt: now,
          updatedAt: now,
        })),
      )
    }
    return missing.length
  })
}
