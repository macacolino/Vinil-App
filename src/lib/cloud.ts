/**
 * Camada de acesso à nuvem. A interface CloudProvider isola o resto do app
 * do Supabase (e permite um provedor falso nos testes).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { SyncTable } from '../db/types'

export interface CloudUser {
  id: string
  email?: string
}

export interface CloudRow {
  uid: string
  parent_uid: string | null
  data: Record<string, unknown>
  updated_at: number
  /** ISO, preenchido pelo servidor. */
  synced_at?: string
}

export interface CloudTombstone {
  uid: string
  table_name: SyncTable
  deleted_at: number
  synced_at?: string
}

export interface CloudProvider {
  signIn(email: string, password: string): Promise<void>
  signUp(email: string, password: string): Promise<{ needsConfirmation: boolean }>
  signOut(): Promise<void>
  getUser(): Promise<CloudUser | null>
  onAuthChange(cb: (user: CloudUser | null) => void): () => void
  upsert(table: SyncTable, rows: CloudRow[]): Promise<void>
  remove(table: SyncTable, uids: string[]): Promise<void>
  /** Linhas gravadas no servidor depois de `sinceIso`, em ordem crescente de synced_at. */
  fetchSince(table: SyncTable, sinceIso: string): Promise<CloudRow[]>
  upsertTombstones(rows: CloudTombstone[]): Promise<void>
  fetchTombstonesSince(sinceIso: string): Promise<CloudTombstone[]>
}

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

/** true quando o build recebeu as chaves do Supabase. */
export const cloudConfigured = !!(url && anonKey)

const PAGE = 1000

class SupabaseProvider implements CloudProvider {
  private client: SupabaseClient

  constructor(client: SupabaseClient) {
    this.client = client
  }

  async signIn(email: string, password: string) {
    const { error } = await this.client.auth.signInWithPassword({ email, password })
    if (error) throw new Error(traduz(error.message))
  }

  async signUp(email: string, password: string) {
    const { data, error } = await this.client.auth.signUp({ email, password })
    if (error) throw new Error(traduz(error.message))
    return { needsConfirmation: !data.session }
  }

  async signOut() {
    await this.client.auth.signOut()
  }

  async getUser(): Promise<CloudUser | null> {
    const { data } = await this.client.auth.getSession()
    const u = data.session?.user
    return u ? { id: u.id, email: u.email } : null
  }

  onAuthChange(cb: (user: CloudUser | null) => void) {
    const { data } = this.client.auth.onAuthStateChange((_event, session) => {
      const u = session?.user
      cb(u ? { id: u.id, email: u.email } : null)
    })
    return () => data.subscription.unsubscribe()
  }

  async upsert(table: SyncTable, rows: CloudRow[]) {
    for (let i = 0; i < rows.length; i += 200) {
      const { error } = await this.client.from(table).upsert(rows.slice(i, i + 200), { onConflict: 'user_id,uid' })
      if (error) throw new Error(error.message)
    }
  }

  async remove(table: SyncTable, uids: string[]) {
    for (let i = 0; i < uids.length; i += 200) {
      const { error } = await this.client.from(table).delete().in('uid', uids.slice(i, i + 200))
      if (error) throw new Error(error.message)
    }
  }

  async fetchSince(table: SyncTable, sinceIso: string): Promise<CloudRow[]> {
    const out: CloudRow[] = []
    let since = sinceIso
    for (;;) {
      const { data, error } = await this.client
        .from(table)
        .select('uid, parent_uid, data, updated_at, synced_at')
        .gt('synced_at', since)
        .order('synced_at', { ascending: true })
        .limit(PAGE)
      if (error) throw new Error(error.message)
      const rows = (data ?? []) as CloudRow[]
      out.push(...rows)
      if (rows.length < PAGE) break
      since = rows[rows.length - 1].synced_at!
    }
    return out
  }

  async upsertTombstones(rows: CloudTombstone[]) {
    for (let i = 0; i < rows.length; i += 200) {
      const { error } = await this.client.from('tombstones').upsert(rows.slice(i, i + 200), { onConflict: 'user_id,table_name,uid' })
      if (error) throw new Error(error.message)
    }
  }

  async fetchTombstonesSince(sinceIso: string): Promise<CloudTombstone[]> {
    const { data, error } = await this.client
      .from('tombstones')
      .select('uid, table_name, deleted_at, synced_at')
      .gt('synced_at', sinceIso)
      .order('synced_at', { ascending: true })
      .limit(5000)
    if (error) throw new Error(error.message)
    return (data ?? []) as CloudTombstone[]
  }
}

function traduz(msg: string): string {
  const m = msg.toLowerCase()
  if (m.includes('invalid login credentials')) return 'E-mail ou senha incorretos.'
  if (m.includes('email not confirmed')) return 'Confirme seu e-mail antes de entrar (veja a caixa de entrada).'
  if (m.includes('user already registered')) return 'Já existe uma conta com esse e-mail. Use "Entrar".'
  if (m.includes('password should be at least')) return 'A senha precisa ter pelo menos 6 caracteres.'
  if (m.includes('failed to fetch')) return 'Sem conexão com a nuvem.'
  return msg
}

let provider: CloudProvider | null = null

/** Provedor da nuvem, ou null quando as chaves não foram configuradas. */
export function getCloud(): CloudProvider | null {
  if (provider) return provider
  if (!cloudConfigured) return null
  provider = new SupabaseProvider(createClient(url!, anonKey!))
  return provider
}

/** Usado pelos testes para trocar o Supabase por um provedor em memória. */
export function setCloudProvider(p: CloudProvider | null) {
  provider = p
}
