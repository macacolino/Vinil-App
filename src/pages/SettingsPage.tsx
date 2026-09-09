import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useRef, useState } from 'react'
import { DEFAULT_USD_TO_BRL, SETTINGS, db } from '../db/db'
import { downloadJson, exportBackup, importBackup, isBackup } from '../lib/backup'
import { parseMoney } from '../lib/format'
import { restoreIronMaiden } from '../seed/seed'
import { AccountCard } from '../components/AccountCard'
import { wipeAll } from '../db/ops'

export function SettingsPage() {
  // Embrulha o resultado para diferenciar "ainda carregando" (undefined) de "não existe" (setting undefined).
  const rateSetting = useLiveQuery(async () => ({ setting: await db.settings.get(SETTINGS.usdToBrl) }), [])
  const [rate, setRate] = useState('')
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const counts = useLiveQuery(
    async () => ({
      artists: await db.artists.count(),
      albums: await db.albums.count(),
      have: await db.albums.where('status').equals('have').count(),
    }),
    [],
  )

  useEffect(() => {
    if (rateSetting !== undefined) {
      const v = Number(rateSetting.setting?.value)
      setRate(String(Number.isFinite(v) && v > 0 ? v : DEFAULT_USD_TO_BRL).replace('.', ','))
    }
  }, [rateSetting])

  async function saveRate() {
    const v = parseMoney(rate)
    if (!v || v <= 0) {
      setMsg({ text: 'Cotação inválida.', ok: false })
      return
    }
    await db.settings.put({ key: SETTINGS.usdToBrl, value: v, updatedAt: Date.now() })
    setMsg({ text: 'Cotação salva.', ok: true })
  }

  async function doExport() {
    const data = await exportBackup()
    const stamp = new Date().toISOString().slice(0, 10)
    downloadJson(data, `vinil-backup-${stamp}.json`)
    setMsg({ text: 'Backup gerado. Guarde o arquivo em lugar seguro.', ok: true })
  }

  async function doImport(file: File) {
    try {
      const parsed: unknown = JSON.parse(await file.text())
      if (!isBackup(parsed)) throw new Error('Arquivo não é um backup do Vinil.')
      const ok = window.confirm(
        `Importar ${parsed.artists.length} artistas e ${parsed.albums.length} álbuns? Isso SUBSTITUI todos os dados atuais do app.`,
      )
      if (!ok) return
      await importBackup(parsed)
      setMsg({ text: 'Backup importado com sucesso.', ok: true })
    } catch (err) {
      setMsg({ text: `Falha ao importar: ${err instanceof Error ? err.message : String(err)}`, ok: false })
    } finally {
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function doRestore() {
    const n = await restoreIronMaiden(db)
    setMsg({ text: n ? `${n} álbum(ns) do Iron Maiden recolocado(s).` : 'A discografia do Iron Maiden já está completa.', ok: true })
  }

  async function doWipe() {
    if (!window.confirm('Apagar TODOS os dados do app neste aparelho? Faça um backup antes. Isso não pode ser desfeito.')) return
    if (!window.confirm('Tem certeza mesmo?')) return
    await wipeAll()
    setMsg({ text: 'Dados apagados. Use "Recolocar Iron Maiden" para começar de novo.', ok: true })
  }

  return (
    <>
      <div className="page-title">
        <div>
          <h1>Configurações</h1>
          {counts && (
            <p className="subtitle">
              {counts.artists} artista(s) · {counts.albums} álbuns · {counts.have} na biblioteca
            </p>
          )}
        </div>
      </div>

      {msg && <div className={`notice${msg.ok ? ' ok' : ''}`}>{msg.text}</div>}

      <AccountCard />

      <div className="card">
        <h2>Cotação do dólar</h2>
        <p className="muted" style={{ marginBottom: 10 }}>
          Usada para converter o preço estimado (USD) para reais. O valor pago por você é sempre em BRL.
        </p>
        <div className="field">
          <label htmlFor="rate">1 USD = R$</label>
          <input id="rate" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} />
        </div>
        <div className="btn-row">
          <button className="btn primary" onClick={saveRate}>
            Salvar cotação
          </button>
        </div>
      </div>

      <div className="card">
        <h2>Backup</h2>
        <p className="muted" style={{ marginBottom: 10 }}>
          Exporte um arquivo JSON de vez em quando para ter uma cópia sua, independente da nuvem.
        </p>
        <div className="btn-row">
          <button className="btn primary" onClick={doExport}>
            Exportar JSON
          </button>
          <button className="btn" onClick={() => fileRef.current?.click()}>
            Importar JSON…
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void doImport(f)
            }}
          />
        </div>
      </div>

      <div className="card">
        <h2>Dados</h2>
        <div className="btn-row">
          <button className="btn" onClick={doRestore}>
            Recolocar Iron Maiden
          </button>
          <button className="btn danger" onClick={doWipe}>
            Apagar tudo
          </button>
        </div>
        <p className="muted" style={{ marginTop: 10, fontSize: '0.8rem' }}>
          "Recolocar" adiciona só os álbuns do Iron Maiden que estiverem faltando, sem mexer no que você já tem.
        </p>
      </div>

      <div className="card">
        <h2>Sobre</h2>
        <p className="muted">
          Vinil v{__APP_VERSION__} · funciona offline · fase 1. Sincronização com a nuvem, importação pelo Discogs e
          instalação no celular vêm nas próximas fases.
        </p>
      </div>
    </>
  )
}
