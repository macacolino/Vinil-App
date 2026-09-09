import { db } from '../db/db'
import type { Album, Artist } from '../db/types'
import { coverArtUrl, countryName, fetchDiscography, fetchTracks, type MBArtist } from './musicbrainz'

/** Raridade padrão para álbuns importados (o usuário ajusta depois). */
export const DEFAULT_IMPORTED_RARITY = 2

export interface ImportResult {
  artistId: number
  added: number
  alreadyExisted: boolean
}

/**
 * Cria o artista e importa a discografia oficial do MusicBrainz.
 * Se o artista já existe (mesmo MBID), só completa os álbuns que faltam.
 */
export async function importArtistFromMusicBrainz(
  mb: MBArtist,
  onProgress?: (message: string) => void,
): Promise<ImportResult> {
  onProgress?.('Buscando discografia…')
  const groups = await fetchDiscography(mb.id, (loaded, total) => onProgress?.(`Buscando discografia… ${loaded} de ${total}`))

  onProgress?.(`Salvando ${groups.length} álbuns…`)
  return db.transaction('rw', db.artists, db.albums, async () => {
    const now = Date.now()
    let artist = await db.artists.where('mbid').equals(mb.id).first()
    const alreadyExisted = !!artist
    if (!artist) {
      const id = (await db.artists.add({
        name: mb.name,
        country: countryName(mb.country),
        countryCode: mb.country,
        mbid: mb.id,
        createdAt: now,
        updatedAt: now,
      })) as number
      artist = (await db.artists.get(id)) as Artist
    }
    const existing = await db.albums.where('artistId').equals(artist.id!).toArray()
    const knownMbids = new Set(existing.map((a) => a.mbid).filter(Boolean))
    const knownTitles = new Set(existing.map((a) => `${a.title.toLowerCase()}|${a.year}`))
    const fresh = groups.filter((g) => !knownMbids.has(g.id) && !knownTitles.has(`${g.title.toLowerCase()}|${g.year}`))
    if (fresh.length) {
      await db.albums.bulkAdd(
        fresh.map<Album>((g) => ({
          artistId: artist!.id!,
          title: g.title,
          year: g.year,
          type: g.type,
          coverUrl: coverArtUrl(g.id, 500),
          tracks: [],
          rarity: DEFAULT_IMPORTED_RARITY,
          status: 'none',
          mbid: g.id,
          createdAt: now,
          updatedAt: now,
        })),
      )
    }
    return { artistId: artist.id!, added: fresh.length, alreadyExisted }
  })
}

/**
 * Busca as faixas (e a gravadora, se estiver vazia) de um álbum importado
 * e grava no banco. Devolve quantas faixas foram gravadas.
 */
export async function loadAlbumTracks(album: Album, artistCountryCode?: string): Promise<number> {
  if (!album.mbid || !album.id) return 0
  const result = await fetchTracks(album.mbid, artistCountryCode)
  const patch: Partial<Album> = { tracksCheckedAt: Date.now(), updatedAt: Date.now() }
  if (result && result.tracks.length) patch.tracks = result.tracks
  if (result?.label && !album.label) patch.label = result.label
  await db.albums.update(album.id, patch)
  return result?.tracks.length ?? 0
}

/** Álbuns de um artista que ainda não têm faixas e ainda não foram consultados. */
export function needsTracks(album: Album): boolean {
  return !!album.mbid && album.tracks.length === 0 && !album.tracksCheckedAt
}
