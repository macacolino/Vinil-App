import { useState, type FormEvent } from 'react'
import type { Artist } from '../db/types'

interface Props {
  initial?: Artist
  onSave: (data: Pick<Artist, 'name' | 'country' | 'notes'>) => Promise<void> | void
  onCancel: () => void
}

export function ArtistForm({ initial, onSave, onCancel }: Props) {
  const [name, setName] = useState(initial?.name ?? '')
  const [country, setCountry] = useState(initial?.country ?? '')
  const [notes, setNotes] = useState(initial?.notes ?? '')
  const [saving, setSaving] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setSaving(true)
    try {
      await onSave({ name: name.trim(), country: country.trim() || undefined, notes: notes.trim() || undefined })
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className="form" onSubmit={submit}>
      <div className="field">
        <label htmlFor="artist-name">Nome do artista *</label>
        <input id="artist-name" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
      </div>
      <div className="field">
        <label htmlFor="artist-country">País</label>
        <input id="artist-country" value={country} onChange={(e) => setCountry(e.target.value)} placeholder="ex.: Reino Unido" />
      </div>
      <div className="field">
        <label htmlFor="artist-notes">Notas</label>
        <textarea id="artist-notes" value={notes} onChange={(e) => setNotes(e.target.value)} style={{ minHeight: 70 }} />
      </div>
      <div className="btn-row">
        <button type="submit" className="btn primary" disabled={saving || !name.trim()}>
          Salvar
        </button>
        <button type="button" className="btn ghost" onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </form>
  )
}
