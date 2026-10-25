import { useCallback, useEffect, useRef, type PointerEvent, type MouseEvent } from 'react'

type Drag = { element: HTMLElement; id: number; x: number; y: number; offset: number; moved: boolean; at: number; velocity: number }
function releaseCapture(element: HTMLElement, id: number) {
  if (element.hasPointerCapture?.(id)) element.releasePointerCapture(id)
}

/** Header-only v79 presentation. The list owns its native vertical scroll;
 * nested drafts and every mutation remain with ExercisePicker. */
export function useCoachV79PickerDrag(enabled: boolean, close: () => void) {
  const drag = useRef<Drag | null>(null)
  const ignoreClick = useRef(false)
  const releaseClick = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cancel = useCallback(() => {
    const current = drag.current
    drag.current = null
    if (current) {
      releaseCapture(current.element, current.id)
      current.element.removeAttribute('data-v79-dragging')
      current.element.style.setProperty('--v79-picker-drag', '0px')
    }
  }, [])
  useEffect(() => {
    if (!enabled && drag.current) cancel()
    return () => {
      if (drag.current) cancel()
      if (releaseClick.current !== null) clearTimeout(releaseClick.current)
    }
  }, [enabled, cancel])

  return {
    onPointerDown(event: PointerEvent<HTMLElement>) {
      if (!enabled || event.isPrimary === false || event.button !== 0 || drag.current) return
      const target = event.target
      if (!(target instanceof Element) || !target.closest('.client-lime-sheet-header') || target.closest('button,input,textarea,select,a,[contenteditable]')) return
      // Don't grab a sheet still entering from below the viewport.
      if (event.currentTarget.getAnimations?.().some(a => (a as CSSAnimation).animationName === 'coach-v79-sheet-in' && a.playState === 'running')) return
      event.preventDefault()
      ignoreClick.current = false
      drag.current = { element: event.currentTarget, id: event.pointerId, x: event.clientX, y: event.clientY, offset: 0, moved: false, at: event.timeStamp, velocity: 0 }
      event.currentTarget.setPointerCapture?.(event.pointerId)
    },
    onPointerMove(event: PointerEvent<HTMLElement>) {
      const current = drag.current
      if (!current || current.id !== event.pointerId) return
      if (!enabled) { cancel(); return }
      const x = event.clientX - current.x, offset = event.clientY - current.y
      if (!current.moved && Math.max(Math.abs(x), Math.abs(offset)) < 8) return
      if (!current.moved && (offset <= 0 || Math.abs(x) > offset)) { cancel(); return }
      event.preventDefault()
      current.moved = true
      current.velocity = (offset - current.offset) * 1000 / Math.max(1, event.timeStamp - current.at)
      current.offset = Math.max(0, offset); current.at = event.timeStamp
      event.currentTarget.dataset.v79Dragging = 'true'
      event.currentTarget.style.setProperty('--v79-picker-drag', `${current.offset}px`)
    },
    onPointerUp(event: PointerEvent<HTMLElement>) {
      const current = drag.current
      if (!current || current.id !== event.pointerId) return
      if (!enabled) { cancel(); return }
      if (current.moved) {
        ignoreClick.current = true
        releaseClick.current = setTimeout(() => { ignoreClick.current = false; releaseClick.current = null }, 0)
      }
      const threshold = Math.min(160, event.currentTarget.getBoundingClientRect().height * .22)
      const fast = current.offset > 40 && current.velocity > 800 && event.timeStamp - current.at < 80
      if (current.moved && (current.offset > threshold || fast)) {
        drag.current = null
        releaseCapture(current.element, current.id)
        event.currentTarget.removeAttribute('data-v79-dragging')
        close()
      } else cancel()
    },
    onPointerCancel(event: PointerEvent<HTMLElement>) { if (drag.current?.id === event.pointerId) cancel() },
    onLostPointerCapture(event: PointerEvent<HTMLElement>) { if (drag.current?.id === event.pointerId) cancel() },
    onClickCapture(event: MouseEvent<HTMLElement>) {
      if (ignoreClick.current) { event.preventDefault(); event.stopPropagation(); ignoreClick.current = false }
    },
  }
}
