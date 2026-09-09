import { useEffect, useState } from 'react'

interface Props {
  src?: string
  /** Imagem de reserva (ex.: miniatura do Discogs) se a principal falhar. */
  alt?: string
  fallbackSrc?: string
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
 * Capa do álbum (ou foto). Ordem de tentativas: principal → reserva →
 * principal de novo após 2 s (falhas passageiras do servidor) → ícone.
 */
export function Cover({ src, alt = '', fallbackSrc, size = 'normal' }: Props) {
  const [attempt, setAttempt] = useState(0)
  useEffect(() => setAttempt(0), [src, fallbackSrc])

  const chain: string[] = []
  if (src) chain.push(src)
  if (fallbackSrc && fallbackSrc !== src) chain.push(fallbackSrc)
  if (src) chain.push(src) // segunda tentativa da principal
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
    if (attempt + 1 >= chain.length) {
      setAttempt(chain.length) // esgotou
      return
    }
    // Antes de repetir a principal, espera um pouco.
    const delay = chain[attempt + 1] === src && attempt > 0 ? 2000 : 0
    setTimeout(() => setAttempt((a) => a + 1), delay)
  }

  return (
    <div className={cls}>
      <img key={`${attempt}-${current}`} src={current} alt={alt} loading="lazy" crossOrigin={corsMode(current)} onError={onError} />
    </div>
  )
}

/** Versão menor da capa do Cover Art Archive para listas e cards. */
export function smallCover(url?: string): string | undefined {
  return url?.replace(/\/front-500$/, '/front-250')
}
