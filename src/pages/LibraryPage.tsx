import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Cover, smallCover } from '../components/Cover'
import { Rarity } from '../components/Rarity'
import { SortFilter, sortAlbums, type SortKey } from '../components/SortFilter'
import { db } from '../db/db'
import { ALBUM_TYPES, ALBUM_TYPE_LABEL, GRADES, type AlbumType, type Grade } from '../db/types'
import { formatBRL, formatUSD, useUsdToBrl } from '../lib/format'

export function LibraryPage() {
  const rate = useUsdToBrl()
  const [search, setSearch] = useState('')
  const [artistFilter, setArtistFilter] = useState<number | 'all'>('all')
  const [typeFilter, setTypeFilter] = useState<AlbumType | 'all'>('all')
  const [gradeFilter, setGradeFilter] = useState<Grade | 'all'>('all')
  const [sort, setSort] = useState<SortKey>('year')
  const [minRarity, setMinRarity] = useState(0)

  const artists = useLiveQuery(() => db.artists.orderBy('name').toArray(), [])
  const albums = useLiveQuery(() => db.albums.where('status').equals('have').toArray(), [])
  const copies = useLiveQuery(() => db.copies.toArray(), [])

  const data = useMemo(() => {
    if (!artists || !albums || !copies) return undefined
    const copyByAlbum = new Map(copies.map((c) => [c.albumId, c]))
    const artistById = new Map(artists.map((a) => [a.id!, a]))
    const q = search.trim().toLowerCase()

    const items = albums
      .map((album) => ({ album, copy: copyByAlbum.get(album.id!), artist: artistById.get(album.artistId) }))
      .filter(({ album, copy, artist }) => {
        if (artistFilter !== 'all' && album.artistId !== artistFilter) return false
        if (typeFilter !== 'all' && album.type !== typeFilter) return false
        if (gradeFilter !== 'all' && copy?.mediaCondition !== gradeFilter) return false
        if (album.rarity < minRarity) return false
        if (q) {
          const hay = `${album.title} ${artist?.name ?? ''} ${album.year} ${album.label ?? ''}`.toLowerCase()
          if (!hay.includes(q)) return false
        }
        return true
      })

    const totalPaid = items.reduce((s, { copy }) => s + (copy?.pricePaidBrl ?? 0), 0)
    const totalEstUsd = items.reduce((s, { album }) => s + (album.estimatedPriceUsd ?? 0), 0)

    const groups = artists
      .map((artist) => ({
        artist,
        items: sortAlbums(
          items.filter((i) => i.album.artistId === artist.id),
          sort,
          (i) => i.album,
        ),
      }))
      .filter((g) => g.items.length)

    return { items, totalPaid, totalEstUsd, groups }
  }, [artists, albums, copies, search, artistFilter, typeFilter, gradeFilter, sort, minRarity])

  if (!data) return <p className="empty">Carregando…</p>

  const filtering = search || artistFilter !== 'all' || typeFilter !== 'all' || gradeFilter !== 'all' || minRarity > 0

  return (
    <>
      <div className="page-title">
        <div>
          <h1>Biblioteca</h1>
          <p className="subtitle">Tudo que você tem, por banda</p>
        </div>
      </div>

      <div className="stats">
        <div className="stat">
          <div className="label">Discos{filtering ? ' (filtro)' : ''}</div>
          <div className="value">{data.items.length}</div>
        </div>
        <div className="stat">
          <div className="label">Valor pago</div>
          <div className="value">{formatBRL(data.totalPaid)}</div>
        </div>
        <div className="stat">
          <div className="label">Valor estimado</div>
          <div className="value">{formatBRL(data.totalEstUsd * rate)}</div>
          <div className="label">{formatUSD(data.totalEstUsd)}</div>
        </div>
      </div>

      <input className="search" placeholder="Buscar por título, banda, ano, gravadora…" value={search} onChange={(e) => setSearch(e.target.value)} />

      <div className="filters">
        <select value={artistFilter} onChange={(e) => setArtistFilter(e.target.value === 'all' ? 'all' : Number(e.target.value))}>
          <option value="all">Todas as bandas</option>
          {artists!.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as AlbumType | 'all')}>
          <option value="all">Todos os tipos</option>
          {ALBUM_TYPES.map((t) => (
            <option key={t} value={t}>
              {ALBUM_TYPE_LABEL[t]}
            </option>
          ))}
        </select>
        <select value={gradeFilter} onChange={(e) => setGradeFilter(e.target.value as Grade | 'all')}>
          <option value="all">Qualquer condição</option>
          {GRADES.map((g) => (
            <option key={g} value={g}>
              Disco {g}
            </option>
          ))}
        </select>
      </div>
      <SortFilter sort={sort} onSort={setSort} minRarity={minRarity} onMinRarity={setMinRarity} />

      {data.groups.length === 0 ? (
        <p className="empty">
          {albums!.length === 0
            ? 'Você ainda não marcou nenhum disco como "Tenho". Abra um álbum e toque em "✓ Tenho".'
            : 'Nada encontrado com esses filtros.'}
        </p>
      ) : (
        data.groups.map(({ artist, items }) => (
          <section key={artist.id}>
            <div className="section-title">
              <h2>
                <Link to={`/artistas/${artist.id}`}>{artist.name}</Link>
              </h2>
              <span className="count">
                {items.length} · pago {formatBRL(items.reduce((s, i) => s + (i.copy?.pricePaidBrl ?? 0), 0))}
              </span>
            </div>
            <div className="list">
              {items.map(({ album, copy }) => (
                <Link key={album.id} to={`/albuns/${album.id}`} className="list-item">
                  <Cover src={smallCover(album.coverUrl)} fallbackSrc={album.discogsThumb} alt={album.title} size="small" />
                  <div className="grow">
                    <div className="name">
                      <span>{album.title}</span>
                      <Rarity value={album.rarity} size="small" />
                    </div>
                    <div className="meta">
                      {album.year || 's/ ano'} · {ALBUM_TYPE_LABEL[album.type]}
                      {copy?.mediaCondition ? ` · ${copy.mediaCondition}/${copy.sleeveCondition ?? '—'}` : ''}
                      {copy?.pricePaidBrl != null ? ` · ${formatBRL(copy.pricePaidBrl)}` : ''}
                    </div>
                  </div>
                  <span className="chevron">›</span>
                </Link>
              ))}
            </div>
          </section>
        ))
      )}
    </>
  )
}
