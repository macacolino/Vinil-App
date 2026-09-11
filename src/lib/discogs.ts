/**
 * Cliente mínimo do Discogs (https://www.discogs.com/developers), sem chave:
 * o limite é 25 requisições por minuto por IP, então há fila com espaçamento
 * e espera quando o servidor responde 429.
 */
import type { Priority } from './musicbrainz'

const BASE = 'https://api.discogs.com'
const MIN_INTERVAL_MS = 2600 // ~23 por minuto, com folga
const isStaticDemo = import.meta.env.VITE_STATIC_DEMO === '1'

export class DiscogsError extends Error {
  constructor(
    message: string,
    public readonly kind: 'offline' | 'busy' | 'http' | 'demo' | 'notfound',
  ) {
    super(message)
  }
}

interface Pending {
  priority: Priority
  run: () => Promise<void>
}

let lastRequestAt = 0
let draining = false
const pending: Pending[] = []
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const dbg = (...a: unknown[]) => {
  if (import.meta.env.VITE_TEST_HOOKS === '1') console.debug('[discogs]', ...a)
}

async function drain() {
  if (draining) return
  draining = true
  try {
    while (pending.length) {
      const idx = pending.findIndex((p) => p.priority === 'high')
      const next = pending.splice(idx >= 0 ? idx : 0, 1)[0]
      const wait = lastRequestAt + MIN_INTERVAL_MS - Date.now()
      dbg('drain: próximo', next.priority, 'espera', wait, 'restam', pending.length)
      if (wait > 0) await sleep(wait)
      dbg('drain: acordou', next.priority)
      lastRequestAt = Date.now()
      await next.run()
      dbg('drain: concluído', next.priority)
    }
  } finally {
    draining = false
    dbg('drain: fim')
  }
}

function scheduled<T>(priority: Priority, fn: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    pending.push({ priority, run: () => fn().then(resolve, reject) })
    dbg('scheduled', priority, 'pendentes', pending.length, 'draining', draining)
    void drain()
  })
}

async function dgGet<T>(path: string, params: Record<string, string> = {}, priority: Priority = 'high'): Promise<T> {
  if (isStaticDemo) throw new DiscogsError('Nesta prévia o app não tem acesso à internet.', 'demo')
  const url = new URL(`${BASE}/${path}`)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  let lastError: unknown
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) await sleep(4000 * attempt)
    try {
      const res = await scheduled(priority, () => fetch(url.toString(), { headers: { Accept: 'application/vnd.discogs.v2.discogs+json' } }))
      if (res.status === 429) {
        const retry = Number(res.headers.get('Retry-After')) || 30
        await sleep(retry * 1000)
        lastError = new DiscogsError('O Discogs pediu para esperar (limite de consultas).', 'busy')
        continue
      }
      if (res.status === 404) throw new DiscogsError('Não encontrado no Discogs.', 'notfound')
      if (!res.ok) throw new DiscogsError(`Erro ${res.status} ao consultar o Discogs.`, 'http')
      return (await res.json()) as T
    } catch (err) {
      if (err instanceof DiscogsError && err.kind !== 'busy') throw err
      lastError = err instanceof DiscogsError ? err : new DiscogsError('Sem conexão com o Discogs.', 'offline')
    }
  }
  throw lastError
}

export interface DiscogsVersion {
  id: number
  title: string
  country?: string
  released?: string
  label?: string
  format?: string
  thumb?: string
  inCollection: number
  inWantlist: number
}

interface VersionsResponse {
  versions: {
    id: number
    title: string
    country?: string
    released?: string
    label?: string
    format?: string
    thumb?: string
    major_formats?: string[]
    stats?: { community?: { in_collection?: number; in_wantlist?: number } }
  }[]
}

/** Edições em vinil de um "master" do Discogs, da mais colecionada para a menos. */
export async function fetchVinylVersions(masterId: number, priority: Priority = 'high'): Promise<DiscogsVersion[]> {
  const data = await dgGet<VersionsResponse>(`masters/${masterId}/versions`, { format: 'Vinyl', per_page: '100', page: '1' }, priority)
  return data.versions
    .filter((v) => (v.major_formats ?? []).includes('Vinyl') || /vinyl|lp/i.test(v.format ?? ''))
    .map((v) => ({
      id: v.id,
      title: v.title,
      country: v.country,
      released: v.released,
      label: v.label,
      format: v.format,
      thumb: v.thumb,
      inCollection: v.stats?.community?.in_collection ?? 0,
      inWantlist: v.stats?.community?.in_wantlist ?? 0,
    }))
    .sort((a, b) => b.inCollection - a.inCollection)
}

export interface DiscogsStats {
  numForSale: number
  lowestUsd?: number
  blocked: boolean
}

/** Quantos anúncios e o menor preço (em dólar) de uma edição específica. */
export async function fetchStats(releaseId: number, priority: Priority = 'high'): Promise<DiscogsStats> {
  const data = await dgGet<{ num_for_sale?: number; lowest_price?: { value?: number; currency?: string } | null; blocked_from_sale?: boolean }>(
    `marketplace/stats/${releaseId}`,
    { curr_abbr: 'USD' },
    priority,
  )
  return { numForSale: data.num_for_sale ?? 0, lowestUsd: data.lowest_price?.value ?? undefined, blocked: !!data.blocked_from_sale }
}

export interface MasterCandidate {
  masterId: number
  /** Título como o Discogs mostra: "Artista - Título". */
  title: string
  year?: number
  have: number
  want: number
  unofficial: boolean
  /** Descrições de formato do resultado (ex.: "Album", "Live", "Compilation"). */
  formats: string[]
  thumb?: string
  coverImage?: string
}

/**
 * Candidatos a "master" de um álbum na busca do Discogs, com quantas pessoas
 * têm cada um. Sem filtro de formato de propósito: com format=Vinyl a busca
 * deixava de fora o álbum de estúdio "Fear of the Dark" (que tem vinil); a
 * checagem de vinil é feita depois, pelas edições do master.
 */
export async function searchMasters(artist: string, title: string, priority: Priority = 'high'): Promise<MasterCandidate[]> {
  const data = await dgGet<{
    results?: {
      master_id?: number
      title?: string
      year?: string
      format?: string[]
      community?: { have?: number; want?: number }
      thumb?: string
      cover_image?: string
    }[]
  }>('database/search', { type: 'master', artist, release_title: title, per_page: '15' }, priority)
  const seen = new Set<number>()
  const out: MasterCandidate[] = []
  for (const r of data.results ?? []) {
    if (!r.master_id || seen.has(r.master_id)) continue
    seen.add(r.master_id)
    out.push({
      masterId: r.master_id,
      title: r.title ?? '',
      year: r.year ? Number.parseInt(r.year, 10) || undefined : undefined,
      have: r.community?.have ?? 0,
      want: r.community?.want ?? 0,
      unofficial: (r.format ?? []).some((f) => /unofficial/i.test(f)),
      formats: r.format ?? [],
      thumb: r.thumb || undefined,
      coverImage: r.cover_image || undefined,
    })
  }
  return out
}

export interface MasterDetails {
  masterId: number
  title: string
  year?: number
  coverUrl?: string
  tracks: { position: string; title: string; durationMs?: number }[]
}

/** Detalhes de um master: título, ano, capa e faixas. */
export async function fetchMasterDetails(masterId: number, priority: Priority = 'high'): Promise<MasterDetails> {
  const d = await dgGet<{
    title?: string
    year?: number
    images?: { type?: string; uri?: string }[]
    tracklist?: { position?: string; type_?: string; title?: string; duration?: string }[]
  }>(`masters/${masterId}`, {}, priority)
  const primary = d.images?.find((i) => i.type === 'primary') ?? d.images?.[0]
  const tracks = (d.tracklist ?? [])
    .filter((t) => (t.type_ ?? 'track') === 'track' && t.title)
    .map((t, i) => {
      const m = t.duration?.match(/^(\d+):(\d{2})$/)
      return {
        position: t.position || String(i + 1),
        title: t.title!,
        durationMs: m ? (Number(m[1]) * 60 + Number(m[2])) * 1000 : undefined,
      }
    })
  return { masterId, title: d.title ?? '', year: d.year || undefined, coverUrl: primary?.uri, tracks }
}

/** Id do artista no Discogs pela busca por nome. */
export async function searchArtist(name: string, priority: Priority = 'high'): Promise<number | null> {
  const data = await dgGet<{ results?: { id?: number; title?: string }[] }>('database/search', { type: 'artist', q: name, per_page: '5' }, priority)
  const norm = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '')
  const exact = data.results?.find((r) => r.id && r.title && norm(r.title) === norm(name))
  return (exact ?? data.results?.find((r) => r.id))?.id ?? null
}

/** Foto principal do artista no Discogs (URL de ~600 px), ou null. */
export async function fetchArtistImage(discogsArtistId: number, priority: Priority = 'high'): Promise<string | null> {
  const data = await dgGet<{ images?: { type?: string; uri?: string; uri150?: string }[] }>(`artists/${discogsArtistId}`, {}, priority)
  const images = data.images ?? []
  const primary = images.find((i) => i.type === 'primary') ?? images[0]
  return primary?.uri ?? primary?.uri150 ?? null
}

/** Capa principal de uma edição no Discogs (até 600 px), ou null. */
export async function fetchReleaseImage(releaseId: number, priority: Priority = 'high'): Promise<string | null> {
  const data = await dgGet<{ images?: { type?: string; uri?: string; width?: number }[] }>(`releases/${releaseId}`, {}, priority)
  const images = data.images ?? []
  const primary = images.find((i) => i.type === 'primary') ?? images[0]
  return primary?.uri ?? null
}

export function masterUrl(masterId: number): string {
  return `https://www.discogs.com/master/${masterId}`
}

export function releaseUrl(releaseId: number): string {
  return `https://www.discogs.com/release/${releaseId}`
}

// ---------- Busca por código de barras / número de catálogo ----------

export interface ReleaseCandidate {
  releaseId: number
  masterId?: number
  /** Só o nome do artista (o Discogs devolve "Artista - Título"). */
  artistName: string
  title: string
  year?: number
  country?: string
  label?: string
  catno?: string
  /** Descrições de formato (ex.: ["Vinyl", "LP", "Album", "Reissue"]). */
  formats: string[]
  vinyl: boolean
  barcodes: string[]
  thumb?: string
  coverImage?: string
  have: number
  want: number
}

interface SearchRelease {
  id?: number
  master_id?: number | null
  title?: string
  year?: string
  country?: string
  label?: string[]
  catno?: string
  format?: string[]
  barcode?: string[]
  thumb?: string
  cover_image?: string
  community?: { have?: number; want?: number }
}

/** Separa "Artista - Título" no primeiro " - ". */
export function splitDiscogsTitle(full: string): { artistName: string; title: string } {
  const i = full.indexOf(' - ')
  if (i < 0) return { artistName: '', title: full.trim() }
  return { artistName: full.slice(0, i).trim(), title: full.slice(i + 3).trim() }
}

/** Tira o sufixo de desambiguação do Discogs, ex.: "Nirvana (2)" → "Nirvana". */
export function cleanArtistName(name: string): string {
  return name.replace(/\s*\(\d+\)\s*$/, '').trim()
}

function toCandidate(r: SearchRelease): ReleaseCandidate | null {
  if (!r.id || !r.title) return null
  const { artistName, title } = splitDiscogsTitle(r.title)
  const formats = r.format ?? []
  return {
    releaseId: r.id,
    masterId: r.master_id || undefined,
    artistName: cleanArtistName(artistName),
    title,
    year: r.year ? Number.parseInt(r.year, 10) || undefined : undefined,
    country: r.country || undefined,
    label: r.label?.[0] || undefined,
    catno: r.catno && r.catno !== 'none' ? r.catno : undefined,
    formats,
    vinyl: formats.some((f) => /vinyl/i.test(f)),
    barcodes: (r.barcode ?? []).map((b) => b.replace(/\D/g, '')).filter(Boolean),
    thumb: r.thumb || undefined,
    coverImage: r.cover_image || undefined,
    have: r.community?.have ?? 0,
    want: r.community?.want ?? 0,
  }
}

/**
 * Edições com este código de barras (ou número de catálogo). Vinil primeiro;
 * se não houver vinil, devolve as outras (CD etc.) para o usuário saber do
 * que se trata.
 */
export async function searchReleasesByCode(code: string, kind: 'barcode' | 'catno', priority: Priority = 'high'): Promise<ReleaseCandidate[]> {
  const params: Record<string, string> = { type: 'release', per_page: '25' }
  params[kind] = code
  const vinyl = await dgGet<{ results?: SearchRelease[] }>('database/search', { ...params, format: 'Vinyl' }, priority)
  let results = (vinyl.results ?? []).map(toCandidate).filter((c): c is ReleaseCandidate => !!c)
  if (!results.length) {
    const any = await dgGet<{ results?: SearchRelease[] }>('database/search', params, priority)
    results = (any.results ?? []).map(toCandidate).filter((c): c is ReleaseCandidate => !!c)
  }
  const seen = new Set<number>()
  return results
    .filter((c) => (seen.has(c.releaseId) ? false : (seen.add(c.releaseId), true)))
    .sort((a, b) => Number(b.vinyl) - Number(a.vinyl) || b.have - a.have)
}

export interface ReleaseDetails {
  releaseId: number
  masterId?: number
  title: string
  artists: { id: number; name: string }[]
  year?: number
  country?: string
  label?: string
  catno?: string
  format?: string
  vinyl: boolean
  barcode?: string
  coverUrl?: string
  thumb?: string
  tracks: { position: string; title: string; durationMs?: number }[]
}

/** Detalhes de uma edição: artista (com id), master, gravadora, catálogo, formato, capa e faixas. */
export async function fetchReleaseDetails(releaseId: number, priority: Priority = 'high'): Promise<ReleaseDetails> {
  const d = await dgGet<{
    id: number
    master_id?: number | null
    title?: string
    artists?: { id?: number; name?: string }[]
    year?: number
    country?: string
    labels?: { name?: string; catno?: string }[]
    formats?: { name?: string; descriptions?: string[]; text?: string }[]
    identifiers?: { type?: string; value?: string }[]
    images?: { type?: string; uri?: string; uri150?: string }[]
    tracklist?: { position?: string; type_?: string; title?: string; duration?: string }[]
  }>(`releases/${releaseId}`, {}, priority)
  const primary = d.images?.find((i) => i.type === 'primary') ?? d.images?.[0]
  const label = d.labels?.[0]
  const fmt = d.formats?.[0]
  const format = fmt ? [fmt.name, ...(fmt.descriptions ?? []), fmt.text].filter(Boolean).join(', ') : undefined
  const barcode = d.identifiers?.find((i) => i.type === 'Barcode')?.value?.replace(/\D/g, '') || undefined
  const tracks = (d.tracklist ?? [])
    .filter((t) => (t.type_ ?? 'track') === 'track' && t.title)
    .map((t, i) => {
      const m = t.duration?.match(/^(\d+):(\d{2})$/)
      return { position: t.position || String(i + 1), title: t.title!, durationMs: m ? (Number(m[1]) * 60 + Number(m[2])) * 1000 : undefined }
    })
  return {
    releaseId: d.id,
    masterId: d.master_id || undefined,
    title: (d.title ?? '').trim(),
    artists: (d.artists ?? []).filter((a) => a.id && a.name).map((a) => ({ id: a.id!, name: cleanArtistName(a.name!) })),
    year: d.year || undefined,
    country: d.country || undefined,
    label: label?.name || undefined,
    catno: label?.catno && label.catno !== 'none' ? label.catno : undefined,
    format,
    vinyl: (d.formats ?? []).some((f) => /vinyl/i.test(f.name ?? '')),
    barcode,
    coverUrl: primary?.uri,
    thumb: primary?.uri150,
    tracks,
  }
}
