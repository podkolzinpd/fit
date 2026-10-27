import { useEffect, useRef, useState } from 'react'
import { decodeBarcodePhoto } from './barcode-photo'
import { pickNativeBarcodePhoto, usesNativeBarcodePicker } from './barcode-native'

export function BarcodePhotoPicker({ onDetected, onUnrecognized, onStart, pending = false }: {
  onDetected: (barcode: string) => void; onUnrecognized: (reason?: 'picker') => void; onStart: () => void; pending?: boolean
}) {
  const input = useRef<HTMLInputElement>(null), active = useRef(true), decoding = useRef(false)
  const [decodingImage, setDecodingImage] = useState(false)
  const choosing = useRef(false)
  const [choosingImage, setChoosingImage] = useState(false)
  useEffect(() => { active.current = true; return () => { active.current = false } }, [])
  const decodeImage = async (file: File | undefined) => {
    if (file === undefined || decoding.current || pending) return
    decoding.current = true
    onStart()
    setDecodingImage(true)
    try {
      const value = await decodeBarcodePhoto(file)
      if (active.current) onDetected(value)
    } catch { if (active.current) onUnrecognized() } finally {
      decoding.current = false
      if (active.current) setDecodingImage(false)
    }
  }
  const chooseImage = async () => {
    if (choosing.current || decoding.current || pending) return
    if (!usesNativeBarcodePicker()) { input.current?.click(); return }
    choosing.current = true
    setChoosingImage(true)
    try {
      const file = await pickNativeBarcodePhoto()
      if (active.current && file) await decodeImage(file)
    } catch { if (active.current) onUnrecognized('picker') } finally {
      choosing.current = false
      if (active.current) setChoosingImage(false)
    }
  }
  return <><button type="button" className="secondary wide nutrition-photo-picker" disabled={decodingImage || choosingImage || pending}
    aria-busy={decodingImage || choosingImage || pending} onClick={() => { void chooseImage() }}>
    {choosingImage && !decodingImage ? 'Выбираем фото…' : decodingImage ? 'Распознаём фото…' : pending ? 'Ищем продукт…' : 'Сканировать штрихкод'}
  </button>
    <input ref={input} aria-label="Фото штрихкода" type="file" accept="image/*" hidden disabled={decodingImage || choosingImage || pending} onChange={(event) => {
      void decodeImage(event.currentTarget.files?.[0])
      event.currentTarget.value = ''
    }} />
  </>
}
