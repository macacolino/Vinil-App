import { useEffect, useState } from 'react'

interface Props {
  /** Fontes em ordem de preferência; as vazias são ignoradas. */
  sources: (string | undefined)[]
  alt?: string
  size?: 'small' | 'normal' | 'large'
}

/** Hosts que respondem com CORS: podem ser pedidos com crossOrigin, o que deixa o cache offline confiável. */
const CORS_HOSTS = /(^|\.)(mzstatic\.com|coverartarchive\.org|archive\.org)$/

function corsMode(url: string): 'anonymous' | undefined {
  try {
    return CORS_HOSTS.test(new URL(url).hostname) ? 'anonymous' : undefined
  } catch {
    return undefined
  }
}

/**
 * Capa do álbum (ou foto). Tenta as fontes em ordem; se todas falharem,
 * repete a primeira após 2 s (falhas passageiras do servidor); depois, ícone.
 */
export function Cover({ sources, alt = '', size = 'normal' }: Props) {
  const chain = sources.filter((u, i, arr): u is string => !!u && arr.indexOf(u) === i)
  if (chain.length) chain.push(chain[0]) // segunda tentativa da primeira
  const key = chain.join('|')
  const [attempt, setAttempt] = useState(0)
  const [loaded, setLoaded] = useState(false)
  useEffect(() => {
    setAttempt(0)
    setLoaded(false)
  }, [key])

  const current = chain[attempt]
  const cls = `cover${size === 'small' ? ' small' : size === 'large' ? ' large' : ''}`

  if (!current) {
    return (
      <div className={cls} aria-label={alt}>
        💿
      </div>
    )
  }

  function onError() {
    const next = attempt + 1
    if (next >= chain.length) {
      setAttempt(chain.length) // esgotou
      return
    }
    const isRetry = next === chain.length - 1
    setTimeout(() => setAttempt(next), isRetry ? 2000 : 0)
  }

  return (
    <div className={cls} role="img" aria-label={alt}>
      {/* alt vazio: enquanto uma fonte falha e a próxima carrega, não mostra ícone quebrado com texto */}
      <img
        key={`${attempt}-${current}`}
        src={current}
        alt=""
        loading="lazy"
        crossOrigin={corsMode(current)}
        style={loaded ? undefined : { visibility: 'hidden' }}
        onLoad={() => setLoaded(true)}
        onError={onError}
      />
    </div>
  )
}

/** Versão pequena da capa do Cover Art Archive, para listas (miniaturas de ~56 px). */
export function smallCover(url?: string): string | undefined {
  return url?.replace(/\/front-(500|1200)$/, '/front-250')
}

/** Versão grande (1200 px) para a página do álbum, nítida em telas de alta densidade. */
export function largeCover(url?: string): string | undefined {
  return url?.replace(/\/front-(250|500)$/, '/front-1200')
}

type CoverAlbum = { coverUrl?: string; discogsCoverUrl?: string; discogsThumb?: string }

/** Fontes para um card (≈170 px): capa em 500 px, depois a grande do Discogs, depois a miniatura. */
export function cardSources(album: CoverAlbum): (string | undefined)[] {
  return [album.coverUrl, album.discogsCoverUrl, album.discogsThumb]
}

/** Fontes para miniatura de lista (56 px). */
export function listSources(album: CoverAlbum): (string | undefined)[] {
  return [smallCover(album.coverUrl), album.discogsCoverUrl, album.discogsThumb]
}

/** Fontes para a página do álbum: 1200 px se existir, senão 500, senão Discogs. */
export function pageSources(album: CoverAlbum): (string | undefined)[] {
  return [largeCover(album.coverUrl), album.coverUrl, album.discogsCoverUrl, album.discogsThumb]
}
