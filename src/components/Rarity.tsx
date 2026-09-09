import { RARITY_LABEL } from '../db/types'

interface Props {
  value: number
  onChange?: (v: number) => void
  size?: 'small' | 'normal'
}

/** Raridade em estrelas (1 a 5). Com onChange vira um seletor. */
export function Rarity({ value, onChange, size = 'normal' }: Props) {
  const stars = [1, 2, 3, 4, 5]
  const title = `Raridade ${value} de 5 — ${RARITY_LABEL[value] ?? ''}`
  return (
    <span className={`stars${onChange ? ' input' : ''}${size === 'small' ? ' small' : ''}`} title={title} aria-label={title}>
      {stars.map((s) => (
        <span
          key={s}
          className={s <= value ? 'on' : ''}
          onClick={onChange ? () => onChange(s) : undefined}
          role={onChange ? 'button' : undefined}
          aria-label={onChange ? `Raridade ${s}` : undefined}
        >
          ★
        </span>
      ))}
    </span>
  )
}
