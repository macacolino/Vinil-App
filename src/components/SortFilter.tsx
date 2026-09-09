export type SortKey = 'year' | 'rarity' | 'title'

interface Props {
  sort: SortKey
  onSort: (s: SortKey) => void
  minRarity: number
  onMinRarity: (n: number) => void
}

/** Controles de ordenação e filtro por raridade, usados em Artista e Biblioteca. */
export function SortFilter({ sort, onSort, minRarity, onMinRarity }: Props) {
  return (
    <div className="toolbar">
      <select aria-label="Ordenar por" value={sort} onChange={(e) => onSort(e.target.value as SortKey)}>
        <option value="year">Ordem: ano</option>
        <option value="rarity">Ordem: mais raros primeiro</option>
        <option value="title">Ordem: título</option>
      </select>
      <select aria-label="Raridade mínima" value={minRarity} onChange={(e) => onMinRarity(Number(e.target.value))}>
        <option value={0}>Raridade: todas</option>
        <option value={3}>Raridade: ★★★ ou mais</option>
        <option value={4}>Raridade: ★★★★ ou mais</option>
        <option value={5}>Raridade: ★★★★★</option>
      </select>
    </div>
  )
}

export function sortAlbums<T>(items: T[], sort: SortKey, pick: (item: T) => { year: number; rarity: number; title: string }): T[] {
  return [...items].sort((a, b) => {
    const x = pick(a)
    const y = pick(b)
    if (sort === 'rarity') return y.rarity - x.rarity || x.year - y.year
    if (sort === 'title') return x.title.localeCompare(y.title, 'pt-BR')
    return x.year - y.year || x.title.localeCompare(y.title, 'pt-BR')
  })
}
