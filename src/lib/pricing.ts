/**
 * Preço estimado e raridade automáticos, a partir do Discogs:
 *  1. MusicBrainz diz qual é o "master" do álbum no Discogs (ou busca por nome);
 *  2. entre as edições em vinil, usa a mais colecionada como referência;
 *  3. o menor anúncio em dólar vira o preço estimado, e a raridade sai de
 *     quantas pessoas têm o disco, quantos estão à venda e do preço.
 * Valores definidos à mão pelo usuário (priceSource/raritySource = manual)
 * nunca são sobrescritos.
 */
import { db } from '../db/db'
import type { Album } from '../db/types'
import { DiscogsError, fetchStats, fetchVinylVersions, searchMaster } from './discogs'
import { fetchDiscogsMasterId, type Priority } from './musicbrainz'

/** Reconsulta o Discogs depois deste tempo. */
export const PRICING_TTL_MS = 30 * 24 * 60 * 60 * 1000

export function needsPricing(album: Album): boolean {
  if (!album.mbid && !album.discogsMasterId) return false
  if (!album.discogsCheckedAt) return true
  return Date.now() - album.discogsCheckedAt > PRICING_TTL_MS
}

/** Raridade 1 (comum) a 5 (raríssimo) a partir dos números do Discogs. */
export function rarityFromDiscogs(inCollection: number, forSale: number, lowestUsd?: number): number {
  let byCollection = 5
  if (inCollection >= 3000) byCollection = 1
  else if (inCollection >= 800) byCollection = 2
  else if (inCollection >= 200) byCollection = 3
  else if (inCollection >= 40) byCollection = 4
  let byPrice = 1
  if (lowestUsd != null) {
    if (lowestUsd >= 300) byPrice = 5
    else if (lowestUsd >= 100) byPrice = 4
    else if (lowestUsd >= 50) byPrice = 3
  }
  let rarity = Math.max(byCollection, byPrice)
  if (forSale <= 2 && rarity < 5) rarity += 1
  return rarity
}

export interface PricingResult {
  found: boolean
  lowestUsd?: number
  forSale?: number
  inCollection?: number
}

/** Consulta o Discogs e grava preço/raridade no álbum. */
export async function updateAlbumPricing(album: Album, artistName: string, priority: Priority = 'high'): Promise<PricingResult> {
  if (!album.id) return { found: false }
  const now = Date.now()

  let masterId = album.discogsMasterId ?? null
  if (!masterId && album.mbid) {
    try {
      masterId = await fetchDiscogsMasterId(album.mbid, priority)
    } catch {
      masterId = null
    }
  }
  if (!masterId) {
    try {
      masterId = await searchMaster(artistName, album.title, priority)
    } catch (err) {
      if (!(err instanceof DiscogsError && err.kind === 'notfound')) throw err
    }
  }
  if (!masterId) {
    await db.albums.update(album.id, { discogsCheckedAt: now })
    return { found: false }
  }

  const versions = await fetchVinylVersions(masterId, priority)
  const ref = versions[0]
  if (!ref) {
    await db.albums.update(album.id, { discogsMasterId: masterId, discogsCheckedAt: now })
    return { found: false }
  }
  const stats = await fetchStats(ref.id, priority)

  const rarity = rarityFromDiscogs(ref.inCollection, stats.numForSale, stats.lowestUsd)
  const patch: Partial<Album> = {
    discogsMasterId: masterId,
    discogsReleaseId: ref.id,
    discogsInCollection: ref.inCollection,
    discogsForSale: stats.numForSale,
    discogsCheckedAt: now,
  }
  if (album.priceSource !== 'manual' && stats.lowestUsd != null) {
    patch.estimatedPriceUsd = Math.round(stats.lowestUsd * 100) / 100
    patch.priceSource = 'discogs'
  }
  if (album.raritySource !== 'manual') {
    patch.rarity = rarity
    patch.raritySource = 'discogs'
  }
  if (!album.coverUrl && ref.thumb) patch.coverUrl = ref.thumb
  await db.albums.update(album.id, patch)
  return { found: true, lowestUsd: stats.lowestUsd, forSale: stats.numForSale, inCollection: ref.inCollection }
}
