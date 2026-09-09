import { useLiveQuery } from 'dexie-react-hooks'
import { DEFAULT_USD_TO_BRL, SETTINGS, db } from '../db/db'

const brlFmt = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const usdFmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })

export function formatBRL(value: number | undefined | null): string {
  return value == null || Number.isNaN(value) ? '—' : brlFmt.format(value)
}

export function formatUSD(value: number | undefined | null): string {
  return value == null || Number.isNaN(value) ? '—' : usdFmt.format(value)
}

/** Duração de faixa em m:ss. */
export function formatDuration(ms: number | undefined): string {
  if (!ms) return ''
  const total = Math.round(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

/** Data ISO (AAAA-MM-DD) para dd/mm/aaaa. */
export function formatDate(iso: string | undefined): string {
  if (!iso) return '—'
  const [y, m, d] = iso.split('-')
  return d && m && y ? `${d}/${m}/${y}` : iso
}

/** Cotação USD→BRL salva em Configurações (ou padrão). */
export function useUsdToBrl(): number {
  const setting = useLiveQuery(() => db.settings.get(SETTINGS.usdToBrl), [])
  const value = Number(setting?.value)
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_USD_TO_BRL
}

/** Converte string de input numérico em número ou undefined. Aceita vírgula. */
export function parseNumber(raw: string): number | undefined {
  const cleaned = raw.trim().replace(/\./g, '').replace(',', '.')
  if (!cleaned) return undefined
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : undefined
}

/** Versão simples: aceita "1.234,56" e "1234.56". */
export function parseMoney(raw: string): number | undefined {
  const t = raw.trim()
  if (!t) return undefined
  // Se tem vírgula, assume formato brasileiro (ponto = milhar).
  const normalized = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t
  const n = Number(normalized)
  return Number.isFinite(n) ? n : undefined
}

export function parseInteger(raw: string): number | undefined {
  const t = raw.trim()
  if (!t) return undefined
  const n = Number.parseInt(t, 10)
  return Number.isFinite(n) ? n : undefined
}
