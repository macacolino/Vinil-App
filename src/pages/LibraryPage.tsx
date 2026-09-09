import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Cover, listSources } from '../components/Cover'
import { Rarity } from '../components/Rarity'
import { db } from '../db/db'
import { ALBUM_TYPES, ALBUM_TYPE_LABEL, GRADES, type Album, type AlbumType, type Copy, type Grade } from '../db/types'
import { formatBRL, formatUSD, useUsdToBrl } from '../lib/format'

type LibrarySort = 'year' | 'rarity' | 'title' | 'paid' | 'estimated'

const SORT_LABEL: Record<LibrarySort, string> = {
  year: 'ano',
  rarity: 'mais raros',
  title: 'título',
  paid: 'valor pago',
  estimated: 'valor estimado',
}

interface Item {
  album: Album
  copy?: Copy
}

function sortItems(items: Item[], sort: LibrarySort, rate: number): Item[] {
  const est = (i: Item) => (i.album.estimatedPriceUsd ?? 0) * rate
  const paid = (i: Item) => i.copy?.pricePaidBrl ?? 0
  const byTitle = (a: Item, b: Item) => a.album.title.localeCompare(b.album.title, 'pt-BR')
  return [...items].sort((a, b) => {
    switch (sort) {
      case 'rarity':
        return b.album.rarity - a.album.rarity || a.album.year - b.album.year
      case 'title':
        return byTitle(a, b)
      case 'paid':
        return paid(b) - paid(a) || byTitle(a, b)
      case 'estimated':
        return est(b) - est(a) || byTitle(a, b)
      default:
        return a.album.year - b.album.year || byTitle(a, b)
    }
  })
}

export function LibraryPage() {
  const rate = useUsdToBrl()
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<LibrarySort>('year')
  const [showFilters, setShowFilters] = useState(false)
  const [artistFilter, setArtistFilter] = useState<number | 'all'>('all')
  const [typeFilter, setTypeFilter] = useState<AlbumType | 'all'>('all')
  const [gradeFilter, setGradeFilter] = useState<Grade | 'all'>('all')
  const [minRarity, setMinRarity] = useState(0)

  const artists = useLiveQuery(() => db.artists.orderBy('name').toArray(), [])
  const albums = useLiveQuery(() => db.albums.where('status').equals('have').toArray(), [])
  const copies = useLiveQuery(() => db.copies.toArray(), [])

  const data = useMemo(() => {
    if (!artists || !albums || !copies) return undefined
    const copyByAlbum = new Map(copies.map((c) => [c.albumId, c]))
    const artistById = new Map(artists.map((a) => [a.id!, a]))
    const q = search.trim().toLowerCase()

    const items: Item[] = albums
      .map((album) => ({ album, copy: copyByAlbum.get(album.id!) }))
      .filter(({ album, copy }) => {
        if (artistFilter !== 'all' && album.artistId !== artistFilter) return false
        if (typeFilter !== 'all' && album.type !== typeFilter) return false
        if (gradeFilter !== 'all' && copy?.mediaCondition !== gradeFilter) return false
        if (album.rarity < minRarity) return false
        if (q) {
          const artist = artistById.get(album.artistId)
          const hay = `${album.title} ${artist?.name ?? ''} ${album.year} ${album.label ?? ''}`.toLowerCase()
          if (!hay.includes(q)) return false
        }
        return true
      })

    const totalPaid = items.reduce((s, { copy }) => s + (copy?.pricePaidBrl ?? 0), 0)
    const totalEstUsd = items.reduce((s, { album }) => s + (album.estimatedPriceUsd ?? 0), 0)

    const groups = artists
      .map((artist) => ({ artist, items: sortItems(items.filter((i) => i.album.artistId === artist.id), sort, rate) }))
      .filter((g) => g.items.length)

    return { items, totalPaid, totalEstUsd, groups }
  }, [artists, albums, copies, search, artistFilter, typeFilter, gradeFilter, sort, minRarity, rate])

  if (!data) return <p className="empty">Carregando…</p>

  const activeFilters = [artistFilter !== 'all', typeFilter !== 'all', gradeFilter !== 'all', minRarity > 0].filter(Boolean).length
  const filtering = !!search || activeFilters > 0

  function clearFilters() {
    setArtistFilter('all')
    setTypeFilter('all')
    setGradeFilter('all')
    setMinRarity(0)
  }

  return (
    <>
      <div className="page-title" style={{ marginBottom: 10 }}>
        <div>
          <h1>Biblioteca</h1>
          <p className="subtitle">
            {data.items.length} {data.items.length === 1 ? 'disco' : 'discos'}
            {filtering ? ' (com filtro)' : ''} · pago {formatBRL(data.totalPaid)} · estimado {formatBRL(data.totalEstUsd * rate)}{' '}
            <span title={formatUSD(data.totalEstUsd)}>({formatUSD(data.totalEstUsd)})</span>
          </p>
        </div>
      </div>

      <input className="search" placeholder="Buscar por título, banda, ano, gravadora…" value={search} onChange={(e) => setSearch(e.target.value)} />

      <div className="toolbar toolbar-row">
        <select aria-label="Ordenar por" value={sort} onChange={(e) => setSort(e.target.value as LibrarySort)}>
          {(Object.keys(SORT_LABEL) as LibrarySort[]).map((k) => (
            <option key={k} value={k}>
              Ordenar: {SORT_LABEL[k]}
            </option>
          ))}
        </select>
        <button className={`chip${showFilters || activeFilters ? ' active' : ''}`} onClick={() => setShowFilters((v) => !v)}>
          Filtros{activeFilters ? ` (${activeFilters})` : ''}
        </button>
      </div>

      {showFilters && (
        <div className="card" style={{ marginBottom: 12 }}>
          <div className="filters" style={{ marginBottom: 0 }}>
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
            <select aria-label="Raridade mínima" value={minRarity} onChange={(e) => setMinRarity(Number(e.target.value))}>
              <option value={0}>Raridade: todas</option>
              <option value={3}>Raridade: ★★★ ou mais</option>
              <option value={4}>Raridade: ★★★★ ou mais</option>
              <option value={5}>Raridade: ★★★★★</option>
            </select>
            {activeFilters > 0 && (
              <button className="btn ghost small" onClick={clearFilters}>
                Limpar
              </button>
            )}
          </div>
        </div>
      )}

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
                  <Cover sources={listSources(album)} alt={album.title} size="small" />
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
