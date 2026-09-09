import { db } from '../db/db'
import type { Album, Artist, Copy, Setting } from '../db/types'
import { ensureUids, wipeAll } from '../db/ops'

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
  const semSync = settings.filter((s) => !s.key.startsWith('sync.'))
  return { app: 'vinil', version: 1, exportedAt: new Date().toISOString(), artists, albums, copies, settings: semSync }
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

/**
 * Substitui TODOS os dados locais pelo conteúdo do backup. As exclusões
 * ficam registradas para a nuvem; os registros do backup entram como
 * alterações novas (dirty) e são enviados na próxima sincronização.
 */
export async function importBackup(backup: Backup) {
  ensureUids(backup.artists, backup.albums, backup.copies)
  await wipeAll()
  await db.transaction('rw', db.artists, db.albums, db.copies, db.settings, db.tombstones, async () => {
    await db.artists.bulkAdd(backup.artists)
    await db.albums.bulkAdd(backup.albums)
    await db.copies.bulkAdd(backup.copies)
    await db.settings.bulkPut(backup.settings.filter((s) => !s.key.startsWith('sync.')))
    // O que o backup traz de volta não deve ser apagado da nuvem.
    const uids = [...backup.artists, ...backup.albums, ...backup.copies].map((r) => r.uid)
    await db.tombstones.bulkDelete(uids)
  })
}
