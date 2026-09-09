/**
 * Cliente mínimo do MusicBrainz (https://musicbrainz.org/doc/MusicBrainz_API).
 * Não precisa de chave. Regras: no máximo 1 requisição por segundo e o servidor
 * responde 503 quando está ocupado, então há fila + tentativas com espera.
 */
import type { AlbumType, Track } from '../db/types'

const BASE = 'https://musicbrainz.org/ws/2'
const MIN_INTERVAL_MS = 1100
const isStaticDemo = import.meta.env.VITE_STATIC_DEMO === '1'

export class MusicBrainzError extends Error {
  constructor(
    message: string,
    public readonly kind: 'offline' | 'busy' | 'http' | 'demo' | 'aborted',
  ) {
    super(message)
  }
}

export type Priority = 'high' | 'low'

interface RequestOptions {
  /** "high" = o usuário está esperando (busca, abrir álbum); fura a fila. "low" = segundo plano. */
  priority?: Priority
  signal?: AbortSignal
}

interface Pending {
  priority: Priority
  run: () => Promise<void>
}

// Fila com prioridade: garante o intervalo mínimo entre requisições e sempre
// atende primeiro as chamadas em que o usuário está esperando.
let lastRequestAt = 0
let draining = false
const pending: Pending[] = []

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

async function drain() {
  if (draining) return
  draining = true
  try {
    while (pending.length) {
      const idx = pending.findIndex((p) => p.priority === 'high')
      const next = pending.splice(idx >= 0 ? idx : 0, 1)[0]
      const wait = lastRequestAt + MIN_INTERVAL_MS - Date.now()
      if (wait > 0) await sleep(wait)
      lastRequestAt = Date.now()
      await next.run()
    }
  } finally {
    draining = false
  }
}

function scheduled<T>(priority: Priority, fn: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    pending.push({
      priority,
      run: () => fn().then(resolve, reject),
    })
    void drain()
  })
}

function abortError() {
  return new MusicBrainzError('Busca cancelada.', 'aborted')
}

async function mbGet<T>(path: string, params: Record<string, string>, opts: RequestOptions = {}): Promise<T> {
  const { priority = 'high', signal } = opts
  if (isStaticDemo) {
    throw new MusicBrainzError(
      'Nesta prévia o app não tem acesso à internet. A busca automática funciona no app publicado.',
      'demo',
    )
  }
  const url = new URL(`${BASE}/${path}`)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  url.searchParams.set('fmt', 'json')

  let lastError: unknown
  for (let attempt = 0; attempt < 4; attempt++) {
    if (signal?.aborted) throw abortError()
    if (attempt > 0) await sleep(1500 * 2 ** (attempt - 1))
    try {
      const res = await scheduled(priority, () => {
        if (signal?.aborted) return Promise.reject(abortError())
        return fetch(url.toString(), { headers: { Accept: 'application/json' }, signal })
      })
      if (res.status === 503 || res.status === 429) {
        lastError = new MusicBrainzError('O MusicBrainz está ocupado. Tente de novo em instantes.', 'busy')
        continue
      }
      if (!res.ok) throw new MusicBrainzError(`Erro ${res.status} ao consultar o MusicBrainz.`, 'http')
      return (await res.json()) as T
    } catch (err) {
      if (err instanceof MusicBrainzError && (err.kind === 'http' || err.kind === 'aborted')) throw err
      if (signal?.aborted || (err instanceof DOMException && err.name === 'AbortError')) throw abortError()
      lastError =
        err instanceof MusicBrainzError
          ? err
          : new MusicBrainzError('Sem conexão com o MusicBrainz. Verifique sua internet.', 'offline')
    }
  }
  throw lastError
}

// ---------- Busca de artistas ----------

export interface MBArtist {
  id: string
  name: string
  type?: string
  country?: string
  disambiguation?: string
  score: number
  /** Período de atividade, ex.: "1975–1995". */
  lifeSpan?: string
}

interface MBArtistSearchResponse {
  artists: {
    id: string
    name: string
    type?: string
    country?: string
    disambiguation?: string
    score: number
    'life-span'?: { begin?: string; end?: string; ended?: boolean }
  }[]
}

export async function searchArtists(query: string, signal?: AbortSignal, limit = 8): Promise<MBArtist[]> {
  const q = query.trim()
  if (!q) return []
  const data = await mbGet<MBArtistSearchResponse>('artist', { query: q, limit: String(limit) }, { priority: 'high', signal })
  return data.artists.map((a) => {
    const begin = a['life-span']?.begin?.slice(0, 4)
    const end = a['life-span']?.end?.slice(0, 4)
    const lifeSpan = begin ? `${begin}–${end ?? (a['life-span']?.ended ? '?' : 'hoje')}` : undefined
    return { id: a.id, name: a.name, type: a.type, country: a.country, disambiguation: a.disambiguation, score: a.score, lifeSpan }
  })
}

// ---------- Discografia (release groups) ----------

export interface MBReleaseGroup {
  id: string
  title: string
  year: number
  type: AlbumType
  firstReleaseDate?: string
}

interface MBReleaseGroupSearchResponse {
  count: number
  offset: number
  'release-groups': {
    id: string
    title: string
    'first-release-date'?: string
    'primary-type'?: string
    'secondary-types'?: string[]
  }[]
}

/** Tipos secundários que não interessam para uma coleção de LPs. */
const EXCLUDED_SECONDARY = new Set([
  'Demo',
  'Interview',
  'Audiobook',
  'Audio drama',
  'Spokenword',
  'Remix',
  'DJ-mix',
  'Mixtape/Street',
  'Field recording',
])

function classify(primary: string | undefined, secondary: string[]): AlbumType | null {
  if (secondary.some((s) => EXCLUDED_SECONDARY.has(s))) return null
  if (secondary.includes('Compilation') && secondary.includes('Soundtrack')) return null
  if (primary === 'EP') return 'ep'
  if (primary !== 'Album') return null
  if (secondary.includes('Live')) return 'live'
  if (secondary.includes('Compilation')) return 'compilation'
  return 'studio'
}

/**
 * Todos os lançamentos oficiais (álbuns e EPs) do artista, sem bootlegs,
 * demos e entrevistas. Faz uma requisição por página de 100.
 */
export async function fetchDiscography(
  artistMbid: string,
  onProgress?: (loaded: number, total: number) => void,
  priority: Priority = 'high',
): Promise<MBReleaseGroup[]> {
  const query = `arid:${artistMbid} AND status:official AND primarytype:(album OR ep)`
  const out: MBReleaseGroup[] = []
  let offset = 0
  let total = Infinity
  while (offset < total) {
    const page = await mbGet<MBReleaseGroupSearchResponse>(
      'release-group',
      { query, limit: '100', offset: String(offset) },
      { priority },
    )
    total = page.count
    for (const rg of page['release-groups']) {
      const type = classify(rg['primary-type'], rg['secondary-types'] ?? [])
      if (!type) continue
      const date = rg['first-release-date'] ?? ''
      const year = Number.parseInt(date.slice(0, 4), 10)
      out.push({ id: rg.id, title: rg.title, year: Number.isFinite(year) ? year : 0, type, firstReleaseDate: date || undefined })
    }
    offset += page['release-groups'].length
    onProgress?.(Math.min(offset, total), total)
    if (page['release-groups'].length === 0) break
  }
  // Ordena por data; sem data vai para o fim.
  out.sort((a, b) => (a.firstReleaseDate ?? '9999').localeCompare(b.firstReleaseDate ?? '9999'))
  return out
}

interface MBReleaseSearchResponse {
  count: number
  releases: {
    id: string
    date?: string
    country?: string
    'release-group': { id: string }
    'label-info'?: { label?: { name?: string } }[]
  }[]
}

export interface VinylInfo {
  /** Data da edição em vinil mais antiga encontrada. */
  earliestDate?: string
  /** Gravadora dessa edição. */
  label?: string
}

/**
 * Quais lançamentos do artista saíram em vinil, segundo o MusicBrainz.
 * Devolve um mapa: id do release group → info da edição em vinil mais antiga.
 * É isso que separa a discografia "de verdade" dos shows vendidos só em
 * download (o Metallica tem centenas).
 */
export async function fetchVinylReleaseGroups(
  artistMbid: string,
  onProgress?: (loaded: number, total: number) => void,
  priority: Priority = 'high',
): Promise<Map<string, VinylInfo>> {
  const query = `arid:${artistMbid} AND status:official AND format:*vinyl* AND primarytype:(album OR ep)`
  const out = new Map<string, VinylInfo>()
  let offset = 0
  let total = Infinity
  while (offset < total) {
    const page = await mbGet<MBReleaseSearchResponse>('release', { query, limit: '100', offset: String(offset) }, { priority })
    total = page.count
    for (const rel of page.releases) {
      const rgid = rel['release-group']?.id
      if (!rgid) continue
      const date = rel.date || undefined
      const label = rel['label-info']?.map((li) => li.label?.name).find(Boolean) ?? undefined
      const cur = out.get(rgid)
      if (!cur) out.set(rgid, { earliestDate: date, label })
      else if (date && (!cur.earliestDate || date < cur.earliestDate)) out.set(rgid, { earliestDate: date, label: label ?? cur.label })
      else if (!cur.label && label) cur.label = label
    }
    offset += page.releases.length
    onProgress?.(Math.min(offset, total), total)
    if (page.releases.length === 0) break
  }
  return out
}

/** URL da capa no Cover Art Archive (redireciona para a imagem; 404 se não houver). */
export function coverArtUrl(releaseGroupMbid: string, size: 250 | 500 = 500): string {
  return `https://coverartarchive.org/release-group/${releaseGroupMbid}/front-${size}`
}

// ---------- Faixas e gravadora ----------

interface MBReleaseGroupDetail {
  releases: {
    id: string
    status?: string
    date?: string
    country?: string
    media?: { format?: string }[]
  }[]
}

interface MBReleaseDetail {
  date?: string
  country?: string
  'label-info'?: { label?: { name?: string } }[]
  media: {
    position?: number
    format?: string
    tracks: { number?: string; position?: number; title: string; length?: number }[]
  }[]
}

export interface MBTracksResult {
  tracks: Track[]
  label?: string
  releaseMbid: string
  format?: string
}

/**
 * Escolhe a edição mais representativa do lançamento (oficial, de preferência
 * em vinil e do país do artista, a mais antiga) e devolve as faixas dela.
 */
export async function fetchTracks(
  releaseGroupMbid: string,
  preferCountry?: string,
  priority: Priority = 'high',
): Promise<MBTracksResult | null> {
  const rg = await mbGet<MBReleaseGroupDetail>(`release-group/${releaseGroupMbid}`, { inc: 'releases+media' }, { priority })
  const official = rg.releases.filter((r) => r.status === 'Official')
  const pool = official.length ? official : rg.releases
  if (!pool.length) return null
  const isVinyl = (r: MBReleaseGroupDetail['releases'][number]) => r.media?.some((m) => /vinyl/i.test(m.format ?? '')) ?? false
  const score = (r: MBReleaseGroupDetail['releases'][number]) =>
    (isVinyl(r) ? 0 : 10) + (preferCountry && r.country === preferCountry ? 0 : 1) + (r.media?.length ? 0 : 5)
  const best = [...pool].sort((a, b) => score(a) - score(b) || (a.date ?? '9999').localeCompare(b.date ?? '9999'))[0]

  const rel = await mbGet<MBReleaseDetail>(`release/${best.id}`, { inc: 'recordings+labels' }, { priority })
  const multi = rel.media.length > 1
  const tracks: Track[] = []
  for (const m of rel.media) {
    for (const t of m.tracks) {
      const num = t.number ?? String(t.position ?? tracks.length + 1)
      const position = multi && /^\d+$/.test(num) ? `${m.position ?? 1}-${num}` : num
      tracks.push({ position, title: t.title, durationMs: t.length ?? undefined })
    }
  }
  const label = rel['label-info']?.map((li) => li.label?.name).find(Boolean) ?? undefined
  return { tracks, label, releaseMbid: best.id, format: rel.media[0]?.format }
}

/** Nome do país em português para os códigos mais comuns. */
export function countryName(code: string | undefined): string | undefined {
  if (!code) return undefined
  const names: Record<string, string> = {
    GB: 'Reino Unido',
    US: 'Estados Unidos',
    BR: 'Brasil',
    DE: 'Alemanha',
    FR: 'França',
    IT: 'Itália',
    ES: 'Espanha',
    PT: 'Portugal',
    AR: 'Argentina',
    CA: 'Canadá',
    AU: 'Austrália',
    JP: 'Japão',
    SE: 'Suécia',
    NO: 'Noruega',
    FI: 'Finlândia',
    DK: 'Dinamarca',
    NL: 'Países Baixos',
    BE: 'Bélgica',
    IE: 'Irlanda',
    MX: 'México',
    XW: 'Internacional',
    XE: 'Europa',
  }
  return names[code] ?? code
}
