import { useEffect } from 'react'

/** Move only the clipped edge inside the app, never the root document. */
export function keepWorkoutFieldVisible(target: HTMLElement): void {
  const content = target.closest('.content')
  if (!target.isConnected || !(content instanceof HTMLElement) || content.clientHeight <= 0) return
  const bounds = content.getBoundingClientRect()
  const viewport = window.visualViewport
  const top = Math.max(bounds.top, viewport?.offsetTop ?? 0) + 16
  const bottom = Math.min(bounds.bottom, viewport ? viewport.offsetTop + viewport.height : innerHeight) - 16
  if (bottom <= top) return
  const field = target.getBoundingClientRect()
  // An oversized textarea cannot fit completely. Keep its top visible rather
  // than oscillating between its top and bottom during keyboard resize phases.
  const delta = field.top < top ? field.top - top
    : field.height > bottom - top ? field.top - top
      : field.bottom > bottom ? field.bottom - bottom : 0
  if (delta) content.scrollTop += delta
}

export function useWorkoutFieldVisibility(enabled: boolean, selector: string): void {
  useEffect(() => {
    if (!enabled) return
    let frame: number | null = null
    const schedule = () => {
      if (frame !== null) return
      frame = requestAnimationFrame(() => {
        frame = null
        const target = document.activeElement
        if (target instanceof HTMLElement && target.matches(selector)) keepWorkoutFieldVisible(target)
      })
    }
    const viewport = window.visualViewport
    viewport?.addEventListener('resize', schedule)
    viewport?.addEventListener('scroll', schedule)
    window.addEventListener('resize', schedule)
    document.addEventListener('focusin', schedule)
    return () => {
      if (frame !== null) cancelAnimationFrame(frame)
      viewport?.removeEventListener('resize', schedule)
      viewport?.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      document.removeEventListener('focusin', schedule)
    }
  }, [enabled, selector])
}
