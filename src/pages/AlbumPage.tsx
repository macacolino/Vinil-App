import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { AlbumForm, type AlbumFormData } from '../components/AlbumForm'
import { CopyForm, type CopyFormData } from '../components/CopyForm'
import { Cover } from '../components/Cover'
import { Rarity } from '../components/Rarity'
import { db } from '../db/db'
import { deleteAlbums, deleteCopyForAlbum } from '../db/ops'
import { copyUid } from '../db/uid'
import { ALBUM_TYPE_LABEL, GRADE_LABEL, type Album, type AlbumStatus } from '../db/types'
import { formatBRL, formatDate, formatDuration, formatUSD, useUsdToBrl } from '../lib/format'
import { loadAlbumTracks, needsTracks } from '../lib/importArtist'
import { needsPricing, updateAlbumPricing } from '../lib/pricing'
import { releaseUrl } from '../lib/discogs'
import { RARITY_LABEL } from '../db/types'

export function AlbumPage() {
  const { id } = useParams()
  const albumId = Number(id)
  const navigate = useNavigate()
  const rate = useUsdToBrl()
  const [editing, setEditing] = useState(false)
  const [editingCopy, setEditingCopy] = useState(false)
  const [tracksState, setTracksState] = useState<'idle' | 'loading' | 'error' | 'empty'>('idle')
  const [tracksError, setTracksError] = useState<string | null>(null)
  const [priceState, setPriceState] = useState<'idle' | 'loading' | 'error' | 'notfound'>('idle')
  const [priceError, setPriceError] = useState<string | null>(null)
  const autoPricedFor = useRef<number | null>(null)

  const album = useLiveQuery(() => db.albums.get(albumId), [albumId])
  const artist = useLiveQuery(() => (album ? db.artists.get(album.artistId) : undefined), [album?.artistId])
  const copy = useLiveQuery(() => db.copies.where('albumId').equals(albumId).first(), [albumId])

  const shouldFetchTracks = !!album && needsTracks(album) && artist !== undefined
  const artistCountryCode = artist?.countryCode

  async function fetchTracksNow(force = false) {
    if (!album || !album.mbid) return
    setTracksState('loading')
    setTracksError(null)
    try {
      const n = await loadAlbumTracks(force ? { ...album, tracksCheckedAt: undefined } : album, artistCountryCode)
      setTracksState(n > 0 ? 'idle' : 'empty')
    } catch (err) {
      setTracksState('error')
      setTracksError(err instanceof Error ? err.message : String(err))
    }
  }

  // Álbum importado sem faixas: busca no MusicBrainz ao abrir a página (uma vez).
  useEffect(() => {
    if (shouldFetchTracks && tracksState === 'idle') void fetchTracksNow()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldFetchTracks, album?.id])

  async function fetchPricingNow(force = false) {
    if (!album || !artist) return
    setPriceState('loading')
    setPriceError(null)
    try {
      const r = await updateAlbumPricing(force ? { ...album, discogsCheckedAt: undefined } : album, artist.name, 'high')
      setPriceState(r.found ? 'idle' : 'notfound')
    } catch (err) {
      setPriceState('error')
      setPriceError(err instanceof Error ? err.message : String(err))
    }
  }

  // Preço/raridade do Discogs desatualizados (ou nunca consultados): atualiza ao abrir.
  const shouldFetchPricing = !!album && !!artist && needsPricing(album) && navigator.onLine
  useEffect(() => {
    if (shouldFetchPricing && priceState === 'idle' && autoPricedFor.current !== album!.id) {
      autoPricedFor.current = album!.id!
      void fetchPricingNow()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldFetchPricing, album?.id])

  if (album === undefined) return <p className="empty">Carregando…</p>
  if (album === null) return <p className="empty">Álbum não encontrado.</p>

  async function setStatus(status: AlbumStatus) {
    if (status === album!.status) return
    const hasCopyData = copy && Object.entries(copy).some(([k, v]) => !['id', 'albumId', 'createdAt', 'updatedAt'].includes(k) && v != null && v !== '')
    if (album!.status === 'have' && status !== 'have' && hasCopyData) {
      if (!window.confirm('Isso apaga os dados da sua cópia (prensagem, condição, valor pago…). Continuar?')) return
    }
    await db.albums.update(albumId, { status, updatedAt: Date.now() })
    if (status !== 'have') await deleteCopyForAlbum(albumId)
    if (status === 'have' && !copy) setEditingCopy(true)
  }

  async function saveAlbum(data: AlbumFormData) {
    // Se o usuário mudou preço ou raridade à mão, o Discogs não sobrescreve mais.
    const patch: Partial<Album> = { ...data, updatedAt: Date.now() }
    if (data.rarity !== album!.rarity) patch.raritySource = 'manual'
    if ((data.estimatedPriceUsd ?? null) !== (album!.estimatedPriceUsd ?? null)) patch.priceSource = 'manual'
    await db.albums.update(albumId, patch)
    setEditing(false)
  }

  async function saveCopy(data: CopyFormData) {
    const now = Date.now()
    if (copy?.id) {
      await db.copies.update(copy.id, { ...data, updatedAt: now })
    } else {
      await db.copies.add({ ...data, uid: copyUid(album!.uid), albumId, createdAt: now, updatedAt: now })
    }
    setEditingCopy(false)
  }

  async function removeAlbum() {
    if (!window.confirm(`Apagar "${album!.title}"? Isso não pode ser desfeito.`)) return
    await deleteAlbums([albumId])
    navigate(`/artistas/${album!.artistId}`)
  }

  const priceUsd = album.estimatedPriceUsd
  const priceBrl = priceUsd != null ? priceUsd * rate : undefined

  return (
    <>
      <Link to={`/artistas/${album.artistId}`} className="back">
        ‹ {artist?.name ?? 'Artista'}
      </Link>

      {editing ? (
        <div className="card">
          <h2>Editar álbum</h2>
          <AlbumForm initial={album} onSave={saveAlbum} onCancel={() => setEditing(false)} />
          <hr className="hr" />
          <button className="btn danger small" onClick={removeAlbum}>
            Apagar álbum
          </button>
        </div>
      ) : (
        <>
          <Cover src={album.coverUrl} alt={album.title} size="large" />
          <div className="page-title" style={{ marginTop: 16 }}>
            <div>
              <h1>{album.title}</h1>
              <p className="subtitle">
                {artist?.name} · {album.year} · {ALBUM_TYPE_LABEL[album.type]}
              </p>
            </div>
            <span className="spacer" />
            <button className="btn small" onClick={() => setEditing(true)}>
              Editar
            </button>
          </div>

          <div className="segmented" style={{ marginBottom: 12 }}>
            <button className={`btn${album.status === 'have' ? ' ok' : ''}`} onClick={() => setStatus('have')}>
              ✓ Tenho
            </button>
            <button className={`btn${album.status === 'want' ? ' want' : ''}`} onClick={() => setStatus('want')}>
              ♡ Quero
            </button>
            <button className={`btn${album.status === 'none' ? ' primary' : ''}`} onClick={() => setStatus('none')}>
              Não tenho
            </button>
          </div>

          <div className="card">
            <dl className="kv">
              <dt>Gravadora</dt>
              <dd>{album.label ?? '—'}</dd>
              <dt>Raridade</dt>
              <dd>
                <Rarity value={album.rarity} />{' '}
                <span className="muted" style={{ fontSize: '0.8rem' }}>
                  {RARITY_LABEL[album.rarity]}
                  {album.raritySource === 'manual' ? ' · definida por você' : album.raritySource === 'discogs' ? ' · automática' : ' · estimativa inicial'}
                </span>
              </dd>
              <dt>Preço estimado</dt>
              <dd>
                {priceUsd != null ? (
                  <>
                    {formatUSD(priceUsd)} <span className="muted">≈ {formatBRL(priceBrl)}</span>
                  </>
                ) : (
                  '—'
                )}
                {album.priceSource === 'manual' && <span className="muted" style={{ fontSize: '0.8rem' }}> · definido por você</span>}
              </dd>
              <dt>Discogs</dt>
              <dd>
                {priceState === 'loading' ? (
                  <span className="muted">consultando…</span>
                ) : album.discogsReleaseId ? (
                  <>
                    <a href={releaseUrl(album.discogsReleaseId)} target="_blank" rel="noreferrer" style={{ textDecoration: 'underline' }}>
                      {album.discogsForSale ?? 0} à venda
                    </a>
                    <span className="muted">
                      {album.discogsInCollection != null ? ` · ${album.discogsInCollection.toLocaleString('pt-BR')} coleções` : ''}
                      {album.discogsCheckedAt ? ` · ${formatDate(new Date(album.discogsCheckedAt).toISOString().slice(0, 10))}` : ''}
                    </span>
                  </>
                ) : priceState === 'error' ? (
                  <span className="muted">{priceError}</span>
                ) : priceState === 'notfound' || album.discogsCheckedAt ? (
                  <span className="muted">não encontrado</span>
                ) : (
                  <span className="muted">—</span>
                )}
                {priceState !== 'loading' && (
                  <button className="btn ghost small" style={{ marginLeft: 8 }} onClick={() => fetchPricingNow(true)}>
                    Atualizar
                  </button>
                )}
              </dd>
              {album.notes && (
                <>
                  <dt>Notas</dt>
                  <dd>{album.notes}</dd>
                </>
              )}
            </dl>
          </div>

          {album.status === 'have' && (
            <div className="card">
              <div className="page-title" style={{ marginBottom: 8 }}>
                <h2 style={{ marginBottom: 0 }}>Minha cópia</h2>
                <span className="spacer" />
                {!editingCopy && (
                  <button className="btn small" onClick={() => setEditingCopy(true)}>
                    {copy ? 'Editar' : 'Preencher'}
                  </button>
                )}
              </div>
              {editingCopy ? (
                <CopyForm initial={copy ?? undefined} onSave={saveCopy} onCancel={() => setEditingCopy(false)} />
              ) : copy ? (
                <dl className="kv">
                  <dt>Prensagem</dt>
                  <dd>
                    {[copy.pressingYear, copy.pressingCountry, copy.pressingLabel].filter(Boolean).join(' · ') || '—'}
                  </dd>
                  <dt>Disco</dt>
                  <dd title={copy.mediaCondition ? GRADE_LABEL[copy.mediaCondition] : ''}>{copy.mediaCondition ?? '—'}</dd>
                  <dt>Capa</dt>
                  <dd title={copy.sleeveCondition ? GRADE_LABEL[copy.sleeveCondition] : ''}>{copy.sleeveCondition ?? '—'}</dd>
                  <dt>Valor pago</dt>
                  <dd>{formatBRL(copy.pricePaidBrl)}</dd>
                  <dt>Compra</dt>
                  <dd>
                    {[copy.purchaseCity, copy.purchaseCountry].filter(Boolean).join(', ') || '—'}
                    {copy.purchaseDate ? ` · ${formatDate(copy.purchaseDate)}` : ''}
                  </dd>
                  {copy.notes && (
                    <>
                      <dt>Obs.</dt>
                      <dd>{copy.notes}</dd>
                    </>
                  )}
                </dl>
              ) : (
                <p className="muted">Ainda sem detalhes da sua cópia.</p>
              )}
            </div>
          )}

          <div className="card">
            <h2>Faixas</h2>
            {album.tracks.length === 0 ? (
              tracksState === 'loading' ? (
                <div className="progress-line" style={{ marginTop: 0 }}>
                  <span className="spinner" />
                  Buscando faixas no MusicBrainz…
                </div>
              ) : (
                <>
                  <p className="muted">
                    {tracksState === 'error'
                      ? tracksError
                      : tracksState === 'empty'
                        ? 'O MusicBrainz não tem as faixas deste lançamento. Você pode digitá-las em "Editar".'
                        : 'Nenhuma faixa cadastrada.'}
                  </p>
                  {album.mbid && (
                    <div className="btn-row">
                      <button className="btn small" onClick={() => fetchTracksNow(true)}>
                        Buscar faixas no MusicBrainz
                      </button>
                    </div>
                  )}
                </>
              )
            ) : (
              <ol className="tracks">
                {album.tracks.map((t, i) => (
                  <li key={`${t.position}-${i}`}>
                    <span className="pos">{t.position}</span>
                    <span>{t.title}</span>
                    <span className="dur">{formatDuration(t.durationMs)}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </>
      )}
    </>
  )
}
