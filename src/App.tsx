import { useEffect } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout'
import { AlbumPage } from './pages/AlbumPage'
import { ArtistPage } from './pages/ArtistPage'
import { ArtistsPage } from './pages/ArtistsPage'
import { LibraryPage } from './pages/LibraryPage'
import { SettingsPage } from './pages/SettingsPage'
import { resumePendingJobs } from './lib/jobs'

export default function App() {
  // Retoma importações e buscas de faixas interrompidas (app fechado no meio).
  useEffect(() => {
    void resumePendingJobs()
  }, [])
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<ArtistsPage />} />
        <Route path="/artistas/:id" element={<ArtistPage />} />
        <Route path="/albuns/:id" element={<AlbumPage />} />
        <Route path="/biblioteca" element={<LibraryPage />} />
        <Route path="/configuracoes" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
