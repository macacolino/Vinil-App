import { db } from '../db/db'
import type { Album, Artist, Copy, Setting } from '../db/types'

export interface Backup {
  app: 'vinil'
  version: 1
  exportedAt: string
  artists: Artist[]
  albums: Album[]
  copies: Copy[]
  settings: Setting[]
}

export async function exportBackup(): Promise<Backup> {
  const [artists, albums, copies, settings] = await Promise.all([
    db.artists.toArray(),
    db.albums.toArray(),
    db.copies.toArray(),
    db.settings.toArray(),
  ])
  return { app: 'vinil', version: 1, exportedAt: new Date().toISOString(), artists, albums, copies, settings }
}

export function downloadJson(data: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function isBackup(value: unknown): value is Backup {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return (
    v.app === 'vinil' &&
    Array.isArray(v.artists) &&
    Array.isArray(v.albums) &&
    Array.isArray(v.copies) &&
    Array.isArray(v.settings)
  )
}

/** Substitui TODOS os dados locais pelo conteúdo do backup. */
export async function importBackup(backup: Backup) {
  await db.transaction('rw', db.artists, db.albums, db.copies, db.settings, async () => {
    await Promise.all([db.artists.clear(), db.albums.clear(), db.copies.clear(), db.settings.clear()])
    await db.artists.bulkAdd(backup.artists)
    await db.albums.bulkAdd(backup.albums)
    await db.copies.bulkAdd(backup.copies)
    await db.settings.bulkAdd(backup.settings)
  })
}
