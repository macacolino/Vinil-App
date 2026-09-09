import { useEffect, useLayoutEffect, useRef } from 'react'
import { useLocation, useNavigationType } from 'react-router-dom'

/**
 * Rolagem previsível entre telas:
 * - abrir uma tela nova (toque num card, num link): começa no topo;
 * - voltar (botão voltar / "‹"): volta para onde a rolagem estava,
 *   esperando a lista carregar até a altura permitir.
 */
const positions = new Map<string, number>()

export function ScrollManager() {
  const location = useLocation()
  const navType = useNavigationType()
  const lastKey = useRef(location.key)

  // Guarda a posição da tela que está sendo deixada.
  useEffect(() => {
    const save = () => positions.set(lastKey.current, window.scrollY)
    window.addEventListener('scroll', save, { passive: true })
    return () => window.removeEventListener('scroll', save)
  }, [])

  useLayoutEffect(() => {
    positions.set(lastKey.current, positions.get(lastKey.current) ?? window.scrollY)
    lastKey.current = location.key
    if (navType === 'POP') {
      const target = positions.get(location.key) ?? 0
      let tries = 0
      const attempt = () => {
        const maxY = document.documentElement.scrollHeight - window.innerHeight
        if (maxY >= target || tries > 40) {
          window.scrollTo(0, target)
          return
        }
        tries += 1
        requestAnimationFrame(attempt)
      }
      attempt()
    } else {
      window.scrollTo(0, 0)
    }
  }, [location.key, navType])

  return null
}
