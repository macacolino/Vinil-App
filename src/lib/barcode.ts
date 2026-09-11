/**
 * Busca por código de barras (ou número de catálogo) e registro da edição
 * encontrada: identifica o álbum, cria o artista e o álbum se ainda não
 * existirem e guarda a edição (prensagem) dentro do álbum.
 *
 * Fontes: Discogs (edições, preço da edição exata) e MusicBrainz (ids do
 * artista e do álbum, para a discografia inteira ser importada como no
 * fluxo normal de "Novo artista").
 */
import { db } from '../db/db'
import { uniqueUid } from '../db/ops'
import type { Album, AlbumEdition, Artist, Copy } from '../db/types'
import { albumUid, artistUid, copyUid } from '../db/uid'
import {
  fetchReleaseDetails,
  fetchStats,
  searchReleasesByCode as discogsSearch,
  type ReleaseCandidate,
  type ReleaseDetails,
} from './discogs'
import { createAlbumFromMaster, createArtistFromMusicBrainz, DEFAULT_IMPORTED_RARITY } from './importArtist'
import { enqueueImport } from './jobs'
import { coverArtUrl, searchArtists, searchReleasesByCode as mbSearch, type MBReleaseHit } from './musicbrainz'

export type CodeKind = 'barcode' | 'catno'

/** Limpa o que o usuário digitou/escaneou e diz se é código de barras ou catálogo. */
export function classifyCode(raw: string): { code: string; kind: CodeKind } | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const digits = trimmed.replace(/[\s-]/g, '')
  if (/^\d{8,14}$/.test(digits)) return { code: digits, kind: 'barcode' }
  if (trimmed.length < 3) return null
  return { code: trimmed.replace(/\s+/g, ' '), kind: 'catno' }
}

/** Formas equivalentes do código (EAN-13 com zero à esquerda = UPC-A de 12 dígitos). */
export function barcodeVariants(code: string): string[] {
  const out = [code]
  if (code.length === 13 && code.startsWith('0')) out.push(code.slice(1))
  else if (code.length === 12) out.push(`0${code}`)
  return out
}

/** Uma edição encontrada, já cruzando Discogs e MusicBrainz quando possível. */
export interface EditionCandidate {
  key: string
  source: 'discogs' | 'musicbrainz'
  discogs?: ReleaseCandidate
  mb?: MBReleaseHit
  artistName: string
  title: string
  year?: number
  country?: string
  label?: string
  catno?: string
  format?: string
  vinyl: boolean
  thumb?: string
  have?: number
}

export interface LookupResult {
  code: string
  kind: CodeKind
  candidates: EditionCandidate[]
  /** Mensagens de erro parciais (uma fonte falhou, a outra respondeu). */
  warnings: string[]
}

const norm = (t: string) =>
  t
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/^the\s+/, '')
    .replace(/[^a-z0-9]/g, '')

const COUNTRY_PT: Record<string, string> = {
  uk: 'Reino Unido',
  us: 'Estados Unidos',
  usa: 'Estados Unidos',
  europe: 'Europa',
  brazil: 'Brasil',
  germany: 'Alemanha',
  japan: 'Japão',
  netherlands: 'Holanda',
  france: 'França',
  italy: 'Itália',
  spain: 'Espanha',
  canada: 'Canadá',
  australia: 'Austrália',
  mexico: 'México',
  sweden: 'Suécia',
  norway: 'Noruega',
  denmark: 'Dinamarca',
  worldwide: 'Mundial',
  'uk & europe': 'Reino Unido e Europa',
  'usa & canada': 'EUA e Canadá',
  'usa & europe': 'EUA e Europa',
  unknown: 'desconhecido',
  xe: 'Europa',
  xw: 'Mundial',
  gb: 'Reino Unido',
  br: 'Brasil',
  de: 'Alemanha',
  jp: 'Japão',
  nl: 'Holanda',
  fr: 'França',
  it: 'Itália',
  es: 'Espanha',
  ca: 'Canadá',
  au: 'Austrália',
  ar: 'Argentina',
  pt: 'Portugal',
  mx: 'México',
  cl: 'Chile',
}

/** País como o Discogs/MusicBrainz escrevem → português (quando conhecido). */
export function countryPt(raw: string | undefined): string | undefined {
  if (!raw) return undefined
  return COUNTRY_PT[raw.trim().toLowerCase()] ?? raw
}

function mbToCandidate(hit: MBReleaseHit): EditionCandidate {
  return {
    key: `mb-${hit.releaseId}`,
    source: 'musicbrainz',
    mb: hit,
    artistName: hit.artistName,
    title: hit.title,
    year: hit.date ? Number.parseInt(hit.date.slice(0, 4), 10) || undefined : undefined,
    country: countryPt(hit.country),
    label: hit.label,
    catno: hit.catno,
    format: hit.format,
    vinyl: /vinyl/i.test(hit.format ?? ''),
  }
}

/**
 * Procura o código nas duas fontes ao mesmo tempo. O Discogs manda na lista
 * (tem mais edições catalogadas); o MusicBrainz entra para dar os ids que a
 * importação da discografia usa e como reserva quando o Discogs não tem nada.
 */
export async function lookupCode(raw: string): Promise<LookupResult> {
  const c = classifyCode(raw)
  if (!c) throw new Error('Digite um código de barras (8 a 14 dígitos) ou um número de catálogo.')
  const { code, kind } = c
  const warnings: string[] = []
  const [dg, mb] = await Promise.all([
    discogsSearch(code, kind, 'high').catch((err: unknown) => {
      warnings.push(`Discogs: ${err instanceof Error ? err.message : String(err)}`)
      return [] as ReleaseCandidate[]
    }),
    mbSearch(code, kind, 'high').catch((err: unknown) => {
      warnings.push(`MusicBrainz: ${err instanceof Error ? err.message : String(err)}`)
      return [] as MBReleaseHit[]
    }),
  ])

  const candidates: EditionCandidate[] = dg.map((r) => {
    // Casa com o lançamento do MusicBrainz de mesmo artista e título (e, se der, mesmo país/ano).
    const same = mb.filter((h) => norm(h.artistName) === norm(r.artistName) && norm(h.title) === norm(r.title))
    const best =
      same.find((h) => countryPt(h.country) === countryPt(r.country) && h.date?.startsWith(String(r.year ?? ''))) ??
      same.find((h) => h.date?.startsWith(String(r.year ?? ''))) ??
      same[0]
    return {
      key: `dg-${r.releaseId}`,
      source: 'discogs',
      discogs: r,
      mb: best,
      artistName: r.artistName,
      title: r.title,
      year: r.year,
      country: countryPt(r.country),
      label: r.label,
      catno: r.catno,
      format: r.formats.filter((f) => f !== 'Vinyl').join(', ') || undefined,
      vinyl: r.vinyl,
      thumb: r.thumb || r.coverImage,
      have: r.have,
    }
  })
  if (!candidates.length) candidates.push(...mb.map(mbToCandidate))
  if (!candidates.length && warnings.length === 2) throw new Error(warnings.join(' · '))
  return { code, kind, candidates, warnings }
}

/** Onde uma edição já está registrada localmente (álbum + edição). */
export interface LocalEdition {
  album: Album
  edition: AlbumEdition
}

/** Índice das edições já registradas, por chave e por código de barras. */
export async function loadLocalEditions(): Promise<Map<string, LocalEdition>> {
  const map = new Map<string, LocalEdition>()
  for (const album of await db.albums.toArray()) {
    for (const edition of album.editions ?? []) {
      map.set(edition.key, { album, edition })
      if (edition.barcode) for (const v of barcodeVariants(edition.barcode)) map.set(`bc-${v}`, { album, edition })
    }
  }
  return map
}

export function findLocalEdition(index: Map<string, LocalEdition>, candidate: EditionCandidate, code?: string, kind?: CodeKind): LocalEdition | undefined {
  const byKey = index.get(candidate.key)
  if (byKey) return byKey
  if (kind === 'barcode' && code) {
    for (const v of barcodeVariants(code)) {
      const hit = index.get(`bc-${v}`)
      if (hit && norm(hit.album.title) === norm(candidate.title)) return hit
    }
  }
  return undefined
}

async function findLocalArtist(mbid: string | undefined, name: string): Promise<Artist | undefined> {
  if (mbid) {
    const byMbid = await db.artists.where('mbid').equals(mbid).first()
    if (byMbid) return byMbid
  }
  const wanted = norm(name)
  if (!wanted) return undefined
  return (await db.artists.toArray()).find((a) => norm(a.name) === wanted)
}

/** Artista do MusicBrainz com o nome igual ao do Discogs (o mais bem pontuado). */
async function matchMusicBrainzArtist(name: string) {
  const found = await searchArtists(name, undefined, 8)
  const wanted = norm(name)
  return found.find((a) => norm(a.name) === wanted) ?? null
}

export interface RegisterOptions {
  /** true = "tenho esta edição"; false = "só vi". */
  owned: boolean
  code?: string
  kind?: CodeKind
  onProgress?: (message: string) => void
}

export interface RegisterResult {
  artist: Artist
  album: Album
  edition: AlbumEdition
  newArtist: boolean
  newAlbum: boolean
  /** A discografia do artista novo está sendo importada em segundo plano. */
  importing: boolean
}

/**
 * Registra a edição escolhida: garante artista e álbum (criando se preciso),
 * consulta o preço da edição exata e grava a edição dentro do álbum. Com
 * `owned`, marca o álbum como "tenho" e preenche a cópia com a prensagem.
 */
export async function registerEdition(candidate: EditionCandidate, opts: RegisterOptions): Promise<RegisterResult> {
  const { owned, onProgress } = opts
  const now = Date.now()

  // 1) Detalhes da edição no Discogs (id do artista, master, catálogo, faixas, capa).
  let details: ReleaseDetails | null = null
  if (candidate.discogs) {
    onProgress?.('Lendo os dados da edição no Discogs…')
    try {
      details = await fetchReleaseDetails(candidate.discogs.releaseId, 'high')
    } catch {
      details = null
    }
  }
  const artistName = candidate.mb?.artistName || details?.artists[0]?.name || candidate.artistName
  // Título: o do MusicBrainz quando há (é o que a importação da discografia usa), senão o do Discogs.
  const title = (candidate.mb?.title || details?.title || candidate.title).trim()
  const masterId = details?.masterId ?? candidate.discogs?.masterId
  const rgId = candidate.mb?.releaseGroupId

  // 2) Artista: existente, do MusicBrainz (com importação da discografia) ou manual.
  let artist = await findLocalArtist(candidate.mb?.artistMbid, artistName)
  let newArtist = false
  let importing = false
  if (!artist) {
    onProgress?.(`Procurando "${artistName}" no MusicBrainz…`)
    let mb = candidate.mb?.artistMbid ? { id: candidate.mb.artistMbid, name: artistName, score: 100 } : null
    if (!mb) {
      try {
        mb = await matchMusicBrainzArtist(artistName)
      } catch {
        mb = null
      }
    }
    if (mb) {
      const { artistId } = await createArtistFromMusicBrainz(mb)
      artist = (await db.artists.get(artistId))!
      enqueueImport(artistId, mb.name)
      importing = true
    } else {
      const id = (await db.artists.add({
        uid: await uniqueUid('artists', artistUid({ name: artistName })),
        name: artistName,
        discogsId: details?.artists[0]?.id,
        createdAt: now,
        updatedAt: now,
      })) as number
      artist = (await db.artists.get(id))!
    }
    newArtist = true
  } else if (!artist.discogsId && details?.artists[0]?.id) {
    await db.artists.update(artist.id!, { discogsId: details.artists[0].id, updatedAt: now })
  }

  // 3) Álbum: pelo id do MusicBrainz, pelo master do Discogs ou pelo título.
  const albums = await db.albums.where('artistId').equals(artist.id!).toArray()
  let album =
    (rgId && albums.find((a) => a.mbid === rgId)) ||
    (masterId && albums.find((a) => a.discogsMasterId === masterId)) ||
    albums.find((a) => norm(a.title) === norm(title))
  let newAlbum = false
  if (!album) {
    onProgress?.(`Criando o álbum "${title}"…`)
    let albumId: number
    if (rgId) {
      albumId = (await db.albums.add({
        uid: await uniqueUid('albums', albumUid({ mbid: rgId, title, year: candidate.year ?? 0 }, artist.uid)),
        artistId: artist.id!,
        title,
        year: candidate.year ?? 0,
        type: candidate.mb?.albumType ?? 'studio',
        label: candidate.label,
        coverUrl: coverArtUrl(rgId, 500),
        discogsCoverUrl: details?.coverUrl,
        discogsThumb: details?.thumb ?? candidate.thumb,
        tracks: details?.tracks ?? [],
        rarity: DEFAULT_IMPORTED_RARITY,
        status: 'none',
        mbid: rgId,
        discogsMasterId: masterId,
        discogsMasterSource: masterId ? 'auto' : undefined,
        createdAt: now,
        updatedAt: now,
      })) as number
    } else if (masterId && candidate.discogs) {
      albumId = await createAlbumFromMaster(artist, {
        masterId,
        title: `${artistName} - ${title}`,
        year: candidate.year,
        have: candidate.discogs.have,
        want: candidate.discogs.want,
        unofficial: false,
        formats: candidate.discogs.formats,
        thumb: candidate.discogs.thumb,
        coverImage: candidate.discogs.coverImage,
      })
    } else {
      albumId = (await db.albums.add({
        uid: await uniqueUid('albums', details ? `dg-r-${details.releaseId}` : albumUid({ title, year: candidate.year ?? 0 }, artist.uid)),
        artistId: artist.id!,
        title,
        year: candidate.year ?? 0,
        type: 'studio',
        label: candidate.label,
        coverUrl: details?.coverUrl ?? candidate.thumb,
        discogsCoverUrl: details?.coverUrl,
        discogsThumb: details?.thumb ?? candidate.thumb,
        tracks: details?.tracks ?? [],
        rarity: DEFAULT_IMPORTED_RARITY,
        status: 'none',
        createdAt: now,
        updatedAt: now,
      })) as number
    }
    album = (await db.albums.get(albumId))!
    newAlbum = true
  } else if (masterId && !album.discogsMasterId) {
    await db.albums.update(album.id!, { discogsMasterId: masterId, discogsMasterSource: 'auto', updatedAt: now })
  }

  // 4) Preço da edição exata.
  let stats: { lowestUsd?: number; numForSale: number } | null = null
  if (candidate.discogs) {
    onProgress?.('Consultando o preço desta edição…')
    try {
      stats = await fetchStats(candidate.discogs.releaseId, 'high')
    } catch {
      stats = null
    }
  }

  // 5) Edição dentro do álbum (substitui se já existia, mantendo "tenho" se já era).
  const existing = (album.editions ?? []).find((e) => e.key === candidate.key)
  const edition: AlbumEdition = {
    key: candidate.key,
    discogsReleaseId: candidate.discogs?.releaseId,
    discogsMasterId: masterId,
    mbReleaseId: candidate.mb?.releaseId,
    barcode: opts.kind === 'barcode' ? opts.code : details?.barcode ?? candidate.discogs?.barcodes[0] ?? candidate.mb?.barcode,
    catalogNumber: details?.catno ?? candidate.catno,
    year: details?.year ?? candidate.year,
    country: countryPt(details?.country) ?? candidate.country,
    label: details?.label ?? candidate.label,
    format: details?.format ?? candidate.format,
    thumb: details?.thumb ?? candidate.thumb,
    owned: owned || !!existing?.owned,
    lowestUsd: stats?.lowestUsd ?? existing?.lowestUsd,
    forSale: stats?.numForSale ?? existing?.forSale,
    inCollection: candidate.discogs?.have ?? existing?.inCollection,
    priceCheckedAt: stats ? now : existing?.priceCheckedAt,
    seenAt: existing?.seenAt ?? now,
    notes: existing?.notes,
  }
  const editions = [...(album.editions ?? []).filter((e) => e.key !== candidate.key), edition]
  const patch: Partial<Album> = { editions, updatedAt: now }
  if (owned) patch.status = 'have'
  await db.albums.update(album.id!, patch)

  // 6) "Tenho": cópia com os dados da prensagem (só preenche o que estava vazio).
  if (owned) {
    const copy = await db.copies.where('albumId').equals(album.id!).first()
    const fill: Partial<Copy> = {
      pressingYear: copy?.pressingYear ?? edition.year,
      pressingCountry: copy?.pressingCountry ?? edition.country,
      pressingLabel: copy?.pressingLabel ?? edition.label,
      catalogNumber: copy?.catalogNumber ?? edition.catalogNumber,
      barcode: copy?.barcode ?? edition.barcode,
    }
    if (copy?.id) await db.copies.update(copy.id, { ...fill, updatedAt: now })
    else await db.copies.add({ ...fill, uid: copyUid(album.uid), albumId: album.id!, createdAt: now, updatedAt: now })
  }

  return { artist, album: (await db.albums.get(album.id!))!, edition, newArtist, newAlbum, importing }
}

/** Marca uma edição já registrada como "tenho" (ou desfaz). */
export async function setEditionOwned(albumId: number, key: string, owned: boolean) {
  const album = await db.albums.get(albumId)
  if (!album) return
  const editions = (album.editions ?? []).map((e) => (e.key === key ? { ...e, owned } : e))
  const now = Date.now()
  const patch: Partial<Album> = { editions, updatedAt: now }
  if (owned && album.status !== 'have') patch.status = 'have'
  await db.albums.update(albumId, patch)
  if (owned) {
    const edition = editions.find((e) => e.key === key)!
    const copy = await db.copies.where('albumId').equals(albumId).first()
    const fill: Partial<Copy> = {
      pressingYear: copy?.pressingYear ?? edition.year,
      pressingCountry: copy?.pressingCountry ?? edition.country,
      pressingLabel: copy?.pressingLabel ?? edition.label,
      catalogNumber: copy?.catalogNumber ?? edition.catalogNumber,
      barcode: copy?.barcode ?? edition.barcode,
    }
    if (copy?.id) await db.copies.update(copy.id, { ...fill, updatedAt: now })
    else await db.copies.add({ ...fill, uid: copyUid(album.uid), albumId, createdAt: now, updatedAt: now })
  }
}

/** Remove uma edição anotada do álbum. */
export async function removeEdition(albumId: number, key: string) {
  const album = await db.albums.get(albumId)
  if (!album) return
  await db.albums.update(albumId, { editions: (album.editions ?? []).filter((e) => e.key !== key), updatedAt: Date.now() })
}
