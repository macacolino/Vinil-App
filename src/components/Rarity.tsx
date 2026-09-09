interface Props {
  value: number
  onChange?: (v: number) => void
}

/** Raridade em estrelas (1 a 5). Com onChange vira um seletor. */
export function Rarity({ value, onChange }: Props) {
  const stars = [1, 2, 3, 4, 5]
  return (
    <span className={`stars${onChange ? ' input' : ''}`} title={`Raridade ${value} de 5`}>
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
