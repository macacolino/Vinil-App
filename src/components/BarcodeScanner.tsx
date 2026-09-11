import { useEffect, useRef, useState } from 'react'

interface Props {
  onDetected: (code: string) => void
  onClose: () => void
}

/** Formatos usados em discos: EAN/UPC (código de barras comum) e Code 128/39 (etiquetas). */
const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39']

type NativeDetector = { detect: (src: HTMLVideoElement) => Promise<{ rawValue: string }[]> }
type NativeDetectorCtor = new (opts: { formats: string[] }) => NativeDetector

/** Leitor nativo do navegador (Chrome no Android tem; Safari e PC geralmente não). */
async function nativeDetector(): Promise<NativeDetector | null> {
  const ctor = (window as unknown as { BarcodeDetector?: NativeDetectorCtor & { getSupportedFormats?: () => Promise<string[]> } }).BarcodeDetector
  if (!ctor) return null
  try {
    const supported = (await ctor.getSupportedFormats?.()) ?? FORMATS
    const formats = FORMATS.filter((f) => supported.includes(f))
    if (!formats.length) return null
    return new ctor({ formats })
  } catch {
    return null
  }
}

/** Código de barras válido para um disco: só dígitos (8 a 14) ou uma etiqueta curta. */
export function acceptCode(raw: string): string | null {
  const t = raw.trim()
  if (/^\d{8,14}$/.test(t)) return t
  if (/^[A-Za-z0-9 .\-/]{4,30}$/.test(t)) return t
  return null
}

/**
 * Abre a câmera traseira e avisa quando lê um código. Usa o leitor nativo
 * quando existe; senão carrega a biblioteca ZXing (só quando precisa, para
 * não pesar o app).
 */
export function BarcodeScanner({ onDetected, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [engine, setEngine] = useState<'nativo' | 'zxing' | null>(null)
  const done = useRef(false)

  useEffect(() => {
    let cancelled = false
    let stream: MediaStream | null = null
    let stop: (() => void) | null = null

    const finish = (code: string) => {
      if (done.current || cancelled) return
      done.current = true
      try {
        navigator.vibrate?.(80)
      } catch {
        /* sem vibração */
      }
      onDetected(code)
    }

    async function start() {
      const video = videoRef.current
      if (!video) return
      if (!navigator.mediaDevices?.getUserMedia) {
        setError('Este navegador não dá acesso à câmera. Digite o código abaixo.')
        return
      }
      const constraints: MediaStreamConstraints = { video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false }
      try {
        const native = await nativeDetector()
        if (native) {
          stream = await navigator.mediaDevices.getUserMedia(constraints)
          if (cancelled) return
          video.srcObject = stream
          await video.play()
          setEngine('nativo')
          let timer: ReturnType<typeof setTimeout> | undefined
          const tick = async () => {
            if (cancelled || done.current) return
            try {
              if (video.readyState >= 2) {
                const codes = await native.detect(video)
                const ok = codes.map((c) => acceptCode(c.rawValue)).find(Boolean)
                if (ok) return finish(ok)
              }
            } catch {
              /* quadro inválido: tenta de novo */
            }
            timer = setTimeout(tick, 150)
          }
          void tick()
          stop = () => clearTimeout(timer)
          return
        }
        const { BrowserMultiFormatReader } = await import('@zxing/browser')
        const { BarcodeFormat, DecodeHintType } = await import('@zxing/library')
        if (cancelled) return
        const hints = new Map()
        hints.set(DecodeHintType.POSSIBLE_FORMATS, [
          BarcodeFormat.EAN_13,
          BarcodeFormat.EAN_8,
          BarcodeFormat.UPC_A,
          BarcodeFormat.UPC_E,
          BarcodeFormat.CODE_128,
          BarcodeFormat.CODE_39,
        ])
        hints.set(DecodeHintType.TRY_HARDER, true)
        const reader = new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 150 })
        const controls = await reader.decodeFromConstraints(constraints, video, (result) => {
          if (!result) return
          const ok = acceptCode(result.getText())
          if (ok) finish(ok)
        })
        if (cancelled) {
          controls.stop()
          return
        }
        setEngine('zxing')
        stop = () => controls.stop()
      } catch (err) {
        if (cancelled) return
        const name = err instanceof Error ? err.name : ''
        setError(
          name === 'NotAllowedError'
            ? 'Sem permissão para usar a câmera. Libere o acesso nas configurações do navegador ou digite o código abaixo.'
            : name === 'NotFoundError'
              ? 'Nenhuma câmera encontrada neste aparelho. Digite o código abaixo.'
              : `Não consegui abrir a câmera (${err instanceof Error ? err.message : String(err)}). Digite o código abaixo.`,
        )
      }
    }
    void start()

    return () => {
      cancelled = true
      stop?.()
      stream?.getTracks().forEach((t) => t.stop())
      const v = videoRef.current
      if (v) v.srcObject = null
    }
  }, [onDetected])

  return (
    <div className="scanner">
      <div className="scanner-view">
        <video ref={videoRef} playsInline muted autoPlay />
        {!error && <div className="scanner-frame" aria-hidden="true" />}
      </div>
      {error ? (
        <div className="notice" style={{ marginTop: 10 }}>
          {error}
        </div>
      ) : (
        <p className="muted" style={{ marginTop: 8, fontSize: '0.85rem' }}>
          Aponte para o código de barras (geralmente na contracapa). {engine ? '' : 'Abrindo a câmera…'}
        </p>
      )}
      <div className="btn-row">
        <button type="button" className="btn ghost small" onClick={onClose}>
          Fechar câmera
        </button>
      </div>
    </div>
  )
}

/** Usado nos testes automatizados: decodifica uma imagem (data URL) com a ZXing. */
export async function decodeImage(url: string): Promise<string | null> {
  const { BrowserMultiFormatReader } = await import('@zxing/browser')
  const { BarcodeFormat, DecodeHintType } = await import('@zxing/library')
  const hints = new Map()
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.EAN_13, BarcodeFormat.UPC_A, BarcodeFormat.CODE_128])
  hints.set(DecodeHintType.TRY_HARDER, true)
  try {
    const r = await new BrowserMultiFormatReader(hints).decodeFromImageUrl(url)
    return r.getText()
  } catch {
    return null
  }
}
