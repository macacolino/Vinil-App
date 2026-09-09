/** Tipos de dados do app. Tudo fica no IndexedDB (Dexie) e é exportável em JSON. */

export type AlbumType = 'studio' | 'live' | 'compilation' | 'ep'

/** Situação do álbum na coleção: não tenho, tenho ou quero. */
export type AlbumStatus = 'none' | 'have' | 'want'

/** Escala Goldmine de condição de disco/capa. */
export type Grade = 'M' | 'NM' | 'VG+' | 'VG' | 'G' | 'F' | 'P'

export interface Track {
  /** Posição no disco, ex.: "1", "A1", "2-3" (disco 2, faixa 3). */
  position: string
  title: string
  durationMs?: number
}

export interface Artist {
  id?: number
  name: string
  country?: string
  /** Código ISO do país (ex.: GB), usado para escolher a edição de referência. */
  countryCode?: string
  notes?: string
  /** Chaves em fontes externas (fase 3). */
  mbid?: string
  discogsId?: number
  createdAt: number
  updatedAt: number
}

export interface Album {
  id?: number
  artistId: number
  title: string
  year: number
  type: AlbumType
  label?: string
  coverUrl?: string
  tracks: Track[]
  /** Raridade de 1 (comum) a 5 (raríssimo). */
  rarity: number
  /** Preço estimado de mercado em dólares. */
  estimatedPriceUsd?: number
  notes?: string
  status: AlbumStatus
  mbid?: string
  discogsId?: number
  /** Quando as faixas foram consultadas no MusicBrainz (evita repetir a busca). */
  tracksCheckedAt?: number
  createdAt: number
  updatedAt: number
}

/** A cópia física que o usuário tem de um álbum (uma por álbum). */
export interface Copy {
  id?: number
  albumId: number
  pressingYear?: number
  pressingCountry?: string
  pressingLabel?: string
  mediaCondition?: Grade
  sleeveCondition?: Grade
  pricePaidBrl?: number
  purchaseCity?: string
  purchaseCountry?: string
  /** Data da compra em ISO (AAAA-MM-DD). */
  purchaseDate?: string
  notes?: string
  createdAt: number
  updatedAt: number
}

export interface Setting {
  key: string
  value: unknown
}

export const ALBUM_TYPE_LABEL: Record<AlbumType, string> = {
  studio: 'Estúdio',
  live: 'Ao vivo',
  compilation: 'Coletânea',
  ep: 'EP',
}

export const ALBUM_TYPES: AlbumType[] = ['studio', 'live', 'compilation', 'ep']

export const GRADES: Grade[] = ['M', 'NM', 'VG+', 'VG', 'G', 'F', 'P']

export const GRADE_LABEL: Record<Grade, string> = {
  M: 'Mint (perfeito, lacrado)',
  NM: 'Near Mint (quase perfeito)',
  'VG+': 'Very Good Plus (pouquíssimo uso)',
  VG: 'Very Good (uso visível, toca bem)',
  G: 'Good (bastante uso)',
  F: 'Fair (ruim)',
  P: 'Poor (péssimo)',
}

export const RARITY_LABEL: Record<number, string> = {
  1: 'Comum, fácil de achar',
  2: 'Normal, aparece com frequência',
  3: 'Incomum, exige procurar',
  4: 'Raro, poucas cópias no mercado',
  5: 'Raríssimo, item de colecionador',
}

export const STATUS_LABEL: Record<AlbumStatus, string> = {
  none: 'Não tenho',
  have: 'Tenho',
  want: 'Quero',
}
