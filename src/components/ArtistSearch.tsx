import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { db } from '../db/db'
import { artistUid } from '../db/uid'
import { createArtistFromMusicBrainz } from '../lib/importArtist'
import { enqueueImport } from '../lib/jobs'
import { MusicBrainzError, countryName, searchArtists, type MBArtist } from '../lib/musicbrainz'
import { ArtistForm } from './ArtistForm'

interface Props {
  onClose: () => void
}

const TYPE_LABEL: Record<string, string> = {
  Group: 'Banda',
  Person: 'Artista solo',
  Orchestra: 'Orquestra',
  Choir: 'Coral',
  Character: 'Personagem',
  Other: 'Outro',
}

/**
 * Caixa "Novo artista": digita o nome, escolhe na lista do MusicBrainz e a
 * discografia inteira é importada. Há também a opção de cadastrar à mão.
 */
export function ArtistSearch({ onClose }: Props) {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<MBArtist[]>([])
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [manual, setManual] = useState(false)
  const [importing, setImporting] = useState<string | null>(null)
  const requestId = useRef(0)
  const controller = useRef<AbortController | null>(null)

  // Busca com pequeno atraso para não disparar uma requisição por tecla e
  // cancela a busca anterior se o usuário continuar digitando.
  useEffect(() => {
    const q = query.trim()
    controller.current?.abort()
    if (q.length < 2) {
      setResults([])
      setSearching(false)
      return
    }
    const id = ++requestId.current
    const ac = new AbortController()
    controller.current = ac
    setSearching(true)
    setError(null)
    const timer = setTimeout(async () => {
      try {
        const found = await searchArtists(q, ac.signal)
        if (id === requestId.current) setResults(found)
      } catch (err) {
        if (err instanceof MusicBrainzError && err.kind === 'aborted') return
        if (id === requestId.current) {
          setResults([])
          setError(err instanceof Error ? err.message : String(err))
        }
      } finally {
        if (id === requestId.current) setSearching(false)
      }
    }, 300)
    return () => {
      clearTimeout(timer)
      ac.abort()
    }
  }, [query])

  async function choose(mb: MBArtist) {
    setError(null)
    setImporting(`Adicionando ${mb.name}…`)
    try {
      const { artistId, alreadyExisted } = await createArtistFromMusicBrainz(mb)
      // Discografia, faixas e gravadoras vêm em segundo plano, sem travar o app.
      enqueueImport(artistId, mb.name)
      navigate(`/artistas/${artistId}`, { state: { alreadyExisted } })
    } catch (err) {
      setImporting(null)
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function addManual(data: { name: string; country?: string; notes?: string }) {
    const now = Date.now()
    const id = await db.artists.add({ ...data, uid: artistUid(data), createdAt: now, updatedAt: now })
    navigate(`/artistas/${id}`)
  }

  if (manual) {
    return (
      <div className="card">
        <h2>Cadastrar artista à mão</h2>
        <ArtistForm initial={query ? { uid: '', name: query, createdAt: 0, updatedAt: 0 } : undefined} onSave={addManual} onCancel={() => setManual(false)} />
      </div>
    )
  }

  return (
    <div className="card">
      <h2>Novo artista</h2>
      <div className="field">
        <label htmlFor="artist-search">Nome do artista ou banda</label>
        <input
          id="artist-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="ex.: Dire Straits"
          autoFocus
          autoComplete="off"
          disabled={!!importing}
        />
        <span className="hint">Escolha na lista e a discografia completa é importada do MusicBrainz.</span>
      </div>

      {importing ? (
        <div className="progress-line">
          <span className="spinner" />
          {importing}
        </div>
      ) : (
        <>
          {searching && (
            <div className="progress-line">
              <span className="spinner" />
              Buscando…
            </div>
          )}
          {error && <div className="notice" style={{ marginTop: 10 }}>{error}</div>}
          {!searching && !error && query.trim().length >= 2 && results.length === 0 && (
            <p className="muted" style={{ marginTop: 10 }}>Nenhum artista encontrado com esse nome.</p>
          )}
          {results.length > 0 && (
            <div className="search-results">
              {results.map((r) => (
                <button key={r.id} type="button" onClick={() => choose(r)}>
                  <span className="name">{r.name}</span>
                  <span className="meta">
                    {[TYPE_LABEL[r.type ?? ''] ?? r.type, countryName(r.country), r.lifeSpan, r.disambiguation].filter(Boolean).join(' · ')}
                  </span>
                </button>
              ))}
            </div>
          )}
        </>
      )}

      <div className="btn-row">
        <button type="button" className="btn ghost small" onClick={() => setManual(true)} disabled={!!importing}>
          Cadastrar à mão
        </button>
        <button type="button" className="btn ghost small" onClick={onClose} disabled={!!importing}>
          Cancelar
        </button>
      </div>
    </div>
  )
}
