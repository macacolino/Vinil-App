import { useState, type FormEvent } from 'react'
import { cloudConfigured } from '../lib/cloud'
import { signIn, signOut, signUp, syncNow, useSyncStatus } from '../lib/sync'

function when(ts?: number) {
  if (!ts) return 'nunca'
  return new Date(ts).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

/** Card "Conta e sincronização" das Configurações. */
export function AccountCard() {
  const status = useSyncStatus()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null)

  if (!cloudConfigured) {
    return (
      <div className="card">
        <h2>Conta e sincronização</h2>
        <p className="muted">
          A nuvem ainda não foi configurada neste app. Quando estiver, você poderá entrar com e-mail e senha e ter a
          mesma coleção no celular e no computador.
        </p>
      </div>
    )
  }

  async function submit(e: FormEvent, mode: 'in' | 'up') {
    e.preventDefault()
    setBusy(true)
    setMsg(null)
    try {
      if (mode === 'in') {
        await signIn(email.trim(), password)
        setMsg({ text: 'Você entrou. Sincronizando…', ok: true })
      } else {
        const r = await signUp(email.trim(), password)
        setMsg(
          r.needsConfirmation
            ? { text: 'Conta criada. Confirme o e-mail que enviamos e depois toque em "Entrar".', ok: true }
            : { text: 'Conta criada. Sincronizando…', ok: true },
        )
      }
    } catch (err) {
      setMsg({ text: err instanceof Error ? err.message : String(err), ok: false })
    } finally {
      setBusy(false)
    }
  }

  if (!status.ready) {
    return (
      <div className="card">
        <h2>Conta e sincronização</h2>
        <p className="muted">Carregando…</p>
      </div>
    )
  }

  if (status.user) {
    return (
      <div className="card">
        <h2>Conta e sincronização</h2>
        <dl className="kv">
          <dt>Conta</dt>
          <dd>{status.user.email ?? status.user.id}</dd>
          <dt>Situação</dt>
          <dd>
            {status.state === 'syncing' && 'Sincronizando…'}
            {status.state === 'ok' && 'Tudo sincronizado'}
            {status.state === 'offline' && 'Sem internet; sincroniza quando voltar'}
            {status.state === 'error' && `Erro: ${status.error}`}
            {status.state === 'idle' && 'Aguardando'}
          </dd>
          <dt>Última vez</dt>
          <dd>{when(status.lastSyncAt)}</dd>
        </dl>
        <div className="btn-row">
          <button className="btn primary" onClick={() => void syncNow()} disabled={status.state === 'syncing'}>
            Sincronizar agora
          </button>
          <button className="btn ghost" onClick={() => void signOut()}>
            Sair
          </button>
        </div>
        <p className="muted" style={{ marginTop: 10, fontSize: '0.8rem' }}>
          Sair não apaga nada deste aparelho. Ao entrar em outro aparelho com a mesma conta, a coleção aparece lá.
        </p>
      </div>
    )
  }

  return (
    <div className="card">
      <h2>Conta e sincronização</h2>
      <p className="muted" style={{ marginBottom: 10 }}>
        Entre para ter a mesma coleção no celular e no computador. O que já está neste aparelho é enviado para a
        nuvem na primeira sincronização.
      </p>
      {msg && <div className={`notice${msg.ok ? ' ok' : ''}`}>{msg.text}</div>}
      <form className="form" onSubmit={(e) => submit(e, 'in')}>
        <div className="field">
          <label htmlFor="acc-email">E-mail</label>
          <input id="acc-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div className="field">
          <label htmlFor="acc-pass">Senha</label>
          <input
            id="acc-pass"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={6}
            required
          />
          <span className="hint">Mínimo de 6 caracteres.</span>
        </div>
        <div className="btn-row">
          <button type="submit" className="btn primary" disabled={busy}>
            Entrar
          </button>
          <button type="button" className="btn" disabled={busy} onClick={(e) => submit(e, 'up')}>
            Criar conta
          </button>
        </div>
      </form>
    </div>
  )
}
