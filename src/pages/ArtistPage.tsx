import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { AlbumCard } from '../components/AlbumCard'
import { Cover } from '../components/Cover'
import { AlbumForm, type AlbumFormData } from '../components/AlbumForm'
import { DiscogsMasterPicker } from '../components/DiscogsMasterPicker'
import { ArtistForm } from '../components/ArtistForm'
import { SortFilter, sortAlbums, type SortKey } from '../components/SortFilter'
import { db } from '../db/db'
import { deleteArtistWithAlbums, uniqueUid } from '../db/ops'
import { albumUid } from '../db/uid'
import { ALBUM_TYPES, ALBUM_TYPE_LABEL, type Album, type AlbumStatus } from '../db/types'
import { createAlbumFromMaster, needsTracks } from '../lib/importArtist'
import { activeJobFor, cancelJob, enqueueImport, enqueuePrices, enqueueTracks, useJobs } from '../lib/jobs'
import { needsPricing } from '../lib/pricing'

type StatusFilter = 'all' | AlbumStatus

interface ImportState {
  alreadyExisted?: boolean
}

export function ArtistPage() {
  const { id } = useParams()
  const artistId = Number(id)
  const navigate = useNavigate()
  const location = useLocation()
  const importState = (location.state as ImportState | null) ?? null
  const [mode, setMode] = useState<'view' | 'edit' | 'add' | 'addManual'>('view')
  const [filter, setFilter] = useState<StatusFilter>('all')
  const [sort, setSort] = useState<SortKey>('year')
  const [minRarity, setMinRarity] = useState(0)
  const jobs = useJobs()
  const importJob = activeJobFor(jobs, artistId, 'import')
  const job = activeJobFor(jobs, artistId, 'tracks')
  const pricesJob = activeJobFor(jobs, artistId, 'prices')
  const lastImport = jobs.find((j) => j.artistId === artistId && j.kind === 'import' && j.status === 'done')

  const artist = useLiveQuery(() => db.artists.get(artistId), [artistId])
  const albums = useLiveQuery(() => db.albums.where('artistId').equals(artistId).toArray(), [artistId])

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
  const pendingPrices = albums.filter(needsPricing).length

  async function saveArtist(data: { name: string; country?: string; notes?: string; imageUrl?: string; imageSource?: 'manual' | 'discogs' }) {
    await db.artists.update(artistId, { ...data, imageCheckedAt: data.imageUrl ? artist!.imageCheckedAt : undefined, updatedAt: Date.now() })
    setMode('view')
  }

  async function addAlbum(data: AlbumFormData) {
    const now = Date.now()
    const album: Album = { ...data, uid: await uniqueUid('albums', albumUid(data, artist!.uid)), artistId, status: 'none', createdAt: now, updatedAt: now }
    const newId = await db.albums.add(album)
    setMode('view')
    navigate(`/albuns/${newId}`)
  }

  async function removeArtist() {
    const msg = `Apagar "${artist!.name}" e todos os seus ${albums!.length} álbuns (incluindo os dados das suas cópias)? Isso não pode ser desfeito.`
    if (!window.confirm(msg)) return
    await deleteArtistWithAlbums(artistId)
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

      {importState?.alreadyExisted && !importJob && !lastImport && (
        <div className="notice">{artist.name} já estava cadastrado.</div>
      )}
      {lastImport?.result && (
        <div className="notice ok">
          Discografia conferida no MusicBrainz: {lastImport.result.total} álbuns
          {lastImport.result.added ? `, ${lastImport.result.added} novos` : ''}
          {lastImport.result.removed ? `, ${lastImport.result.removed} removidos por não terem edição em vinil` : ''}.
          {lastImport.result.usedFallback ? ' O MusicBrainz não tem dados de formato para este artista; a lista completa foi usada.' : ''}{' '}
          As faixas vêm em segundo plano.
        </div>
      )}

      {mode === 'edit' ? (
        <div className="card">
          <h2>Editar artista</h2>
          <ArtistForm initial={artist} onSave={saveArtist} onCancel={() => setMode('view')} />
          <hr className="hr" />
          {artist.mbid && (
            <div style={{ marginBottom: 12 }}>
              <button
                className="btn small"
                disabled={!!importJob}
                onClick={() => {
                  enqueueImport(artistId, artist.name, true)
                  setMode('view')
                }}
              >
                Revisar discografia no MusicBrainz
              </button>
              <p className="muted" style={{ marginTop: 6, fontSize: '0.8rem' }}>
                Refaz a lista mantendo só lançamentos oficiais com edição em vinil. Álbuns marcados como "tenho" ou "quero" nunca são removidos.
              </p>
            </div>
          )}
          <button className="btn danger small" onClick={removeArtist}>
            Apagar artista e álbuns
          </button>
        </div>
      ) : (
        <div className="page-title artist-header">
          <div className="artist-photo">
            <Cover sources={[artist.imageUrl]} alt={artist.name} />
          </div>
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
          <div className="page-title" style={{ marginBottom: 8 }}>
            <h2 style={{ marginBottom: 0 }}>Novo álbum</h2>
            <span className="spacer" />
            <button className="btn ghost small" onClick={() => setMode('addManual')}>
              Cadastrar à mão
            </button>
          </div>
          <DiscogsMasterPicker
            artistName={artist.name}
            actionLabel="Adicionar"
            onCancel={() => setMode('view')}
            onPick={async (c) => {
              const id = await createAlbumFromMaster(artist, c)
              setMode('view')
              navigate(`/albuns/${id}`)
            }}
          />
        </div>
      )}
      {mode === 'addManual' && (
        <div className="card">
          <h2>Novo álbum (à mão)</h2>
          <AlbumForm onSave={addAlbum} onCancel={() => setMode('view')} />
        </div>
      )}

      {(pendingTracks > 0 || job) && mode === 'view' && (
        <div className="card" style={{ marginBottom: 12 }}>
          {job ? (
            <>
              <div className="progress-line" style={{ marginTop: 0 }}>
                <span className="spinner" />
                {job.status === 'queued'
                  ? 'Na fila para buscar faixas…'
                  : `Buscando faixas em segundo plano… ${job.done} de ${job.total || pendingTracks}`}
              </div>
              <div className="progress">
                <div style={{ width: `${(job.done / Math.max(1, job.total)) * 100}%` }} />
              </div>
              <p className="muted" style={{ marginTop: 8, fontSize: '0.8rem' }}>
                Pode continuar usando o app; a busca segue mesmo trocando de tela.
              </p>
              <div className="btn-row">
                <button className="btn ghost small" onClick={() => cancelJob(job.id)}>Parar</button>
              </div>
            </>
          ) : (
            <div className="page-title" style={{ marginBottom: 0 }}>
              <p className="muted">
                {pendingTracks} álbum(ns) ainda sem faixas. Leva cerca de {Math.ceil((pendingTracks * 2.5) / 60)} min, em segundo plano.
              </p>
              <span className="spacer" />
              <button className="btn small" onClick={() => enqueueTracks(artistId, artist.name)}>
                Buscar faixas de todos
              </button>
            </div>
          )}
        </div>
      )}

      {pendingTracks === 0 && !job && (pendingPrices > 0 || pricesJob) && mode === 'view' && (
        <div className="card" style={{ marginBottom: 12 }}>
          {pricesJob ? (
            <>
              <div className="progress-line" style={{ marginTop: 0 }}>
                <span className="spinner" />
                {pricesJob.status === 'queued'
                  ? 'Na fila para consultar preços…'
                  : `Consultando preços e raridade no Discogs… ${pricesJob.done} de ${pricesJob.total || pendingPrices}`}
              </div>
              <div className="progress">
                <div style={{ width: `${(pricesJob.done / Math.max(1, pricesJob.total)) * 100}%` }} />
              </div>
              <div className="btn-row">
                <button className="btn ghost small" onClick={() => cancelJob(pricesJob.id)}>Parar</button>
              </div>
            </>
          ) : (
            <div className="page-title" style={{ marginBottom: 0 }}>
              <p className="muted">
                {pendingPrices} álbum(ns) sem preço/raridade do Discogs. Leva cerca de {Math.ceil((pendingPrices * 8) / 60)} min, em segundo plano.
              </p>
              <span className="spacer" />
              <button className="btn small" onClick={() => enqueuePrices(artistId, artist.name)}>
                Consultar preços
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

      {importJob && (
        <div className="card" style={{ marginBottom: 12 }}>
          <div className="progress-line" style={{ marginTop: 0 }}>
            <span className="spinner" />
            {importJob.status === 'queued' ? 'Na fila para importar a discografia…' : `Importando discografia… ${importJob.detail ?? ''}`}
          </div>
          <p className="muted" style={{ marginTop: 8, fontSize: '0.8rem' }}>
            Pode continuar usando o app; os álbuns aparecem aqui quando terminar.
          </p>
        </div>
      )}

      {albums.length === 0 ? (
        !importJob && <p className="empty">Nenhum álbum cadastrado. Toque em "+ Álbum".</p>
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
