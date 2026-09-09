import { useState, type FormEvent } from 'react'
import { ALBUM_TYPES, ALBUM_TYPE_LABEL, type Album, type AlbumType } from '../db/types'
import { parseInteger, parseMoney } from '../lib/format'
import { textToTracks, tracksToText } from '../lib/tracks'
import { Rarity } from './Rarity'

export type AlbumFormData = Pick<
  Album,
  'title' | 'year' | 'type' | 'label' | 'coverUrl' | 'tracks' | 'rarity' | 'estimatedPriceUsd' | 'notes'
>

interface Props {
  initial?: Album
  onSave: (data: AlbumFormData) => Promise<void> | void
  onCancel: () => void
}

export function AlbumForm({ initial, onSave, onCancel }: Props) {
  const [title, setTitle] = useState(initial?.title ?? '')
  const [year, setYear] = useState(initial ? String(initial.year) : '')
  const [type, setType] = useState<AlbumType>(initial?.type ?? 'studio')
  const [label, setLabel] = useState(initial?.label ?? '')
  const [coverUrl, setCoverUrl] = useState(initial?.coverUrl ?? '')
  const [rarity, setRarity] = useState(initial?.rarity ?? 2)
  const [price, setPrice] = useState(initial?.estimatedPriceUsd != null ? String(initial.estimatedPriceUsd) : '')
  const [notes, setNotes] = useState(initial?.notes ?? '')
  const [tracksText, setTracksText] = useState(initial ? tracksToText(initial.tracks) : '')
  const [saving, setSaving] = useState(false)

  const yearNum = parseInteger(year)
  const valid = title.trim().length > 0 && yearNum != null && yearNum > 1900 && yearNum < 2100

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!valid) return
    setSaving(true)
    try {
      await onSave({
        title: title.trim(),
        year: yearNum!,
        type,
        label: label.trim() || undefined,
        coverUrl: coverUrl.trim() || undefined,
        rarity,
        estimatedPriceUsd: parseMoney(price),
        notes: notes.trim() || undefined,
        tracks: textToTracks(tracksText),
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className="form" onSubmit={submit}>
      <div className="field">
        <label htmlFor="album-title">Título *</label>
        <input id="album-title" value={title} onChange={(e) => setTitle(e.target.value)} required autoFocus />
      </div>
      <div className="row">
        <div className="field">
          <label htmlFor="album-year">Ano de lançamento *</label>
          <input id="album-year" inputMode="numeric" value={year} onChange={(e) => setYear(e.target.value)} required />
        </div>
        <div className="field">
          <label htmlFor="album-type">Tipo</label>
          <select id="album-type" value={type} onChange={(e) => setType(e.target.value as AlbumType)}>
            {ALBUM_TYPES.map((t) => (
              <option key={t} value={t}>
                {ALBUM_TYPE_LABEL[t]}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="row">
        <div className="field">
          <label htmlFor="album-label">Gravadora</label>
          <input id="album-label" value={label} onChange={(e) => setLabel(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="album-price">Preço estimado (USD)</label>
          <input id="album-price" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="ex.: 45" />
        </div>
      </div>
      <div className="field">
        <label>Raridade</label>
        <Rarity value={rarity} onChange={setRarity} />
      </div>
      <div className="field">
        <label htmlFor="album-cover">Endereço da capa (URL)</label>
        <input id="album-cover" value={coverUrl} onChange={(e) => setCoverUrl(e.target.value)} placeholder="https://…" />
      </div>
      <div className="field">
        <label htmlFor="album-tracks">Faixas</label>
        <textarea
          id="album-tracks"
          value={tracksText}
          onChange={(e) => setTracksText(e.target.value)}
          placeholder={'1. Prowler (3:55)\n2. Remember Tomorrow\n…'}
        />
        <span className="hint">Uma faixa por linha. Formato: "posição. Título (m:ss)". Posição e duração são opcionais.</span>
      </div>
      <div className="field">
        <label htmlFor="album-notes">Notas</label>
        <textarea id="album-notes" value={notes} onChange={(e) => setNotes(e.target.value)} style={{ minHeight: 70 }} />
      </div>
      <div className="btn-row">
        <button type="submit" className="btn primary" disabled={saving || !valid}>
          Salvar
        </button>
        <button type="button" className="btn ghost" onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </form>
  )
}
