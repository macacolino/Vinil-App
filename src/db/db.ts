import Dexie, { type EntityTable } from 'dexie'
import type { Album, Artist, Copy, Setting } from './types'
import { IRON_MAIDEN_MBID } from '../seed/ironMaiden'
import { seedIronMaiden } from '../seed/seed'

/**
 * Banco local (IndexedDB). Cada tabela lista apenas os campos indexados;
 * os demais campos são gravados normalmente, sem índice.
 */
export class VinilDB extends Dexie {
  artists!: EntityTable<Artist, 'id'>
  albums!: EntityTable<Album, 'id'>
  copies!: EntityTable<Copy, 'id'>
  settings!: EntityTable<Setting, 'key'>

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
    // Roda só na primeira vez que o banco é criado neste navegador.
    this.on('populate', () => seedIronMaiden(this))
  }
}

export const db = new VinilDB()

/** Chaves usadas na tabela settings. */
export const SETTINGS = {
  usdToBrl: 'usdToBrl',
} as const

export const DEFAULT_USD_TO_BRL = 5.5
