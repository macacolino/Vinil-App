import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { BarcodeScanner } from '../components/BarcodeScanner'
import { Cover } from '../components/Cover'
import {
  findLocalEdition,
  loadLocalEditions,
  lookupCode,
  registerEdition,
  type EditionCandidate,
  type LocalEdition,
  type LookupResult,
  type RegisterResult,
} from '../lib/barcode'
import { formatBRL, formatUSD, useUsdToBrl } from '../lib/format'

type Phase =
  | { step: 'idle' }
  | { step: 'camera' }
  | { step: 'searching'; code: string }
  | { step: 'results'; result: LookupResult; local: Map<string, LocalEdition> }
  | { step: 'confirm'; result: LookupResult; candidate: EditionCandidate; local?: LocalEdition }
  | { step: 'saving'; candidate: EditionCandidate; message: string }
  | { step: 'done'; candidate: EditionCandidate; saved: RegisterResult }
  | { step: 'error'; message: string; code?: string }

const isStaticDemo = import.meta.env.VITE_STATIC_DEMO === '1'

function describe(c: EditionCandidate): string {
  return [c.year, c.country, c.label, c.catno, c.format].filter(Boolean).join(' · ')
}

/**
 * Tela "Escanear": lê o código de barras (ou recebe o código digitado),
 * mostra de que disco e edição se trata e registra a edição no álbum,
 * criando artista e álbum quando ainda não existem.
 */
export function ScanPage() {
  const [phase, setPhase] = useState<Phase>({ step: 'idle' })
  const [typed, setTyped] = useState('')
  const rate = useUsdToBrl()

  const search = useCallback(async (raw: string) => {
    setPhase({ step: 'searching', code: raw })
    try {
      const [result, local] = await Promise.all([lookupCode(raw), loadLocalEditions()])
      setPhase({ step: 'results', result, local })
    } catch (err) {
      setPhase({ step: 'error', message: err instanceof Error ? err.message : String(err), code: raw })
    }
  }, [])

  const onDetected = useCallback(
    (code: string) => {
      setTyped(code)
      void search(code)
    },
    [search],
  )

  // Um código recém-lido some da caixa quando o usuário volta ao início.
  useEffect(() => {
    if (phase.step === 'idle') setTyped('')
  }, [phase.step])

  function submit(e: FormEvent) {
    e.preventDefault()
    if (typed.trim()) void search(typed)
  }

  async function save(candidate: EditionCandidate, owned: boolean, result: LookupResult) {
    setPhase({ step: 'saving', candidate, message: 'Registrando…' })
    try {
      const saved = await registerEdition(candidate, {
        owned,
        code: result.code,
        kind: result.kind,
        onProgress: (message) => setPhase({ step: 'saving', candidate, message }),
      })
      setPhase({ step: 'done', candidate, saved })
    } catch (err) {
      setPhase({ step: 'error', message: err instanceof Error ? err.message : String(err), code: result.code })
    }
  }

  const busy = phase.step === 'searching' || phase.step === 'saving'

  return (
    <>
      <div className="page-title">
        <div>
          <h1>Escanear disco</h1>
          <p className="subtitle">Descubra qual é o álbum e a edição exata pelo código de barras.</p>
        </div>
      </div>

      {isStaticDemo && <div className="notice">Nesta prévia o app não tem acesso à internet: a busca só funciona no app publicado.</div>}

      {phase.step === 'camera' ? (
        <div className="card">
          <BarcodeScanner onDetected={onDetected} onClose={() => setPhase({ step: 'idle' })} />
        </div>
      ) : (
        (phase.step === 'idle' || phase.step === 'error' || phase.step === 'searching') && (
          <div className="card">
            <div className="btn-row" style={{ marginTop: 0 }}>
              <button type="button" className="btn primary" onClick={() => setPhase({ step: 'camera' })} disabled={busy}>
                📷 Abrir a câmera
              </button>
            </div>
            <form className="form" onSubmit={submit} style={{ marginTop: 14 }}>
              <div className="field">
                <label htmlFor="scan-code">Ou digite o código de barras / nº de catálogo</label>
                <input
                  id="scan-code"
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  placeholder="ex.: 825646252428 ou EMC 3357"
                  inputMode="text"
                  autoComplete="off"
                  disabled={busy}
                />
                <span className="hint">
                  Discos antigos (antes de ~1985) costumam não ter código de barras: use o número de catálogo da lombada ou do selo.
                </span>
              </div>
              <div className="btn-row" style={{ marginTop: 4 }}>
                <button type="submit" className="btn" disabled={busy || !typed.trim()}>
                  Buscar
                </button>
              </div>
            </form>
            {phase.step === 'searching' && (
              <div className="progress-line">
                <span className="spinner" />
                Procurando {phase.code} no Discogs e no MusicBrainz…
              </div>
            )}
            {phase.step === 'error' && <div className="notice" style={{ marginTop: 12, marginBottom: 0 }}>{phase.message}</div>}
          </div>
        )
      )}

      {phase.step === 'results' && (
        <div className="card">
          {phase.result.candidates.length === 0 ? (
            <>
              <h2>Nada encontrado</h2>
              <p className="muted">
                Nenhum disco com o código <strong>{phase.result.code}</strong> no Discogs nem no MusicBrainz. Confira os dígitos ou
                tente o número de catálogo da lombada.
              </p>
              {phase.result.warnings.map((w) => (
                <p key={w} className="muted" style={{ fontSize: '0.8rem' }}>
                  {w}
                </p>
              ))}
            </>
          ) : (
            <>
              <h2>
                {phase.result.candidates.length === 1 ? 'Encontrei este disco' : `${phase.result.candidates.length} edições com este código`}
              </h2>
              <p className="muted" style={{ marginBottom: 10 }}>
                {phase.result.candidates.length === 1
                  ? 'Confira se é o seu e toque para registrar.'
                  : 'O mesmo código pode servir a prensagens de países diferentes. Toque na que está na sua mão.'}
              </p>
              <div className="scan-results">
                {phase.result.candidates.map((c) => {
                  const local = findLocalEdition(phase.local, c, phase.result.code, phase.result.kind)
                  return (
                    <button
                      key={c.key}
                      type="button"
                      className="list-item scan-item"
                      onClick={() => setPhase({ step: 'confirm', result: phase.result, candidate: c, local })}
                    >
                      <Cover sources={[c.thumb]} alt="" size="small" />
                      <div className="grow">
                        <div className="name">
                          <span>{c.title}</span>
                          {!c.vinyl && <span className="badge">não é vinil</span>}
                          {local && <span className={`badge${local.edition.owned ? ' have' : ''}`}>{local.edition.owned ? 'tenho' : 'já vista'}</span>}
                        </div>
                        <div className="meta">{c.artistName}</div>
                        <div className="meta">{describe(c) || '—'}</div>
                      </div>
                      <span className="chev">›</span>
                    </button>
                  )
                })}
              </div>
              {phase.result.warnings.map((w) => (
                <p key={w} className="muted" style={{ fontSize: '0.8rem', marginTop: 8 }}>
                  {w}
                </p>
              ))}
            </>
          )}
          <div className="btn-row">
            <button type="button" className="btn ghost small" onClick={() => setPhase({ step: 'camera' })}>
              Escanear outro
            </button>
            <button type="button" className="btn ghost small" onClick={() => setPhase({ step: 'idle' })}>
              Digitar outro código
            </button>
          </div>
        </div>
      )}

      {phase.step === 'confirm' && (
        <div className="card">
          <div className="list-item" style={{ border: 0, padding: 0, background: 'transparent' }}>
            <Cover sources={[phase.candidate.thumb]} alt="" size="small" />
            <div className="grow">
              <div className="name">{phase.candidate.title}</div>
              <div className="meta">{phase.candidate.artistName}</div>
              <div className="meta">{describe(phase.candidate) || '—'}</div>
            </div>
          </div>
          {phase.local ? (
            <p className="muted" style={{ marginTop: 12 }}>
              Esta edição já está registrada em <Link to={`/albuns/${phase.local.album.id}`}>{phase.local.album.title}</Link>
              {phase.local.edition.owned ? ' como sua.' : ' como "vista".'}
              {phase.local.edition.lowestUsd != null &&
                ` Menor anúncio: ${formatUSD(phase.local.edition.lowestUsd)} ≈ ${formatBRL(phase.local.edition.lowestUsd * rate)}.`}
            </p>
          ) : (
            <p className="muted" style={{ marginTop: 12 }}>
              Se o artista ou o álbum ainda não estiverem no app, eles são criados e a discografia vem em segundo plano.
            </p>
          )}
          <div className="btn-row">
            <button type="button" className="btn ok" onClick={() => save(phase.candidate, true, phase.result)}>
              ✓ Tenho esta edição
            </button>
            {!phase.local?.edition.owned && (
              <button type="button" className="btn" onClick={() => save(phase.candidate, false, phase.result)}>
                👁 Só anotar que vi
              </button>
            )}
            <button
              type="button"
              className="btn ghost"
              onClick={() => loadLocalEditions().then((local) => setPhase({ step: 'results', result: phase.result, local }))}
            >
              Voltar
            </button>
          </div>
        </div>
      )}

      {phase.step === 'saving' && (
        <div className="card">
          <div className="progress-line" style={{ marginTop: 0 }}>
            <span className="spinner" />
            {phase.message}
          </div>
        </div>
      )}

      {phase.step === 'done' && (
        <div className="card">
          <h2>{phase.saved.edition.owned ? 'Registrado como seu' : 'Anotado'}</h2>
          <dl className="kv">
            <dt>Álbum</dt>
            <dd>
              <Link to={`/albuns/${phase.saved.album.id}`} style={{ textDecoration: 'underline' }}>
                {phase.saved.album.title}
              </Link>
              {phase.saved.newAlbum && <span className="muted"> · criado agora</span>}
            </dd>
            <dt>Artista</dt>
            <dd>
              <Link to={`/artistas/${phase.saved.artist.id}`} style={{ textDecoration: 'underline' }}>
                {phase.saved.artist.name}
              </Link>
              {phase.saved.newArtist && <span className="muted"> · novo</span>}
            </dd>
            <dt>Edição</dt>
            <dd>{[phase.saved.edition.year, phase.saved.edition.country, phase.saved.edition.label, phase.saved.edition.catalogNumber].filter(Boolean).join(' · ') || '—'}</dd>
            {phase.saved.edition.lowestUsd != null && (
              <>
                <dt>Menor anúncio</dt>
                <dd>
                  {formatUSD(phase.saved.edition.lowestUsd)} <span className="muted">≈ {formatBRL(phase.saved.edition.lowestUsd * rate)}</span>
                  <span className="muted"> · {phase.saved.edition.forSale ?? 0} à venda desta edição</span>
                </dd>
              </>
            )}
          </dl>
          {phase.saved.importing && (
            <div className="notice ok" style={{ marginTop: 12, marginBottom: 0 }}>
              A discografia completa de {phase.saved.artist.name} está sendo importada em segundo plano. Acompanhe na barra acima do menu.
            </div>
          )}
          <div className="btn-row">
            {phase.saved.edition.owned && (
              <Link className="btn primary" to={`/albuns/${phase.saved.album.id}`} state={{ editCopy: true }}>
                Completar minha cópia
              </Link>
            )}
            <button type="button" className="btn" onClick={() => setPhase({ step: 'camera' })}>
              📷 Escanear outro
            </button>
            <button type="button" className="btn ghost" onClick={() => setPhase({ step: 'idle' })}>
              Início
            </button>
          </div>
        </div>
      )}
    </>
  )
}
