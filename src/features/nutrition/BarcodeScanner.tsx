import { BarcodeFormat, BrowserMultiFormatReader } from '@zxing/browser'
import { useEffect, useRef, useState } from 'react'

function validEan(value: string) { return /^\d{8}$|^\d{13}$/.test(value) }

export function BarcodePhotoPicker({ onDetected, onUnrecognized }: { onDetected: (barcode: string) => void; onUnrecognized: () => void }) {
  const [decodingImage, setDecodingImage] = useState(false)
  const decodeImage = async (file: File | undefined) => {
    if (file === undefined) return
    setDecodingImage(true)
    const url = URL.createObjectURL(file)
    try {
      const result = await new BrowserMultiFormatReader().decodeFromImageUrl(url)
      const value = result.getText().replace(/\s|-/g, '')
      if (!validEan(value) || ![BarcodeFormat.EAN_8, BarcodeFormat.EAN_13].includes(result.getBarcodeFormat())) throw new Error('unsupported_barcode')
      onDetected(value)
    } catch { onUnrecognized() } finally {
      URL.revokeObjectURL(url); setDecodingImage(false)
    }
  }
  return <label className="secondary nutrition-photo-picker">{decodingImage ? 'Распознаём фото…' : 'Выбрать фото'}
    <input type="file" accept="image/*" hidden disabled={decodingImage} onChange={(event) => {
      void decodeImage(event.currentTarget.files?.[0])
      event.currentTarget.value = ''
    }} />
  </label>
}

export function BarcodeScanner({ onDetected, onClose }: { onDetected: (barcode: string) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null), onDetectedRef = useRef(onDetected)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { onDetectedRef.current = onDetected }, [onDetected])
  useEffect(() => {
    const reader = new BrowserMultiFormatReader(undefined, { delayBetweenScanAttempts: 150 })
    let cancelled = false, controls: { stop(): void } | undefined
    void reader.decodeFromConstraints({ audio: false, video: { facingMode: { ideal: 'environment' } } }, video.current ?? undefined,
      (result) => {
        const value = result?.getText().replace(/\s|-/g, '') ?? ''
        if (!cancelled && validEan(value) && [BarcodeFormat.EAN_8, BarcodeFormat.EAN_13].includes(result!.getBarcodeFormat())) {
          cancelled = true
          controls?.stop()
          onDetectedRef.current(value)
        }
      }).then((next) => { controls = next; if (cancelled) controls.stop() }).catch(() => {
      if (!cancelled) setError('Не удалось открыть камеру. Проверьте разрешение или выберите фото.')
      })
    return () => { cancelled = true; controls?.stop() }
  }, [])
  return <section className="nutrition-scanner" role="dialog" aria-label="Сканер штрихкода">
    <video ref={video} autoPlay muted playsInline aria-label="Камера для сканирования штрихкода" />
    <p className="muted">Наведите камеру на штрихкод</p>
    {error && <p className="muted" role="status">{error}</p>}
    <button type="button" className="secondary" onClick={onClose}>Закрыть камеру</button>
  </section>
}
