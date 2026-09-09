import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { AlbumCard } from '../components/AlbumCard'
import { AlbumForm, type AlbumFormData } from '../components/AlbumForm'
import { ArtistForm } from '../components/ArtistForm'
import { db } from '../db/db'
import { ALBUM_TYPES, ALBUM_TYPE_LABEL, type Album, type AlbumStatus, type AlbumType } from '../db/types'

type StatusFilter = 'all' | AlbumStatus

export function ArtistPage() {
  const { id } = useParams()
  const artistId = Number(id)
  const navigate = useNavigate()
  const [mode, setMode] = useState<'view' | 'edit' | 'add'>('view')
  const [filter, setFilter] = useState<StatusFilter>('all')

  const artist = useLiveQuery(() => db.artists.get(artistId), [artistId])
  const albums = useLiveQuery(() => db.albums.where('artistId').equals(artistId).sortBy('year'), [artistId])

  const grouped = useMemo(() => {
    if (!albums) return []
    const list = filter === 'all' ? albums : albums.filter((a) => a.status === filter)
    return ALBUM_TYPES.map((type) => ({ type, items: list.filter((a) => a.type === type) })).filter((g) => g.items.length)
  }, [albums, filter])

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

  const filters: { key: StatusFilter; label: string }[] = [
    { key: 'all', label: `Todos (${albums.length})` },
    { key: 'have', label: `Tenho (${have})` },
    { key: 'want', label: `Quero (${want})` },
    { key: 'none', label: `Faltam (${albums.length - have - want})` },
  ]

  return (
    <>
      <Link to="/" className="back">‹ Artistas</Link>

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

      {albums.length > 0 && (
        <div className="filters">
          {filters.map((f) => (
            <button key={f.key} className={`chip${filter === f.key ? ' active' : ''}`} onClick={() => setFilter(f.key)}>
              {f.label}
            </button>
          ))}
        </div>
      )}

      {albums.length === 0 ? (
        <p className="empty">Nenhum álbum cadastrado. Toque em "+ Álbum".</p>
      ) : grouped.length === 0 ? (
        <p className="empty">Nada nesse filtro.</p>
      ) : (
        grouped.map(({ type, items }) => (
          <section key={type}>
            <div className="section-title">
              <h2>{ALBUM_TYPE_LABEL[type as AlbumType]}</h2>
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
