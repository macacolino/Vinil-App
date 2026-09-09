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
    pending.push({ priority, run: () => fn().then(resolve, reject) })
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
}

/** Quantos anúncios e o menor preço (em dólar) de uma edição específica. */
export async function fetchStats(releaseId: number, priority: Priority = 'high'): Promise<DiscogsStats> {
  const data = await dgGet<{ num_for_sale?: number; lowest_price?: { value?: number; currency?: string } | null }>(
    `marketplace/stats/${releaseId}`,
    { curr_abbr: 'USD' },
    priority,
  )
  return { numForSale: data.num_for_sale ?? 0, lowestUsd: data.lowest_price?.value ?? undefined }
}

/** Procura o "master" de um álbum pelo nome do artista e título (quando o MusicBrainz não tem o link). */
export async function searchMaster(artist: string, title: string, priority: Priority = 'high'): Promise<number | null> {
  const data = await dgGet<{ results?: { master_id?: number; type?: string }[] }>(
    'database/search',
    { type: 'master', artist, release_title: title, format: 'Vinyl', per_page: '5' },
    priority,
  )
  const hit = data.results?.find((r) => r.master_id)
  return hit?.master_id ?? null
}

export function masterUrl(masterId: number): string {
  return `https://www.discogs.com/master/${masterId}`
}

export function releaseUrl(releaseId: number): string {
  return `https://www.discogs.com/release/${releaseId}`
}
