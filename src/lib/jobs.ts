/**
 * Tarefas em segundo plano: importar/revisar a discografia de um artista e
 * buscar as faixas de todos os álbuns dele. É um estado global, fora do
 * React: continua rodando quando o usuário troca de tela. As telas observam
 * com useJobs().
 */
import { useSyncExternalStore } from 'react'
import { db } from '../db/db'
import { importDiscography, loadAlbumTracks, needsDiscography, needsTracks, type DiscographyResult } from './importArtist'

export type JobKind = 'import' | 'tracks'
export type JobStatus = 'queued' | 'running' | 'done' | 'error' | 'cancelled'

export interface Job {
  id: number
  kind: JobKind
  artistId: number
  label: string
  /** Texto de progresso (importação) */
  detail?: string
  done: number
  total: number
  status: JobStatus
  error?: string
  /** Resultado da importação, para a mensagem final. */
  result?: DiscographyResult
  prune?: boolean
}

let nextId = 1
let jobs: Job[] = []
let running = false
const listeners = new Set<() => void>()
/** Ids cancelados: o loop consulta aqui, mesmo se a tarefa já sumiu da lista. */
const cancelled = new Set<number>()

function emit() {
  jobs = [...jobs] // novo array para o React perceber a mudança
  listeners.forEach((l) => l())
}

function patch(id: number, changes: Partial<Job>) {
  jobs = jobs.map((j) => (j.id === id ? { ...j, ...changes } : j))
  listeners.forEach((l) => l())
}

function subscribe(l: () => void) {
  listeners.add(l)
  return () => listeners.delete(l)
}

function getSnapshot() {
  return jobs
}

/** Lista de tarefas (ativas e recém-terminadas), atualizada em tempo real. */
export function useJobs(): Job[] {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

export function activeJobFor(list: Job[], artistId: number, kind?: JobKind): Job | undefined {
  return list.find((j) => j.artistId === artistId && (!kind || j.kind === kind) && (j.status === 'queued' || j.status === 'running'))
}

function add(job: Omit<Job, 'id' | 'done' | 'total' | 'status'>) {
  jobs = [...jobs.filter((j) => !(j.artistId === job.artistId && j.kind === job.kind && j.status !== 'queued' && j.status !== 'running')), { ...job, id: nextId++, done: 0, total: 0, status: 'queued' }]
  emit()
  void run()
}

/** Importa (ou, com prune, revisa) a discografia do artista e depois busca as faixas. */
export function enqueueImport(artistId: number, label: string, prune = false) {
  if (activeJobFor(jobs, artistId, 'import')) return
  add({ kind: 'import', artistId, label, prune })
}

/** Enfileira a busca de faixas de todos os álbuns pendentes do artista. */
export function enqueueTracks(artistId: number, label: string) {
  if (activeJobFor(jobs, artistId, 'tracks')) return
  add({ kind: 'tracks', artistId, label })
}

export function cancelJob(id: number) {
  const job = jobs.find((j) => j.id === id)
  if (!job || (job.status !== 'queued' && job.status !== 'running')) return
  cancelled.add(id)
  patch(id, { status: 'cancelled' }) // o loop percebe e para no próximo passo
}

export function dismissJob(id: number) {
  jobs = jobs.filter((j) => j.id !== id)
  emit()
}

function isCancelled(id: number) {
  return cancelled.has(id)
}

async function runImport(job: Job) {
  const result = await importDiscography(job.artistId, {
    prune: job.prune,
    priority: 'high', // o usuário acabou de pedir; passa na frente das faixas
    onProgress: (detail) => patch(job.id, { detail }),
  })
  if (isCancelled(job.id)) return
  patch(job.id, { status: 'done', result, detail: undefined })
  setTimeout(() => dismissJob(job.id), 12000)
  enqueueTracks(job.artistId, job.label)
}

async function runTracks(job: Job) {
  const artist = await db.artists.get(job.artistId)
  const pendingAlbums = (await db.albums.where('artistId').equals(job.artistId).toArray()).filter(needsTracks)
  patch(job.id, { total: pendingAlbums.length })
  let done = 0
  for (const album of pendingAlbums) {
    if (isCancelled(job.id)) return
    // Chegou uma importação? Ela é mais urgente: devolve esta tarefa à fila e sai.
    if (jobs.some((j) => j.kind === 'import' && j.status === 'queued')) {
      patch(job.id, { status: 'queued', done: 0, total: 0 })
      return
    }
    // Reconfere: a tela do álbum pode ter buscado essas faixas enquanto isso.
    const fresh = await db.albums.get(album.id!)
    if (fresh && needsTracks(fresh)) {
      await loadAlbumTracks(fresh, artist?.countryCode, 'low')
    }
    done += 1
    patch(job.id, { done })
  }
  if (isCancelled(job.id)) return
  patch(job.id, { status: 'done' })
  setTimeout(() => dismissJob(job.id), 6000)
}

async function run() {
  if (running) return
  running = true
  try {
    for (;;) {
      // Importações primeiro: o usuário está esperando ver a lista.
      const job = jobs.find((j) => j.status === 'queued' && j.kind === 'import') ?? jobs.find((j) => j.status === 'queued')
      if (!job) break
      patch(job.id, { status: 'running' })
      try {
        if (job.kind === 'import') await runImport(job)
        else await runTracks(job)
      } catch (err) {
        patch(job.id, { status: 'error', error: err instanceof Error ? err.message : String(err) })
      }
    }
  } finally {
    running = false
  }
}

/**
 * Ao abrir o app: retoma importações interrompidas (artista sem nenhum
 * álbum) e a busca de faixas de álbuns pendentes.
 */
export async function resumePendingJobs() {
  if (!navigator.onLine) return
  const artists = await db.artists.toArray()
  const pendingAlbums = await db.albums.filter(needsTracks).toArray()
  const pendingByArtist = new Map<number, number>()
  for (const a of pendingAlbums) pendingByArtist.set(a.artistId, (pendingByArtist.get(a.artistId) ?? 0) + 1)
  for (const artist of artists) {
    if (!artist.mbid) continue
    const count = await db.albums.where('artistId').equals(artist.id!).count()
    if (needsDiscography(artist, count)) enqueueImport(artist.id!, artist.name)
    // Importado antes do filtro de vinil existir: revisa uma vez, em segundo plano.
    else if (!artist.discographyReviewedAt) enqueueImport(artist.id!, artist.name, true)
    else if (pendingByArtist.has(artist.id!)) enqueueTracks(artist.id!, artist.name)
  }
}
