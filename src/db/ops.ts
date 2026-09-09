/**
 * Operações de escrita que precisam de cuidado extra: exclusões registram
 * uma "lápide" (tombstone) para a nuvem e os outros aparelhos apagarem também.
 */
import { db } from './db'
import type { Album, Artist, Copy, Tombstone } from './types'
import { albumUid, artistUid, copyUid } from './uid'

function tombstones(table: Tombstone['table'], uids: string[]): Tombstone[] {
  const now = Date.now()
  return uids.map((uid) => ({ uid, table, deletedAt: now }))
}

export async function deleteArtistWithAlbums(artistId: number) {
  await db.transaction('rw', db.artists, db.albums, db.copies, db.tombstones, async () => {
    const artist = await db.artists.get(artistId)
    const albums = await db.albums.where('artistId').equals(artistId).toArray()
    const ids = albums.map((a) => a.id!)
    const copies = await db.copies.where('albumId').anyOf(ids).toArray()
    await db.tombstones.bulkPut([
      ...tombstones('copies', copies.map((c) => c.uid)),
      ...tombstones('albums', albums.map((a) => a.uid)),
      ...(artist ? tombstones('artists', [artist.uid]) : []),
    ])
    await db.copies.bulkDelete(copies.map((c) => c.id!))
    await db.albums.bulkDelete(ids)
    await db.artists.delete(artistId)
  })
}

export async function deleteAlbums(albumIds: number[]) {
  await db.transaction('rw', db.albums, db.copies, db.tombstones, async () => {
    const albums = (await db.albums.bulkGet(albumIds)).filter((a): a is Album => !!a)
    const copies = await db.copies.where('albumId').anyOf(albumIds).toArray()
    await db.tombstones.bulkPut([...tombstones('copies', copies.map((c) => c.uid)), ...tombstones('albums', albums.map((a) => a.uid))])
    await db.copies.bulkDelete(copies.map((c) => c.id!))
    await db.albums.bulkDelete(albums.map((a) => a.id!))
  })
}

export async function deleteCopyForAlbum(albumId: number) {
  await db.transaction('rw', db.copies, db.tombstones, async () => {
    const copy = await db.copies.where('albumId').equals(albumId).first()
    if (!copy) return
    await db.tombstones.put({ uid: copy.uid, table: 'copies', deletedAt: Date.now() })
    await db.copies.delete(copy.id!)
  })
}

/** Apaga tudo (com lápides, para a nuvem também esvaziar). */
export async function wipeAll() {
  await db.transaction('rw', db.artists, db.albums, db.copies, db.settings, db.tombstones, async () => {
    const [artists, albums, copies, settings] = await Promise.all([
      db.artists.toArray(),
      db.albums.toArray(),
      db.copies.toArray(),
      db.settings.toArray(),
    ])
    await db.tombstones.bulkPut([
      ...tombstones('copies', copies.map((c) => c.uid)),
      ...tombstones('albums', albums.map((a) => a.uid)),
      ...tombstones('artists', artists.map((a) => a.uid)),
      ...tombstones('settings', settings.filter((s) => !s.key.startsWith('sync.')).map((s) => s.key)),
    ])
    await Promise.all([db.artists.clear(), db.albums.clear(), db.copies.clear()])
    await db.settings.where('key').noneOf(['sync.lastPullAt', 'sync.lastSyncAt']).delete()
  })
}

/** Garante uid em registros vindos de backups antigos (sem uid). */
export function ensureUids(artists: Artist[], albums: Album[], copies: Copy[]) {
  const artistUidById = new Map<number, string>()
  for (const a of artists) {
    a.uid = a.uid || artistUid(a)
    artistUidById.set(a.id!, a.uid)
  }
  const albumUidById = new Map<number, string>()
  for (const al of albums) {
    al.uid = al.uid || albumUid(al, artistUidById.get(al.artistId) ?? 'n-')
    albumUidById.set(al.id!, al.uid)
  }
  for (const c of copies) c.uid = c.uid || copyUid(albumUidById.get(c.albumId) ?? 'a-')
}
