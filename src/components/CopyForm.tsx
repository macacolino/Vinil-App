import { useState, type FormEvent } from 'react'
import { GRADES, GRADE_LABEL, type Copy, type Grade } from '../db/types'
import { parseInteger, parseMoney } from '../lib/format'

export type CopyFormData = Omit<Copy, 'id' | 'albumId' | 'createdAt' | 'updatedAt'>

interface Props {
  initial?: Copy
  onSave: (data: CopyFormData) => Promise<void> | void
  onCancel: () => void
}

function GradeSelect({ id, label, value, onChange }: { id: string; label: string; value: Grade | ''; onChange: (g: Grade | '') => void }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value as Grade | '')}>
        <option value="">—</option>
        {GRADES.map((g) => (
          <option key={g} value={g}>
            {g} — {GRADE_LABEL[g]}
          </option>
        ))}
      </select>
    </div>
  )
}

export function CopyForm({ initial, onSave, onCancel }: Props) {
  const [pressingYear, setPressingYear] = useState(initial?.pressingYear != null ? String(initial.pressingYear) : '')
  const [pressingCountry, setPressingCountry] = useState(initial?.pressingCountry ?? '')
  const [pressingLabel, setPressingLabel] = useState(initial?.pressingLabel ?? '')
  const [media, setMedia] = useState<Grade | ''>(initial?.mediaCondition ?? '')
  const [sleeve, setSleeve] = useState<Grade | ''>(initial?.sleeveCondition ?? '')
  const [pricePaid, setPricePaid] = useState(initial?.pricePaidBrl != null ? String(initial.pricePaidBrl).replace('.', ',') : '')
  const [city, setCity] = useState(initial?.purchaseCity ?? '')
  const [country, setCountry] = useState(initial?.purchaseCountry ?? 'Brasil')
  const [date, setDate] = useState(initial?.purchaseDate ?? '')
  const [notes, setNotes] = useState(initial?.notes ?? '')
  const [saving, setSaving] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      await onSave({
        pressingYear: parseInteger(pressingYear),
        pressingCountry: pressingCountry.trim() || undefined,
        pressingLabel: pressingLabel.trim() || undefined,
        mediaCondition: media || undefined,
        sleeveCondition: sleeve || undefined,
        pricePaidBrl: parseMoney(pricePaid),
        purchaseCity: city.trim() || undefined,
        purchaseCountry: country.trim() || undefined,
        purchaseDate: date || undefined,
        notes: notes.trim() || undefined,
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className="form" onSubmit={submit}>
      <div className="row">
        <div className="field">
          <label htmlFor="copy-year">Ano da prensagem</label>
          <input id="copy-year" inputMode="numeric" value={pressingYear} onChange={(e) => setPressingYear(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="copy-country">País da prensagem</label>
          <input id="copy-country" value={pressingCountry} onChange={(e) => setPressingCountry(e.target.value)} placeholder="ex.: Brasil, Reino Unido" />
        </div>
      </div>
      <div className="field">
        <label htmlFor="copy-label">Gravadora da edição</label>
        <input id="copy-label" value={pressingLabel} onChange={(e) => setPressingLabel(e.target.value)} placeholder="ex.: EMI-Odeon" />
      </div>
      <div className="row">
        <GradeSelect id="copy-media" label="Condição do disco" value={media} onChange={setMedia} />
        <GradeSelect id="copy-sleeve" label="Condição da capa" value={sleeve} onChange={setSleeve} />
      </div>
      <div className="row">
        <div className="field">
          <label htmlFor="copy-price">Valor pago (R$)</label>
          <input id="copy-price" inputMode="decimal" value={pricePaid} onChange={(e) => setPricePaid(e.target.value)} placeholder="ex.: 150,00" />
        </div>
        <div className="field">
          <label htmlFor="copy-date">Data da compra</label>
          <input id="copy-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
      </div>
      <div className="row">
        <div className="field">
          <label htmlFor="copy-city">Cidade da compra</label>
          <input id="copy-city" value={city} onChange={(e) => setCity(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="copy-pcountry">País da compra</label>
          <input id="copy-pcountry" value={country} onChange={(e) => setCountry(e.target.value)} />
        </div>
      </div>
      <div className="field">
        <label htmlFor="copy-notes">Observações</label>
        <textarea id="copy-notes" value={notes} onChange={(e) => setNotes(e.target.value)} style={{ minHeight: 70 }} />
      </div>
      <div className="btn-row">
        <button type="submit" className="btn primary" disabled={saving}>
          Salvar
        </button>
        <button type="button" className="btn ghost" onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </form>
  )
}
