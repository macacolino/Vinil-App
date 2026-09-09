import { db } from '../db/db'
import type { Album, Artist } from '../db/types'
import {
  coverArtUrl,
  countryName,
  fetchDiscography,
  fetchTracks,
  fetchVinylReleaseGroups,
  type MBArtist,
  type Priority,
} from './musicbrainz'

/** Raridade padrão para álbuns importados (o usuário ajusta depois). */
export const DEFAULT_IMPORTED_RARITY = 2

/**
 * Cria o artista na hora (sem álbuns) para a tela dele abrir imediatamente.
 * Se já existe um artista com o mesmo MBID, devolve o id dele.
 */
export async function createArtistFromMusicBrainz(mb: MBArtist): Promise<{ artistId: number; alreadyExisted: boolean }> {
  const existing = await db.artists.where('mbid').equals(mb.id).first()
  if (existing) return { artistId: existing.id!, alreadyExisted: true }
  const now = Date.now()
  const id = (await db.artists.add({
    name: mb.name,
    country: countryName(mb.country),
    countryCode: mb.country,
    mbid: mb.id,
    createdAt: now,
    updatedAt: now,
  })) as number
  return { artistId: id, alreadyExisted: false }
}

export interface DiscographyResult {
  added: number
  removed: number
  total: number
  /** true quando o MusicBrainz não tinha edições em vinil catalogadas e a lista completa foi usada. */
  usedFallback: boolean
}

/**
 * Importa (ou revisa) a discografia de um artista já criado.
 * Regra: só entram lançamentos oficiais que saíram em vinil. Com `prune`,
 * remove álbuns importados antes que não passam mais no filtro, desde que
 * o usuário não os tenha marcado como "tenho"/"quero".
 */
export async function importDiscography(
  artistId: number,
  opts: { prune?: boolean; priority?: Priority; onProgress?: (message: string) => void } = {},
): Promise<DiscographyResult> {
  const { prune = false, priority = 'high', onProgress } = opts
  const artist = await db.artists.get(artistId)
  if (!artist?.mbid) throw new Error('Este artista não veio do MusicBrainz.')

  onProgress?.('Lendo lançamentos…')
  const groups = await fetchDiscography(artist.mbid, (l, t) => onProgress?.(`Lendo lançamentos… ${l} de ${t}`), priority)
  onProgress?.('Conferindo edições em vinil…')
  const vinyl = await fetchVinylReleaseGroups(artist.mbid, (l, t) => onProgress?.(`Conferindo edições em vinil… ${l} de ${t}`), priority)

  const usedFallback = vinyl.size === 0
  const kept = usedFallback
    ? groups.filter((g) => !/^\d{4}-\d{2}-\d{2}/.test(g.title)) // sem dados de formato: tira ao menos os shows datados
    : groups.filter((g) => vinyl.has(g.id))

  return db.transaction('rw', db.artists, db.albums, db.copies, async () => {
    const now = Date.now()
    await db.artists.update(artistId, { discographyReviewedAt: now, updatedAt: now })
    const existing = await db.albums.where('artistId').equals(artistId).toArray()
    const knownMbids = new Set(existing.map((a) => a.mbid).filter(Boolean))
    const knownTitles = new Set(existing.map((a) => `${a.title.toLowerCase()}|${a.year}`))
    const fresh = kept.filter((g) => !knownMbids.has(g.id) && !knownTitles.has(`${g.title.toLowerCase()}|${g.year}`))
    if (fresh.length) {
      await db.albums.bulkAdd(
        fresh.map<Album>((g) => {
          const v = vinyl.get(g.id)
          const year = g.year || Number.parseInt((v?.earliestDate ?? '').slice(0, 4), 10) || 0
          return {
            artistId,
            title: g.title,
            year,
            type: g.type,
            label: v?.label,
            coverUrl: coverArtUrl(g.id, 500),
            tracks: [],
            rarity: DEFAULT_IMPORTED_RARITY,
            status: 'none',
            mbid: g.id,
            createdAt: now,
            updatedAt: now,
          }
        }),
      )
    }

    let removed = 0
    if (prune) {
      const keptIds = new Set(kept.map((g) => g.id))
      const copies = new Set((await db.copies.toArray()).map((c) => c.albumId))
      const toRemove = existing.filter((a) => a.mbid && !keptIds.has(a.mbid) && a.status === 'none' && !copies.has(a.id!))
      if (toRemove.length) {
        await db.albums.bulkDelete(toRemove.map((a) => a.id!))
        removed = toRemove.length
      }
    }
    const total = await db.albums.where('artistId').equals(artistId).count()
    return { added: fresh.length, removed, total, usedFallback }
  })
}

/**
 * Busca as faixas (e a gravadora, se estiver vazia) de um álbum importado
 * e grava no banco. Devolve quantas faixas foram gravadas.
 */
export async function loadAlbumTracks(album: Album, artistCountryCode?: string, priority: Priority = 'high'): Promise<number> {
  if (!album.mbid || !album.id) return 0
  const result = await fetchTracks(album.mbid, artistCountryCode, priority)
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

/** Artista importado que ainda não tem nenhum álbum (importação interrompida). */
export function needsDiscography(artist: Artist, albumCount: number): boolean {
  return !!artist.mbid && albumCount === 0
}
