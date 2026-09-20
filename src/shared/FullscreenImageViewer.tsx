import { useEffect, useRef, useState, type TouchEvent as ReactTouchEvent } from 'react'
import { createPortal } from 'react-dom'
import { CloseIcon } from './icons'

export function FullscreenImageViewer({ src, alt, label = 'Просмотр фото', onClose, saveFileName }: {
  src: string
  alt: string
  label?: string
  onClose: () => void
  saveFileName?: string
}) {
  const [zoom, setZoom] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(false)
  const closeButton = useRef<HTMLButtonElement>(null)
  const closeRef = useRef(onClose)
  const gesture = useRef<{ x: number; y: number; distance: number | null } | null>(null)

  useEffect(() => { closeRef.current = onClose }, [onClose])
  useEffect(() => {
    const marker = crypto.randomUUID()
    window.history.pushState({ ...window.history.state, fitImageLayer: marker }, '')
    const pop = () => closeRef.current()
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') window.history.back() }
    window.addEventListener('popstate', pop)
    window.addEventListener('keydown', key)
    closeButton.current?.focus({ preventScroll: true })
    return () => {
      window.removeEventListener('popstate', pop)
      window.removeEventListener('keydown', key)
    }
  }, [])

  const close = () => window.history.back()
  async function save() {
    if (!saveFileName || saving) return
    setSaving(true); setError(false)
    try {
      const blob = await (await fetch(src)).blob()
      const file = new File([blob], saveFileName, { type: blob.type || 'image/jpeg' })
      if (navigator.share && navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file] })
      else {
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a'); link.href = url; link.download = file.name; link.click()
        window.setTimeout(() => URL.revokeObjectURL(url), 1_000)
      }
    } catch { setError(true) } finally { setSaving(false) }
  }
  function distance(event: ReactTouchEvent) {
    const first = event.touches[0]; const second = event.touches[1]
    return first && second ? Math.hypot(second.clientX - first.clientX, second.clientY - first.clientY) : null
  }
  function beginGesture(event: ReactTouchEvent) {
    event.stopPropagation()
    const touch = event.touches[0]
    if (touch) gesture.current = { x: touch.clientX, y: touch.clientY, distance: distance(event) }
  }
  function moveGesture(event: ReactTouchEvent) {
    event.stopPropagation()
    const start = gesture.current; const touch = event.touches[0]
    if (!start || !touch) return
    const nextDistance = distance(event)
    if (nextDistance !== null && start.distance !== null) {
      const startDistance = start.distance
      setZoom((value) => Math.min(3, Math.max(1, value * nextDistance / startDistance)))
      gesture.current = { x: touch.clientX, y: touch.clientY, distance: nextDistance }; return
    }
    if (zoom > 1) {
      setOffset((value) => ({ x: value.x + touch.clientX - start.x, y: value.y + touch.clientY - start.y }))
      gesture.current = { x: touch.clientX, y: touch.clientY, distance: null }
    }
  }
  function endGesture(event: ReactTouchEvent) {
    event.stopPropagation()
    const start = gesture.current; const touch = event.changedTouches[0]
    gesture.current = null
    if (zoom !== 1 || !start || !touch) return
    const deltaX = touch.clientX - start.x
    const deltaY = touch.clientY - start.y
    const swipeDown = deltaY > 90 && Math.abs(deltaX) < 60
    const swipeBack = start.x <= 32 && deltaX > 90 && Math.abs(deltaY) < 70
    if (swipeDown || swipeBack) close()
  }
  function changeZoom(next: number) { setZoom(next); if (next === 1) setOffset({ x: 0, y: 0 }) }

  return createPortal(<section className="fullscreen-image-viewer" role="dialog" aria-modal="true" aria-label={label}>
    <header><button ref={closeButton} type="button" aria-label="Закрыть фото" onClick={close}><CloseIcon /></button>
      {saveFileName && <button type="button" onClick={() => void save()} disabled={saving}>{saving ? 'Сохраняем…' : 'Сохранить'}</button>}</header>
    <div className="fullscreen-image-stage" onDoubleClick={() => changeZoom(zoom === 1 ? 2 : 1)} onTouchStart={beginGesture} onTouchMove={moveGesture} onTouchEnd={endGesture}>
      <img src={src} alt={alt} draggable={false} style={{ transform: `translate(${offset.x}px,${offset.y}px) scale(${zoom})` }} />
    </div>
    <div className="fullscreen-image-controls" aria-label="Масштаб"><button type="button" aria-label="Уменьшить" disabled={zoom <= 1} onClick={() => changeZoom(Math.max(1, zoom - .5))}>−</button><span>{Math.round(zoom * 100)}%</span><button type="button" aria-label="Увеличить" disabled={zoom >= 3} onClick={() => changeZoom(Math.min(3, zoom + .5))}>+</button></div>
    {error && <p role="alert">Не удалось сохранить фото</p>}
  </section>, document.body)
}
