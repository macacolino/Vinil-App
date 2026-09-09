/**
 * Preço estimado e raridade automáticos, a partir do Discogs:
 *  1. acha o "master" do álbum: busca no Discogs por artista + título e fica
 *     com o mais colecionado (o link do MusicBrainz serve de reserva, porque
 *     às vezes aponta para uma página secundária, como aconteceu com Killers);
 *  2. entre as edições em vinil, usa a mais colecionada como referência,
 *     pulando edições bloqueadas para venda;
 *  3. o menor anúncio em dólar vira o preço estimado, e a raridade sai de
 *     quantas pessoas têm o disco, quantos estão à venda e do preço.
 * Valores definidos à mão pelo usuário (priceSource/raritySource = manual)
 * nunca são sobrescritos.
 */
import { db } from '../db/db'
import type { Album, Artist } from '../db/types'
import { DiscogsError, fetchArtistImage, fetchReleaseImage, fetchStats, fetchVinylVersions, searchArtist, searchMasters, type MasterCandidate } from './discogs'
import { fetchArtistDiscogsId, fetchDiscogsMasterId, type Priority } from './musicbrainz'

/** Reconsulta o Discogs depois deste tempo. */
export const PRICING_TTL_MS = 30 * 24 * 60 * 60 * 1000
/** Muda quando a regra de escolha/raridade muda, para reconsultar tudo uma vez. */
export const PRICING_ALGO = 2

export function needsPricing(album: Album): boolean {
  if (!album.mbid && !album.discogsMasterId) return false
  if (!album.discogsCheckedAt || album.discogsAlgo !== PRICING_ALGO) return true
  return Date.now() - album.discogsCheckedAt > PRICING_TTL_MS
}

/** Já tem edição de referência no Discogs, mas ainda não buscou a capa grande dela. */
export function needsCover(album: Album): boolean {
  return !!album.discogsReleaseId && !album.discogsCoverUrl && !album.discogsCoverCheckedAt
}

/** Busca a capa grande (600 px) da edição de referência e grava. */
export async function updateAlbumCover(album: Album, priority: Priority = 'high'): Promise<string | null> {
  if (!album.id || !album.discogsReleaseId) return null
  if (import.meta.env.VITE_TEST_HOOKS === '1') console.debug('[pricing] updateAlbumCover', album.title, album.discogsReleaseId, priority)
  let url: string | null = null
  try {
    url = await fetchReleaseImage(album.discogsReleaseId, priority)
  } catch (err) {
    if (!(err instanceof DiscogsError && err.kind === 'notfound')) throw err
  }
  const patch: Partial<Album> = { discogsCoverCheckedAt: Date.now() }
  if (url) {
    patch.discogsCoverUrl = url
    // Sem capa nenhuma (ou só a miniatura): a do Discogs vira a principal.
    if (!album.coverUrl || album.coverUrl === album.discogsThumb) patch.coverUrl = url
  }
  await db.albums.update(album.id, patch)
  return url
}

export function needsArtistImage(artist: Artist): boolean {
  if (artist.imageSource === 'manual') return false
  if (artist.imageUrl) return false
  if (!artist.imageCheckedAt) return true
  return Date.now() - artist.imageCheckedAt > PRICING_TTL_MS
}

/** Raridade 1 (comum) a 5 (raríssimo) a partir dos números do Discogs. */
export function rarityFromDiscogs(inCollection: number, forSale: number | null, lowestUsd?: number): number {
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
  // Só penaliza "quase nada à venda" quando a edição pode ser vendida.
  if (forSale != null && forSale <= 2 && rarity < 5) rarity += 1
  return rarity
}

const norm = (t: string) =>
  t
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\(.*?\)|\[.*?\]/g, '')
    .replace(/[^a-z0-9]/g, '')

/**
 * Escolhe, entre os candidatos da busca, o master oficial mais colecionado
 * cujo título bate com "Artista - Título". Sem título igual, devolve null:
 * é melhor não ter preço do que pegar o disco errado (a busca por
 * "The Soundhouse Tapes" devolve também Killers e outros).
 */
export function pickMaster(candidates: MasterCandidate[], artistName: string, title: string): MasterCandidate | null {
  const wanted = norm(`${artistName}${title}`)
  const wantedTitle = norm(title)
  const matching = candidates.filter((c) => {
    if (c.unofficial) return false
    const full = norm(c.title)
    const afterDash = c.title.includes(' - ') ? norm(c.title.slice(c.title.indexOf(' - ') + 3)) : full
    return full === wanted || afterDash === wantedTitle
  })
  if (!matching.length) return null
  return [...matching].sort((a, b) => b.have - a.have)[0]
}

export interface PricingResult {
  found: boolean
  lowestUsd?: number
  forSale?: number
  inCollection?: number
}

/** Consultas em andamento por álbum: a tela do álbum e a tarefa em segundo plano não repetem o trabalho. */
const inFlight = new Map<number, Promise<PricingResult>>()

/** Consulta o Discogs e grava preço/raridade no álbum. */
export function updateAlbumPricing(album: Album, artistName: string, priority: Priority = 'high'): Promise<PricingResult> {
  if (!album.id) return Promise.resolve({ found: false })
  const running = inFlight.get(album.id)
  if (running) return running
  const p = doUpdateAlbumPricing(album, artistName, priority).finally(() => inFlight.delete(album.id!))
  inFlight.set(album.id, p)
  return p
}

async function doUpdateAlbumPricing(album: Album, artistName: string, priority: Priority): Promise<PricingResult> {
  const now = Date.now()

  // 1) master: busca do Discogs primeiro; link do MusicBrainz como reserva.
  let masterId: number | null = null
  try {
    masterId = pickMaster(await searchMasters(artistName, album.title, priority), artistName, album.title)?.masterId ?? null
  } catch (err) {
    if (!(err instanceof DiscogsError && err.kind === 'notfound')) throw err
  }
  if (!masterId && album.mbid) {
    try {
      masterId = await fetchDiscogsMasterId(album.mbid, priority)
    } catch {
      masterId = null
    }
  }
  if (!masterId) masterId = album.discogsMasterId ?? null
  if (!masterId) {
    await db.albums.update(album.id, { discogsCheckedAt: now, discogsAlgo: PRICING_ALGO })
    return { found: false }
  }

  // 2) edição de referência: a mais colecionada em vinil que possa ser vendida.
  const versions = await fetchVinylVersions(masterId, priority)
  if (!versions.length) {
    await db.albums.update(album.id, { discogsMasterId: masterId, discogsCheckedAt: now, discogsAlgo: PRICING_ALGO })
    return { found: false }
  }
  let ref = versions[0]
  let stats = await fetchStats(ref.id, priority)
  for (let i = 1; stats.blocked && i < Math.min(versions.length, 4); i++) {
    const alt = versions[i]
    const altStats = await fetchStats(alt.id, priority)
    if (!altStats.blocked) {
      ref = alt
      stats = altStats
      break
    }
  }

  // 3) preço e raridade
  const rarity = rarityFromDiscogs(ref.inCollection, stats.blocked ? null : stats.numForSale, stats.lowestUsd)
  const patch: Partial<Album> = {
    discogsMasterId: masterId,
    discogsReleaseId: ref.id,
    discogsInCollection: ref.inCollection,
    discogsForSale: stats.numForSale,
    discogsBlocked: stats.blocked,
    discogsThumb: ref.thumb || undefined,
    discogsCheckedAt: now,
    discogsAlgo: PRICING_ALGO,
  }
  if (album.priceSource !== 'manual' && stats.lowestUsd != null) {
    patch.estimatedPriceUsd = Math.round(stats.lowestUsd * 100) / 100
    patch.priceSource = 'discogs'
  }
  if (album.raritySource !== 'manual') {
    patch.rarity = rarity
    patch.raritySource = 'discogs'
  }
  // Edição de referência mudou: a capa grande precisa ser buscada de novo.
  if (album.discogsReleaseId !== ref.id) {
    patch.discogsCoverUrl = undefined
    patch.discogsCoverCheckedAt = undefined
  }
  if (!album.coverUrl && ref.thumb) patch.coverUrl = ref.thumb
  await db.albums.update(album.id, patch)
  return { found: true, lowestUsd: stats.lowestUsd, forSale: stats.numForSale, inCollection: ref.inCollection }
}

/** Busca a foto do artista no Discogs (via link do MusicBrainz ou busca por nome) e grava. */
export async function updateArtistImage(artist: Artist, priority: Priority = 'high'): Promise<boolean> {
  if (!artist.id) return false
  const now = Date.now()
  let discogsId = artist.discogsId ?? null
  if (!discogsId && artist.mbid) {
    try {
      discogsId = await fetchArtistDiscogsId(artist.mbid, priority)
    } catch {
      discogsId = null
    }
  }
  if (!discogsId) {
    try {
      discogsId = await searchArtist(artist.name, priority)
    } catch (err) {
      if (!(err instanceof DiscogsError && err.kind === 'notfound')) throw err
    }
  }
  if (!discogsId) {
    await db.artists.update(artist.id, { imageCheckedAt: now })
    return false
  }
  let url: string | null = null
  try {
    url = await fetchArtistImage(discogsId, priority)
  } catch (err) {
    if (!(err instanceof DiscogsError && err.kind === 'notfound')) throw err
  }
  await db.artists.update(artist.id, {
    discogsId,
    imageCheckedAt: now,
    ...(url ? { imageUrl: url, imageSource: 'discogs' as const } : {}),
  })
  return !!url
}
