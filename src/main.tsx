import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, HashRouter } from 'react-router-dom'
import { registerSW } from 'virtual:pwa-register'
import App from './App'
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

const Router = isStaticDemo ? HashRouter : BrowserRouter

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Router>
      <App />
    </Router>
  </StrictMode>,
)
