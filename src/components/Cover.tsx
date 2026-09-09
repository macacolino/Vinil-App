import { useEffect, useRef, useState } from 'react'

interface Props {
  /** Fontes em ordem de preferência; as vazias são ignoradas. */
  sources: (string | undefined)[]
  /** Versão maior para trocar depois que a primeira aparecer (ex.: 1200 px). */
  upgrade?: string
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
 * A imagem fica invisível até carregar (sem ícone quebrado no meio do caminho)
 * e, se houver `upgrade`, a versão maior é carregada por trás e trocada.
 */
export function Cover({ sources, upgrade, alt = '', size = 'normal' }: Props) {
  const chain = sources.filter((u, i, arr): u is string => !!u && arr.indexOf(u) === i)
  if (chain.length) chain.push(chain[0]) // segunda tentativa da primeira
  const key = chain.join('|')

  // Reinicia o estado quando as fontes mudam, durante a renderização (não num
  // efeito): um efeito rodaria DEPOIS de uma imagem em cache já ter carregado
  // e a esconderia para sempre.
  const [prevKey, setPrevKey] = useState(key)
  const [attempt, setAttempt] = useState(0)
  const [loaded, setLoaded] = useState(false)
  const [upgraded, setUpgraded] = useState<string | null>(null)
  if (key !== prevKey) {
    setPrevKey(key)
    setAttempt(0)
    setLoaded(false)
    setUpgraded(null)
  }
  const imgRef = useRef<HTMLImageElement>(null)

  const current = chain[attempt]
  const cls = `cover${size === 'small' ? ' small' : size === 'large' ? ' large' : ''}`

  // Imagem que já veio do cache pode ter "carregado" antes de o React ligar o onLoad.
  useEffect(() => {
    const img = imgRef.current
    if (img && img.complete && img.naturalWidth > 0) setLoaded(true)
  }, [current, attempt])

  // Versão maior: carrega escondida e troca quando estiver pronta.
  useEffect(() => {
    if (!loaded || !upgrade || upgrade === current || upgraded) return
    let cancelled = false
    const big = new Image()
    const mode = corsMode(upgrade)
    if (mode) big.crossOrigin = mode
    big.onload = () => {
      if (!cancelled) setUpgraded(upgrade)
    }
    big.src = upgrade
    return () => {
      cancelled = true
    }
  }, [loaded, upgrade, current, upgraded])

  if (!current) {
    return (
      <div className={cls} role="img" aria-label={alt}>
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

  const shown = upgraded ?? current
  return (
    <div className={cls} role="img" aria-label={alt}>
      <img
        ref={imgRef}
        key={`${attempt}-${shown}`}
        src={shown}
        alt=""
        loading={size === 'large' ? 'eager' : 'lazy'}
        decoding="async"
        crossOrigin={corsMode(shown)}
        style={loaded || upgraded ? undefined : { visibility: 'hidden' }}
        onLoad={() => setLoaded(true)}
        onError={upgraded ? undefined : onError}
      />
    </div>
  )
}

/** Versão pequena da capa do Cover Art Archive, para listas (miniaturas de ~56 px). */
export function smallCover(url?: string): string | undefined {
  return url?.replace(/\/front-(500|1200)$/, '/front-250')
}

/** Versão grande (1200 px) do Cover Art Archive, para trocar na página do álbum depois de carregar. */
export function largeCover(url?: string): string | undefined {
  const big = url?.replace(/\/front-(250|500)$/, '/front-1200')
  return big && big !== url ? big : undefined
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

/**
 * Página do álbum: primeiro a mesma imagem do card (já em cache, aparece na
 * hora), depois a grande do Discogs e a miniatura; a versão 1200 px entra
 * por trás via `upgrade`.
 */
export function pageSources(album: CoverAlbum): (string | undefined)[] {
  return [album.coverUrl, album.discogsCoverUrl, album.discogsThumb]
}
