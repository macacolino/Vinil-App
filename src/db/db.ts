import Dexie, { type EntityTable } from 'dexie'
import type { Album, Artist, Copy, Setting } from './types'
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
