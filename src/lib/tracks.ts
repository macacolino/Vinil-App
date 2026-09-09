import type { Track } from '../db/types'
import { formatDuration } from './format'

/**
 * Faixas viram texto (uma por linha) para edição num textarea:
 *   1. Prowler (3:55)
 *   A2. Remember Tomorrow
 */
export function tracksToText(tracks: Track[]): string {
  return tracks
    .map((t) => {
      const dur = t.durationMs ? ` (${formatDuration(t.durationMs)})` : ''
      return `${t.position}. ${t.title}${dur}`
    })
    .join('\n')
}

/** Texto do textarea vira lista de faixas. Linhas sem posição recebem número sequencial. */
export function textToTracks(text: string): Track[] {
  const tracks: Track[] = []
  let n = 0
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (!line) continue
    n += 1
    let position = String(n)
    let rest = line
    const posMatch = line.match(/^([A-Za-z]?\d+(?:-\d+)?)[.)]\s+(.*)$/)
    if (posMatch) {
      position = posMatch[1]
      rest = posMatch[2]
    }
    let durationMs: number | undefined
    const durMatch = rest.match(/\s*\((\d+):(\d{2})\)\s*$/)
    if (durMatch) {
      durationMs = (Number(durMatch[1]) * 60 + Number(durMatch[2])) * 1000
      rest = rest.slice(0, durMatch.index).trim()
    }
    if (rest) tracks.push({ position, title: rest, durationMs })
  }
  return tracks
}
