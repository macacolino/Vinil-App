import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArtistSearch } from '../components/ArtistSearch'
import { db } from '../db/db'

export function ArtistsPage() {
  const [adding, setAdding] = useState(false)
  const [search, setSearch] = useState('')

  const artists = useLiveQuery(() => db.artists.orderBy('name').toArray(), [])
  const albums = useLiveQuery(() => db.albums.toArray(), [])

  const rows = useMemo(() => {
    if (!artists || !albums) return undefined
    const byArtist = new Map<number, { total: number; have: number; want: number }>()
    for (const a of albums) {
      const c = byArtist.get(a.artistId) ?? { total: 0, have: 0, want: 0 }
      c.total += 1
      if (a.status === 'have') c.have += 1
      if (a.status === 'want') c.want += 1
      byArtist.set(a.artistId, c)
    }
    const q = search.trim().toLowerCase()
    return artists
      .filter((ar) => !q || ar.name.toLowerCase().includes(q))
      .map((ar) => ({ artist: ar, ...(byArtist.get(ar.id!) ?? { total: 0, have: 0, want: 0 }) }))
  }, [artists, albums, search])

  const totalHave = rows?.reduce((s, r) => s + r.have, 0) ?? 0
  const totalAlbums = rows?.reduce((s, r) => s + r.total, 0) ?? 0

  return (
    <>
      <div className="page-title">
        <div>
          <h1>Artistas</h1>
          <p className="subtitle">
            Tenho {totalHave} de {totalAlbums} discos
          </p>
        </div>
        <span className="spacer" />
        {!adding && (
          <button className="btn primary" onClick={() => setAdding(true)}>
            + Artista
          </button>
        )}
      </div>

      {adding && <ArtistSearch onClose={() => setAdding(false)} />}

      {rows && rows.length > 3 && (
        <input className="search" placeholder="Filtrar meus artistas…" value={search} onChange={(e) => setSearch(e.target.value)} />
      )}

      {rows === undefined ? (
        <p className="empty">Carregando…</p>
      ) : rows.length === 0 ? (
        <p className="empty">Nenhum artista ainda. Toque em "+ Artista" para começar.</p>
      ) : (
        <div className="list">
          {rows.map(({ artist, total, have, want }) => (
            <Link key={artist.id} to={`/artistas/${artist.id}`} className="list-item">
              <div className="grow">
                <div className="name">{artist.name}</div>
                <div className="meta">
                  Tenho {have} de {total}
                  {want > 0 ? ` · quero ${want}` : ''}
                </div>
                <div className="progress">
                  <div style={{ width: total ? `${(have / total) * 100}%` : 0 }} />
                </div>
              </div>
              <span className="chevron">›</span>
            </Link>
          ))}
        </div>
      )}
    </>
  )
}
