/**
 * Tarefas em segundo plano (busca de faixas de um artista inteiro).
 * É um estado global, fora do React: continua rodando quando o usuário
 * troca de tela. As telas observam com useJobs().
 */
import { useSyncExternalStore } from 'react'
import { db } from '../db/db'
import { loadAlbumTracks, needsTracks } from './importArtist'

export type JobStatus = 'queued' | 'running' | 'done' | 'error' | 'cancelled'

export interface Job {
  id: number
  artistId: number
  label: string
  done: number
  total: number
  status: JobStatus
  error?: string
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

export function activeJobFor(list: Job[], artistId: number): Job | undefined {
  return list.find((j) => j.artistId === artistId && (j.status === 'queued' || j.status === 'running'))
}

/** Enfileira a busca de faixas de todos os álbuns pendentes do artista. */
export function enqueueTracks(artistId: number, label: string) {
  if (activeJobFor(jobs, artistId)) return
  jobs = [...jobs.filter((j) => j.artistId !== artistId), { id: nextId++, artistId, label, done: 0, total: 0, status: 'queued' }]
  emit()
  void run()
}

export function cancelJob(id: number) {
  const job = jobs.find((j) => j.id === id)
  if (!job || (job.status !== 'queued' && job.status !== 'running')) return
  cancelled.add(id)
  patch(id, { status: 'cancelled' }) // o loop percebe e para no próximo álbum
}

export function dismissJob(id: number) {
  jobs = jobs.filter((j) => j.id !== id)
  emit()
}

function isCancelled(id: number) {
  return cancelled.has(id)
}

async function run() {
  if (running) return
  running = true
  try {
    for (;;) {
      const job = jobs.find((j) => j.status === 'queued')
      if (!job) break
      patch(job.id, { status: 'running' })
      try {
        const artist = await db.artists.get(job.artistId)
        const pendingAlbums = (await db.albums.where('artistId').equals(job.artistId).toArray()).filter(needsTracks)
        patch(job.id, { total: pendingAlbums.length })
        let done = 0
        for (const album of pendingAlbums) {
          if (isCancelled(job.id)) break
          // Reconfere: a tela do álbum pode ter buscado essas faixas enquanto isso.
          const fresh = await db.albums.get(album.id!)
          if (fresh && needsTracks(fresh)) {
            await loadAlbumTracks(fresh, artist?.countryCode, 'low')
          }
          done += 1
          patch(job.id, { done })
        }
        if (!isCancelled(job.id)) {
          patch(job.id, { status: 'done' })
          setTimeout(() => dismissJob(job.id), 6000)
        }
      } catch (err) {
        patch(job.id, { status: 'error', error: err instanceof Error ? err.message : String(err) })
      }
    }
  } finally {
    running = false
  }
}

/**
 * Ao abrir o app: retoma a busca de faixas de artistas importados que ainda
 * têm álbuns pendentes (por exemplo, se o app foi fechado no meio).
 */
export async function resumePendingTracks() {
  if (!navigator.onLine) return
  const pendingAlbums = await db.albums.filter(needsTracks).toArray()
  const byArtist = new Map<number, number>()
  for (const a of pendingAlbums) byArtist.set(a.artistId, (byArtist.get(a.artistId) ?? 0) + 1)
  for (const artistId of byArtist.keys()) {
    const artist = await db.artists.get(artistId)
    if (artist) enqueueTracks(artistId, artist.name)
  }
}
