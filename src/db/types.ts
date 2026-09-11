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
  /** Identificador global para sincronização (ver db/uid.ts). */
  uid: string
  /** 1 = alterado neste aparelho e ainda não enviado à nuvem. */
  dirty?: number
  name: string
  country?: string
  /** Código ISO do país (ex.: GB), usado para escolher a edição de referência. */
  countryCode?: string
  notes?: string
  /** Chaves em fontes externas (fase 3). */
  mbid?: string
  discogsId?: number
  /** Quando a discografia foi conferida com o filtro "só edições em vinil". */
  discographyReviewedAt?: number
  /** Foto do artista (Discogs) ou URL informada pelo usuário. */
  imageUrl?: string
  imageSource?: 'manual' | 'discogs'
  imageCheckedAt?: number
  createdAt: number
  updatedAt: number
}

export interface Album {
  id?: number
  uid: string
  dirty?: number
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
  /** Preço e raridade: "manual" = definido pelo usuário, não é sobrescrito. */
  priceSource?: 'manual' | 'discogs'
  raritySource?: 'manual' | 'discogs'
  /** Dados do Discogs (fase 3). */
  discogsMasterId?: number
  /** "manual" = o usuário escolheu a página do Discogs; a busca automática não troca mais. */
  discogsMasterSource?: 'manual' | 'auto'
  discogsReleaseId?: number
  discogsInCollection?: number
  discogsForSale?: number
  /** A edição de referência está bloqueada para venda no Discogs. */
  discogsBlocked?: boolean
  /** Miniatura da capa no Discogs (150 px), usada como última reserva. */
  discogsThumb?: string
  /** Capa grande no Discogs (até 600 px), reserva de boa qualidade. */
  discogsCoverUrl?: string
  discogsCoverCheckedAt?: number
  discogsCheckedAt?: number
  /** Versão da regra usada na última consulta (ver PRICING_ALGO). */
  discogsAlgo?: number
  /** Edições (prensagens) deste álbum que o usuário escaneou ou anotou. */
  editions?: AlbumEdition[]
  createdAt: number
  updatedAt: number
}

/**
 * Uma edição específica do álbum (prensagem), identificada pelo código de
 * barras ou número de catálogo. Fica dentro do álbum para sincronizar junto.
 */
export interface AlbumEdition {
  /** Chave local: "dg-<release>" (Discogs), "mb-<release>" (MusicBrainz) ou "code-<código>". */
  key: string
  discogsReleaseId?: number
  discogsMasterId?: number
  mbReleaseId?: string
  barcode?: string
  catalogNumber?: string
  year?: number
  country?: string
  label?: string
  /** Descrição do formato, ex.: "LP, Album, Reissue, 180 gr". */
  format?: string
  thumb?: string
  /** true = tenho esta edição; false = só vi (loja, feira, sebo…). */
  owned: boolean
  /** Menor anúncio (USD) e quantos à venda desta edição exata no Discogs. */
  lowestUsd?: number
  forSale?: number
  inCollection?: number
  priceCheckedAt?: number
  /** Quando foi escaneada/anotada. */
  seenAt: number
  notes?: string
}

/** A cópia física que o usuário tem de um álbum (uma por álbum). */
export interface Copy {
  id?: number
  uid: string
  dirty?: number
  albumId: number
  pressingYear?: number
  pressingCountry?: string
  pressingLabel?: string
  /** Número de catálogo da edição (lombada/selo) e código de barras. */
  catalogNumber?: string
  barcode?: string
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
  updatedAt?: number
  dirty?: number
}

/** Registro de exclusão, para avisar a nuvem e os outros aparelhos. */
export interface Tombstone {
  uid: string
  table: 'artists' | 'albums' | 'copies' | 'settings'
  deletedAt: number
}

export type SyncTable = Tombstone['table']

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
