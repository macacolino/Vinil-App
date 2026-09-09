import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, HashRouter } from 'react-router-dom'
import { registerSW } from 'virtual:pwa-register'
import App from './App'
import { db, onDbBlocked } from './db/db'
import './styles.css'

/**
 * VITE_STATIC_DEMO=1 gera uma versão para hospedagem estática simples (demo):
 * rotas com "#" na URL e sem service worker. O app normal usa rotas limpas + PWA.
 */
const isStaticDemo = import.meta.env.VITE_STATIC_DEMO === '1'

if (!isStaticDemo) {
  // Service worker: deixa o app funcionar offline e se atualiza sozinho.
  registerSW({ immediate: true })
}

// BASE_URL vem do "base" do vite.config.ts (ex.: "/main/" no GitHub Pages).
const router = isStaticDemo ? (
  <HashRouter>
    <App />
  </HashRouter>
) : (
  <BrowserRouter basename={import.meta.env.BASE_URL}>
    <App />
  </BrowserRouter>
)

const root = createRoot(document.getElementById('root')!)

/** Tela de erro quando o banco local não abre (ex.: atualização de versão falhou). */
function DbError({ error }: { error: unknown }) {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  return (
    <main className="app-main">
      <h1>Não consegui abrir os dados do app</h1>
      <p className="muted" style={{ margin: '12px 0' }}>
        Seus discos continuam salvos neste aparelho; o app só não conseguiu ler o banco agora. Tente recarregar. Se
        continuar, copie a mensagem abaixo e mande para quem cuida do app.
      </p>
      <pre className="card" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: '0.8rem' }}>{message}</pre>
      <div className="btn-row">
        <button className="btn primary" onClick={() => window.location.reload()}>
          Recarregar
        </button>
      </div>
    </main>
  )
}

/** Aviso enquanto outra aba/janela do app segura o banco durante uma atualização. */
function DbBlocked() {
  return (
    <main className="app-main">
      <h1>Atualizando o app…</h1>
      <p className="muted" style={{ margin: '12px 0' }}>
        Outra aba ou janela do Vinil ainda está aberta com a versão antiga. Feche as outras abas (ou espere alguns
        segundos: elas recarregam sozinhas) e esta tela segue automaticamente.
      </p>
      <div className="btn-row">
        <button className="btn primary" onClick={() => window.location.reload()}>
          Recarregar
        </button>
      </div>
    </main>
  )
}

// Abre o banco antes de mostrar o app: se a migração falhar, mostra o erro
// em vez de deixar tudo em "Carregando…" para sempre; se outra aba estiver
// segurando o banco, explica o que fazer.
let opened = false
const stopBlocked = onDbBlocked(() => {
  if (!opened) root.render(<DbBlocked />)
})
const slowTimer = setTimeout(() => {
  if (!opened) root.render(<DbBlocked />)
}, 6000)

db.open()
  .then(() => {
    opened = true
    clearTimeout(slowTimer)
    stopBlocked()
    root.render(<StrictMode>{router}</StrictMode>)
  })
  .catch((error: unknown) => {
    clearTimeout(slowTimer)
    console.error('Falha ao abrir o banco local', error)
    root.render(<DbError error={error} />)
  })
