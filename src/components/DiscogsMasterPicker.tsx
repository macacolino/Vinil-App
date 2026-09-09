import { useEffect, useRef, useState } from 'react'
import { searchMasters, type MasterCandidate } from '../lib/discogs'
import { Cover } from './Cover'

interface Props {
  artistName: string
  initialQuery?: string
  /** Texto do botão de cada resultado. */
  actionLabel?: string
  onPick: (candidate: MasterCandidate) => void | Promise<void>
  onCancel: () => void
}

/** Tira "Artista - " do começo do título do Discogs. */
export function titleWithoutArtist(title: string): string {
  const i = title.indexOf(' - ')
  return i >= 0 ? title.slice(i + 3).trim() : title.trim()
}

/** Lista de páginas ("masters") do Discogs para o usuário escolher. */
export function DiscogsMasterPicker({ artistName, initialQuery = '', actionLabel = 'Usar este', onPick, onCancel }: Props) {
  const [query, setQuery] = useState(initialQuery)
  const [results, setResults] = useState<MasterCandidate[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [picking, setPicking] = useState<number | null>(null)
  const requestId = useRef(0)

  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) {
      setResults(null)
      return
    }
    const id = ++requestId.current
    setSearching(true)
    setError(null)
    const timer = setTimeout(async () => {
      try {
        const found = await searchMasters(artistName, q, 'high')
        // Mais colecionados primeiro: a página principal do disco costuma ser a primeira.
        found.sort((a, b) => b.have - a.have)
        if (id === requestId.current) setResults(found)
      } catch (err) {
        if (id === requestId.current) setError(err instanceof Error ? err.message : String(err))
      } finally {
        if (id === requestId.current) setSearching(false)
      }
    }, 400)
    return () => clearTimeout(timer)
  }, [query, artistName])

  async function pick(c: MasterCandidate) {
    setPicking(c.masterId)
    try {
      await onPick(c)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setPicking(null)
    }
  }

  return (
    <div className="picker">
      <div className="field">
        <label htmlFor="dg-query">Título do disco no Discogs</label>
        <input id="dg-query" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ex.: Fear of the Dark" autoFocus autoComplete="off" />
        <span className="hint">Busca por "{artistName}". A quantidade de coleções ajuda a achar a página principal.</span>
      </div>
      {searching && (
        <div className="progress-line">
          <span className="spinner" />
          Buscando no Discogs…
        </div>
      )}
      {error && <div className="notice" style={{ marginTop: 10 }}>{error}</div>}
      {results && results.length === 0 && !searching && <p className="muted" style={{ marginTop: 10 }}>Nada encontrado com esse título.</p>}
      {results && results.length > 0 && (
        <div className="list" style={{ marginTop: 10 }}>
          {results.map((c) => (
            <div key={c.masterId} className="list-item">
              <Cover sources={[c.coverImage, c.thumb]} alt={c.title} size="small" />
              <div className="grow">
                <div className="name">{titleWithoutArtist(c.title)}</div>
                <div className="meta">
                  {[c.year, c.formats.filter((f) => !/^(Vinyl|CD|LP|Album|Stereo|Reissue)$/.test(f)).slice(0, 3).join(', ')].filter(Boolean).join(' · ')}
                  {c.have ? ` · ${c.have.toLocaleString('pt-BR')} coleções` : ''}
                  {c.unofficial ? ' · não oficial' : ''}
                </div>
              </div>
              <button className="btn small" disabled={picking != null} onClick={() => pick(c)}>
                {picking === c.masterId ? '…' : actionLabel}
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="btn-row">
        <button type="button" className="btn ghost small" onClick={onCancel} disabled={picking != null}>
          Cancelar
        </button>
      </div>
    </div>
  )
}
