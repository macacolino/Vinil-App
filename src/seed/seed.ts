import type { VinilDB } from '../db/db'
import type { Album, AlbumType, Track } from '../db/types'
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

/** Cria o Iron Maiden com a discografia completa. Roda no primeiro uso do app. */
export async function seedIronMaiden(db: VinilDB) {
  const now = Date.now()
  const artistId = (await db.artists.add({
    name: 'Iron Maiden',
    country: 'Reino Unido',
    mbid: IRON_MAIDEN_MBID,
    createdAt: now,
    updatedAt: now,
  })) as number
  await db.albums.bulkAdd(
    ironMaidenAlbums.map<Album>((a) => ({
      ...a,
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
        name: 'Iron Maiden',
        country: 'Reino Unido',
        mbid: IRON_MAIDEN_MBID,
        createdAt: now,
        updatedAt: now,
      })
      artist = { id, name: 'Iron Maiden', createdAt: now, updatedAt: now }
    }
    const existing = await db.albums.where('artistId').equals(artist.id!).toArray()
    const key = (title: string, year: number) => `${title.toLowerCase()}|${year}`
    const have = new Set(existing.map((a) => key(a.title, a.year)))
    const missing = ironMaidenAlbums.filter((a) => !have.has(key(a.title, a.year)))
    if (missing.length) {
      await db.albums.bulkAdd(
        missing.map<Album>((a) => ({
          ...a,
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
