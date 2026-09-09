import { useEffect, useState } from 'react'

interface Props {
  src?: string
  alt: string
  size?: 'small' | 'normal' | 'large'
}

/** Capa do álbum com fallback quando não há imagem ou ela falha ao carregar. */
export function Cover({ src, alt, size = 'normal' }: Props) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [src])
  const cls = `cover${size === 'small' ? ' small' : size === 'large' ? ' large' : ''}`
  if (!src || failed) {
    return (
      <div className={cls} aria-label={alt}>
        💿
      </div>
    )
  }
  return (
    <div className={cls}>
      {/* crossOrigin: os servidores de capa permitem CORS, e assim o cache offline
          guarda só respostas boas (sem CORS, um erro vira resposta "opaca" e poderia ficar em cache). */}
      <img src={src} alt={alt} loading="lazy" crossOrigin="anonymous" onError={() => setFailed(true)} />
    </div>
  )
}
