/**
 * Identificadores globais (uid) para sincronização entre aparelhos.
 * São determinísticos: o mesmo artista/álbum gera o mesmo uid em qualquer
 * aparelho, então dois celulares com o Iron Maiden pré-carregado não criam
 * duplicatas na nuvem.
 */

export function slug(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

export function artistUid(a: { mbid?: string; name: string }): string {
  return a.mbid ? `mb-${a.mbid}` : `n-${slug(a.name)}`
}

export function albumUid(album: { mbid?: string; title: string; year: number }, artistUidValue: string): string {
  return album.mbid ? `mb-${album.mbid}` : `${artistUidValue}-a-${slug(album.title)}-${album.year}`
}

export function copyUid(albumUidValue: string): string {
  return `${albumUidValue}-c`
}
