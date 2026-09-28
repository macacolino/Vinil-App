/**
 * Sincronização com a nuvem (Supabase), no estilo "último a gravar ganha"
 * (metadados pelo updatedAt; campos do usuário pelo userUpdatedAt):
 *  1. baixa o que mudou no servidor desde a última vez e aplica localmente;
 *  2. envia o que mudou aqui (dirty = 1) e as exclusões (tombstones)
 *     quando for mais novo que a cópia local.
 * Roda ao entrar, ao voltar a ficar online, alguns segundos depois de cada
 * alteração local e pelo botão "Sincronizar agora".
 */
import { useSyncExternalStore } from 'react'
import { db, metaTransaction, onLocalChange, syncTransaction } from '../db/db'
import type { Album, Artist, Copy, Setting, SyncTable } from '../db/types'
import { getCloud, type CloudProvider, type CloudRow, type CloudUser } from './cloud'

export type SyncState = 'idle' | 'syncing' | 'ok' | 'error' | 'offline'

export interface SyncStatus {
  user: CloudUser | null
  /** undefined enquanto a sessão salva ainda está sendo lida. */
  ready: boolean
  state: SyncState
  lastSyncAt?: number
  error?: string
}

const LAST_PULL_KEY = 'sync.lastPullAt'
const LAST_SYNC_KEY = 'sync.lastSyncAt'
const LOCAL_ONLY_KEYS = new Set([LAST_PULL_KEY, LAST_SYNC_KEY])

let status: SyncStatus = { user: null, ready: false, state: 'idle' }
const listeners = new Set<() => void>()
let syncing = false
let again = false
let timer: ReturnType<typeof setTimeout> | undefined
let started = false

function set(changes: Partial<SyncStatus>) {
  status = { ...status, ...changes }
  listeners.forEach((l) => l())
}

export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => status,
    () => status,
  )
}

/** Liga a sincronização: lê a sessão salva, observa login/logout e mudanças locais. */
export async function startSync() {
  if (started) return
  started = true
  const cloud = getCloud()
  if (!cloud) {
    set({ ready: true })
    return
  }
  const last = await db.settings.get(LAST_SYNC_KEY)
  set({ lastSyncAt: typeof last?.value === 'number' ? last.value : undefined })
  cloud.onAuthChange((user) => {
    set({ user, ready: true, state: user ? status.state : 'idle' })
    if (user) void syncNow()
  })
  const user = await cloud.getUser()
  set({ user, ready: true })
  if (user) void syncNow()

  onLocalChange(() => scheduleSync())
  window.addEventListener('online', () => void syncNow())
}

/** Agenda uma sincronização daqui a alguns segundos (junta várias alterações seguidas). */
export function scheduleSync(delayMs = 4000) {
  if (!status.user) return
  clearTimeout(timer)
  timer = setTimeout(() => void syncNow(), delayMs)
}

export async function signIn(email: string, password: string) {
  const cloud = getCloud()
  if (!cloud) throw new Error('Nuvem não configurada.')
  await cloud.signIn(email, password)
  const user = await cloud.getUser()
  set({ user })
  await syncNow()
}

export async function signUp(email: string, password: string) {
  const cloud = getCloud()
  if (!cloud) throw new Error('Nuvem não configurada.')
  const result = await cloud.signUp(email, password)
  if (!result.needsConfirmation) {
    set({ user: await cloud.getUser() })
    await syncNow()
  }
  return result
}

export async function signOut() {
  const cloud = getCloud()
  await cloud?.signOut()
  // Ao sair, a próxima conta que entrar precisa baixar tudo de novo.
  await syncTransaction([db.settings], async () => {
    await db.settings.delete(LAST_PULL_KEY)
  })
  set({ user: null, state: 'idle' })
}

// ---------------------------------------------------------------------------

type LocalRow = Artist | Album | Copy

function stripLocal<T extends Record<string, unknown>>(row: T, drop: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(row)) if (!drop.includes(k) && v !== undefined) out[k] = v
  return out
}

async function push(cloud: CloudProvider) {
  // Exclusões primeiro: se algo foi apagado e recriado, a criação vem depois.
  const tombs = await db.tombstones.toArray()
  if (tombs.length) {
    const byTable = new Map<SyncTable, string[]>()
    for (const t of tombs) byTable.set(t.table, [...(byTable.get(t.table) ?? []), t.uid])
    for (const [table, uids] of byTable) await cloud.remove(table, uids)
    await cloud.upsertTombstones(tombs.map((t) => ({ uid: t.uid, table_name: t.table, deleted_at: t.deletedAt })))
    await db.tombstones.bulkDelete(tombs.map((t) => t.uid))
  }

  const artists = await db.artists.where('dirty').equals(1).toArray()
  if (artists.length) {
    await cloud.upsert(
      'artists',
      artists.map((a) => ({ uid: a.uid, parent_uid: null, data: stripLocal(a as unknown as Record<string, unknown>, ['id', 'dirty']), updated_at: a.updatedAt })),
    )
    await markClean(db.artists, artists)
  }

  const albums = await db.albums.where('dirty').equals(1).toArray()
  if (albums.length) {
    const artistUidById = new Map((await db.artists.toArray()).map((a) => [a.id!, a.uid]))
    await cloud.upsert(
      'albums',
      albums.map((al) => ({
        uid: al.uid,
        parent_uid: artistUidById.get(al.artistId) ?? null,
        data: stripLocal(al as unknown as Record<string, unknown>, ['id', 'dirty', 'artistId']),
        updated_at: al.updatedAt,
      })),
    )
    await markClean(db.albums, albums)
  }

  const copies = await db.copies.where('dirty').equals(1).toArray()
  if (copies.length) {
    const albumUidById = new Map((await db.albums.toArray()).map((a) => [a.id!, a.uid]))
    await cloud.upsert(
      'copies',
      copies.map((c) => ({
        uid: c.uid,
        parent_uid: albumUidById.get(c.albumId) ?? null,
        data: stripLocal(c as unknown as Record<string, unknown>, ['id', 'dirty', 'albumId']),
        updated_at: c.updatedAt,
      })),
    )
    await markClean(db.copies, copies)
  }

  const settings = (await db.settings.where('dirty').equals(1).toArray()).filter((s) => !LOCAL_ONLY_KEYS.has(s.key))
  if (settings.length) {
    await cloud.upsert(
      'settings',
      settings.map((s) => ({ uid: s.key, parent_uid: null, data: { value: s.value }, updated_at: s.updatedAt ?? Date.now() })),
    )
    await syncTransaction([db.settings], async () => {
      for (const s of settings) await db.settings.update(s.key, { dirty: 0 })
    })
  }
}

async function markClean<T extends LocalRow>(table: { update: (key: number, changes: Partial<T>) => Promise<number> }, rows: T[]) {
  await syncTransaction([db.artists, db.albums, db.copies], async () => {
    for (const r of rows) await table.update(r.id!, { dirty: 0 } as Partial<T>)
  })
}

async function pull(cloud: CloudProvider) {
  const sinceSetting = await db.settings.get(LAST_PULL_KEY)
  const since = typeof sinceSetting?.value === 'string' ? sinceSetting.value : '1970-01-01T00:00:00Z'
  let newest = since

  const tombs = await cloud.fetchTombstonesSince(since)
  const [artists, albums, copies, settings] = await Promise.all([
    cloud.fetchSince('artists', since),
    cloud.fetchSince('albums', since),
    cloud.fetchSince('copies', since),
    cloud.fetchSince('settings', since),
  ])
  for (const r of [...tombs, ...artists, ...albums, ...copies, ...settings]) {
    if (r.synced_at && r.synced_at > newest) newest = r.synced_at
  }

  await syncTransaction([db.artists, db.albums, db.copies, db.settings], async () => {
    // 1) exclusões vindas de outros aparelhos
    for (const t of tombs) {
      if (t.table_name === 'copies') await db.copies.where('uid').equals(t.uid).delete()
      else if (t.table_name === 'albums') {
        const al = await db.albums.where('uid').equals(t.uid).first()
        if (al) {
          await db.copies.where('albumId').equals(al.id!).delete()
          await db.albums.delete(al.id!)
        }
      } else if (t.table_name === 'artists') {
        const ar = await db.artists.where('uid').equals(t.uid).first()
        if (ar) {
          const als = await db.albums.where('artistId').equals(ar.id!).toArray()
          await db.copies.where('albumId').anyOf(als.map((a) => a.id!)).delete()
          await db.albums.bulkDelete(als.map((a) => a.id!))
          await db.artists.delete(ar.id!)
        }
      } else if (t.table_name === 'settings') await db.settings.delete(t.uid)
    }

    // 2) artistas
    for (const row of artists) await applyRow(db.artists, row, {})

    // 3) álbuns (precisam do id local do artista)
    if (albums.length) {
      const artistIdByUid = new Map((await db.artists.toArray()).map((a) => [a.uid, a.id!]))
      for (const row of albums) {
        const artistId = row.parent_uid ? artistIdByUid.get(row.parent_uid) : undefined
        if (artistId == null) continue
        await applyRow(db.albums, row, { artistId })
      }
    }

    // 4) cópias (precisam do id local do álbum)
    if (copies.length) {
      const albumIdByUid = new Map((await db.albums.toArray()).map((a) => [a.uid, a.id!]))
      for (const row of copies) {
        const albumId = row.parent_uid ? albumIdByUid.get(row.parent_uid) : undefined
        if (albumId == null) continue
        await applyRow(db.copies, row, { albumId })
      }
    }

    // 5) configurações
    for (const row of settings) {
      if (LOCAL_ONLY_KEYS.has(row.uid)) continue
      const local = await db.settings.get(row.uid)
      if (!local || (local.updatedAt ?? 0) < row.updated_at) {
        await db.settings.put({ key: row.uid, value: (row.data as { value: unknown }).value, updatedAt: row.updated_at, dirty: 0 })
      }
    }

    await db.settings.put({ key: LAST_PULL_KEY, value: newest, dirty: 0 })
  })
}

/**
 * Campos que só o usuário altera. Numa disputa entre aparelhos, eles seguem
 * quem tem o userUpdatedAt mais novo, e não o updatedAt: as tarefas
 * automáticas (faixas, preços, capas) mexem em updatedAt o tempo todo e, sem
 * isso, uma atualização de preço no PC apagava um "tenho" marcado no celular
 * (aconteceu de verdade: 18 discos viraram 15 depois de uma pausa da nuvem).
 */
const USER_FIELDS: Record<string, string[]> = {
  albums: ['status', 'notes', 'editions', 'title', 'year', 'type', 'label', 'discogsMasterId', 'discogsMasterSource'],
  artists: ['name', 'country', 'countryCode', 'notes'],
}

/** Copia os campos do usuário de `from` para `into` (inclusive preço/raridade/foto quando manuais). */
function copyUserFields(table: string, from: Record<string, unknown>, into: Record<string, unknown>) {
  for (const f of USER_FIELDS[table] ?? []) if (f in from) into[f] = from[f]
  if (table === 'albums') {
    const a = from as Partial<Album>
    if (a.raritySource === 'manual') Object.assign(into, { rarity: a.rarity, raritySource: 'manual' })
    if (a.priceSource === 'manual') Object.assign(into, { estimatedPriceUsd: a.estimatedPriceUsd, priceSource: 'manual' })
  }
  if (table === 'artists') {
    const ar = from as Partial<Artist>
    if (ar.imageSource === 'manual') Object.assign(into, { imageUrl: ar.imageUrl, imageSource: 'manual' })
  }
  into.userUpdatedAt = from.userUpdatedAt
}

/**
 * Aplica uma linha da nuvem. Metadados seguem o updatedAt mais novo; os campos
 * do usuário seguem o userUpdatedAt mais novo. Quando os dois lados vencem em
 * coisas diferentes, o resultado mesclado fica dirty e volta para a nuvem no
 * push (que roda logo depois do pull).
 */
async function applyRow<T extends LocalRow>(
  table: {
    name: string
    where: (index: string) => { equals: (v: string) => { first: () => Promise<T | undefined> } }
    put: (row: T) => Promise<unknown>
  },
  row: CloudRow,
  extra: Partial<T>,
) {
  const local = await table.where('uid').equals(row.uid).first()
  const remote = { ...(row.data as unknown as T), ...extra, uid: row.uid, dirty: 0 } as T
  if (!local) {
    await table.put(remote)
    return
  }
  const hasUserFields = table.name in USER_FIELDS
  const localUser = local.userUpdatedAt ?? 0
  const remoteUser = (row.data.userUpdatedAt as number | undefined) ?? 0
  if (local.updatedAt >= row.updated_at) {
    // Metadados locais mais novos. Só há o que fazer se a nuvem trouxer uma
    // alteração do usuário mais recente (feita no outro aparelho).
    if (!hasUserFields || remoteUser <= localUser) return
    const merged = { ...local, dirty: 1 } as T
    copyUserFields(table.name, row.data, merged as unknown as Record<string, unknown>)
    await table.put(merged)
    return
  }
  remote.id = local.id
  if (hasUserFields && localUser > remoteUser) {
    // Nuvem com metadados mais novos, mas o usuário mexeu aqui depois: mantém
    // o que ele fez por cima dos metadados novos e devolve à nuvem.
    copyUserFields(table.name, local as unknown as Record<string, unknown>, remote as unknown as Record<string, unknown>)
    remote.dirty = 1
  }
  await table.put(remote)
}

/**
 * Álbum que tem cópia cadastrada ou edição escaneada como "minha" mas não
 * está como "tenho": foi vítima da disputa acima antes da correção. Volta
 * para "tenho" (como alteração do usuário, para vencer na sincronização).
 */
export async function repairOwnership(): Promise<number> {
  const copies = await db.copies.toArray()
  const withCopy = new Set(copies.map((c) => c.albumId))
  const lost = (await db.albums.toArray()).filter((a) => a.status !== 'have' && (withCopy.has(a.id!) || a.editions?.some((e) => e.owned)))
  for (const a of lost) await db.albums.update(a.id!, { status: 'have' })
  return lost.length
}

/** Sincroniza agora (envia e depois baixa). Se já estiver rodando, repete ao terminar. */
export async function syncNow(): Promise<void> {
  const cloud = getCloud()
  if (!cloud || !status.user) return
  if (syncing) {
    again = true
    return
  }
  if (!navigator.onLine) {
    set({ state: 'offline' })
    return
  }
  syncing = true
  clearTimeout(timer)
  set({ state: 'syncing', error: undefined })
  try {
    // Primeiro baixa, depois envia: assim uma linha mesclada (metadados da
    // nuvem + alteração do usuário local) sobe já nesta rodada, e um push
    // nunca atropela na nuvem uma alteração que ainda não tínhamos visto.
    await pull(cloud)
    await push(cloud)
    const now = Date.now()
    await syncTransaction([db.settings], async () => {
      await db.settings.put({ key: LAST_SYNC_KEY, value: now, dirty: 0 })
    })
    set({ state: 'ok', lastSyncAt: now })
  } catch (err) {
    set({ state: 'error', error: err instanceof Error ? err.message : String(err) })
  } finally {
    syncing = false
    if (again) {
      again = false
      void syncNow()
    }
  }
}

// Ganchos para os testes automatizados trocarem o Supabase por um provedor falso.
declare global {
  interface Window {
    __vinil?: {
      setCloudProvider: (p: CloudProvider | null) => void
      syncNow: () => Promise<void>
      db: typeof db
      syncStatus: () => SyncStatus
      pricing?: Record<string, unknown>
      barcode?: Record<string, unknown>
      decodeImage?: (url: string) => Promise<string | null>
      metaTransaction?: typeof metaTransaction
      repairOwnership?: typeof repairOwnership
    }
  }
}
if (import.meta.env.VITE_TEST_HOOKS === '1') {
  Promise.all([import('./cloud'), import('./pricing'), import('./barcode'), import('../components/BarcodeScanner')]).then(
    ([{ setCloudProvider }, pricing, barcode, scanner]) => {
      window.__vinil = {
        setCloudProvider,
        syncNow,
        db,
        syncStatus: () => status,
        pricing: { ...pricing },
        barcode: { ...barcode },
        decodeImage: scanner.decodeImage,
        metaTransaction,
        repairOwnership,
      }
    },
  )
}

export type { Setting }
