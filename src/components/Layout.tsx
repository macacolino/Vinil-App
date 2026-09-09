import { useEffect, useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { useJobs } from '../lib/jobs'
import { useSyncStatus } from '../lib/sync'
import { JobsBar } from './JobsBar'
import { ScrollManager } from './ScrollManager'

function useOnline() {
  const [online, setOnline] = useState(navigator.onLine)
  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])
  return online
}

export function Layout() {
  const online = useOnline()
  const jobs = useJobs()
  const sync = useSyncStatus()
  const cloudText = !sync.user
    ? ''
    : sync.state === 'syncing'
      ? '☁ sincronizando…'
      : sync.state === 'error'
        ? '☁ erro ao sincronizar'
        : sync.state === 'offline'
          ? '☁ aguardando internet'
          : '☁ sincronizado'
  return (
    <>
      <ScrollManager />
      <header className="app-header">
        <NavLink to="/" className="brand">
          <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" />
          Vinil
        </NavLink>
        <span className={`status${online ? '' : ' offline'}`}>{online ? cloudText : 'offline'}</span>
      </header>
      <main className="app-main" style={jobs.length ? { paddingBottom: `calc(var(--nav-h) + 24px + ${jobs.length * 56}px)` } : undefined}>
        <Outlet />
      </main>
      <JobsBar />
      <nav className="app-nav">
        <NavLink to="/" end className={({ isActive }) => (isActive ? 'active' : '')}>
          <span className="icon">🎸</span>
          Artistas
        </NavLink>
        <NavLink to="/biblioteca" className={({ isActive }) => (isActive ? 'active' : '')}>
          <span className="icon">📀</span>
          Biblioteca
        </NavLink>
        <NavLink to="/configuracoes" className={({ isActive }) => (isActive ? 'active' : '')}>
          <span className="icon">⚙️</span>
          Configurações
        </NavLink>
      </nav>
    </>
  )
}
