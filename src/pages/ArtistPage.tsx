import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { AlbumCard } from '../components/AlbumCard'
import { AlbumForm, type AlbumFormData } from '../components/AlbumForm'
import { ArtistForm } from '../components/ArtistForm'
import { SortFilter, sortAlbums, type SortKey } from '../components/SortFilter'
import { db } from '../db/db'
import { ALBUM_TYPES, ALBUM_TYPE_LABEL, type Album, type AlbumStatus } from '../db/types'
import { loadAlbumTracks, needsTracks } from '../lib/importArtist'

type StatusFilter = 'all' | AlbumStatus

interface ImportState {
  imported?: number
  alreadyExisted?: boolean
}

export function ArtistPage() {
  const { id } = useParams()
  const artistId = Number(id)
  const navigate = useNavigate()
  const location = useLocation()
  const importState = (location.state as ImportState | null) ?? null
  const [mode, setMode] = useState<'view' | 'edit' | 'add'>('view')
  const [filter, setFilter] = useState<StatusFilter>('all')
  const [sort, setSort] = useState<SortKey>('year')
  const [minRarity, setMinRarity] = useState(0)
  const [tracksProgress, setTracksProgress] = useState<{ done: number; total: number; error?: string } | null>(null)
  const cancelTracks = useRef(false)

  const artist = useLiveQuery(() => db.artists.get(artistId), [artistId])
  const albums = useLiveQuery(() => db.albums.where('artistId').equals(artistId).toArray(), [artistId])

  useEffect(() => () => void (cancelTracks.current = true), [])

  const grouped = useMemo(() => {
    if (!albums) return []
    const list = albums.filter((a) => (filter === 'all' || a.status === filter) && a.rarity >= minRarity)
    return ALBUM_TYPES.map((type) => ({
      type,
      items: sortAlbums(
        list.filter((a) => a.type === type),
        sort,
        (a) => a,
      ),
    })).filter((g) => g.items.length)
  }, [albums, filter, sort, minRarity])

  if (artist === undefined || albums === undefined) return <p className="empty">Carregando…</p>
  if (artist === null) {
    return (
      <>
        <Link to="/" className="back">‹ Artistas</Link>
        <p className="empty">Artista não encontrado.</p>
      </>
    )
  }

  const have = albums.filter((a) => a.status === 'have').length
  const want = albums.filter((a) => a.status === 'want').length
  const pendingTracks = albums.filter(needsTracks).length

  async function saveArtist(data: { name: string; country?: string; notes?: string }) {
    await db.artists.update(artistId, { ...data, updatedAt: Date.now() })
    setMode('view')
  }

  async function addAlbum(data: AlbumFormData) {
    const now = Date.now()
    const album: Album = { ...data, artistId, status: 'none', createdAt: now, updatedAt: now }
    const newId = await db.albums.add(album)
    setMode('view')
    navigate(`/albuns/${newId}`)
  }

  async function removeArtist() {
    const msg = `Apagar "${artist!.name}" e todos os seus ${albums!.length} álbuns (incluindo os dados das suas cópias)? Isso não pode ser desfeito.`
    if (!window.confirm(msg)) return
    await db.transaction('rw', db.artists, db.albums, db.copies, async () => {
      const ids = albums!.map((a) => a.id!)
      await db.copies.where('albumId').anyOf(ids).delete()
      await db.albums.bulkDelete(ids)
      await db.artists.delete(artistId)
    })
    navigate('/')
  }

  /** Busca as faixas de todos os álbuns importados que ainda não têm, um por vez. */
  async function fetchAllTracks() {
    const pending = albums!.filter(needsTracks)
    cancelTracks.current = false
    setTracksProgress({ done: 0, total: pending.length })
    let done = 0
    for (const album of pending) {
      if (cancelTracks.current) return
      try {
        await loadAlbumTracks(album, artist!.countryCode)
      } catch (err) {
        setTracksProgress({ done, total: pending.length, error: err instanceof Error ? err.message : String(err) })
        return
      }
      done += 1
      setTracksProgress({ done, total: pending.length })
    }
    setTracksProgress(null)
  }

  const filters: { key: StatusFilter; label: string }[] = [
    { key: 'all', label: `Todos (${albums.length})` },
    { key: 'have', label: `Tenho (${have})` },
    { key: 'want', label: `Quero (${want})` },
    { key: 'none', label: `Faltam (${albums.length - have - want})` },
  ]

  return (
    <>
      <Link to="/" className="back">‹ Artistas</Link>

      {importState?.imported != null && (
        <div className="notice ok">
          {importState.alreadyExisted
            ? `${artist.name} já estava cadastrado. ${importState.imported} álbum(ns) novo(s) adicionado(s).`
            : `${importState.imported} álbuns importados do MusicBrainz.`}{' '}
          As faixas são carregadas quando você abre cada álbum, ou todas de uma vez pelo botão abaixo.
        </div>
      )}

      {mode === 'edit' ? (
        <div className="card">
          <h2>Editar artista</h2>
          <ArtistForm initial={artist} onSave={saveArtist} onCancel={() => setMode('view')} />
          <hr className="hr" />
          <button className="btn danger small" onClick={removeArtist}>
            Apagar artista e álbuns
          </button>
        </div>
      ) : (
        <div className="page-title">
          <div>
            <h1>{artist.name}</h1>
            <p className="subtitle">
              Tenho {have} de {albums.length}
              {artist.country ? ` · ${artist.country}` : ''}
            </p>
          </div>
          <span className="spacer" />
          <div className="actions">
            <button className="btn small" onClick={() => setMode('edit')}>
              Editar
            </button>
            <button className="btn primary small" onClick={() => setMode('add')}>
              + Álbum
            </button>
          </div>
        </div>
      )}

      {artist.notes && mode === 'view' && <p className="muted" style={{ marginBottom: 12 }}>{artist.notes}</p>}

      {mode === 'add' && (
        <div className="card">
          <h2>Novo álbum</h2>
          <AlbumForm onSave={addAlbum} onCancel={() => setMode('view')} />
        </div>
      )}

      {pendingTracks > 0 && mode === 'view' && (
        <div className="card" style={{ marginBottom: 12 }}>
          {tracksProgress ? (
            <>
              <div className="progress-line" style={{ marginTop: 0 }}>
                {!tracksProgress.error && <span className="spinner" />}
                {tracksProgress.error
                  ? `Parou em ${tracksProgress.done} de ${tracksProgress.total}: ${tracksProgress.error}`
                  : `Buscando faixas… ${tracksProgress.done} de ${tracksProgress.total}`}
              </div>
              <div className="progress">
                <div style={{ width: `${(tracksProgress.done / Math.max(1, tracksProgress.total)) * 100}%` }} />
              </div>
              <div className="btn-row">
                {tracksProgress.error ? (
                  <button className="btn small" onClick={fetchAllTracks}>Tentar de novo</button>
                ) : (
                  <button className="btn ghost small" onClick={() => { cancelTracks.current = true; setTracksProgress(null) }}>
                    Parar
                  </button>
                )}
              </div>
            </>
          ) : (
            <div className="page-title" style={{ marginBottom: 0 }}>
              <p className="muted">
                {pendingTracks} álbum(ns) ainda sem faixas. Leva cerca de {Math.ceil((pendingTracks * 2.5) / 60)} min.
              </p>
              <span className="spacer" />
              <button className="btn small" onClick={fetchAllTracks}>
                Buscar faixas de todos
              </button>
            </div>
          )}
        </div>
      )}

      {albums.length > 0 && (
        <>
          <div className="filters">
            {filters.map((f) => (
              <button key={f.key} className={`chip${filter === f.key ? ' active' : ''}`} onClick={() => setFilter(f.key)}>
                {f.label}
              </button>
            ))}
          </div>
          <SortFilter sort={sort} onSort={setSort} minRarity={minRarity} onMinRarity={setMinRarity} />
        </>
      )}

      {albums.length === 0 ? (
        <p className="empty">Nenhum álbum cadastrado. Toque em "+ Álbum".</p>
      ) : grouped.length === 0 ? (
        <p className="empty">Nada nesse filtro.</p>
      ) : (
        grouped.map(({ type, items }) => (
          <section key={type}>
            <div className="section-title">
              <h2>{ALBUM_TYPE_LABEL[type]}</h2>
              <span className="count">{items.length}</span>
            </div>
            <div className="grid">
              {items.map((album) => (
                <AlbumCard key={album.id} album={album} />
              ))}
            </div>
          </section>
        ))
      )}
    </>
  )
}
