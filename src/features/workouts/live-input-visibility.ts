import { useEffect } from 'react'

/** Move only the clipped portion of the row. Never scroll the document or
 * center an already visible field while the keyboard changes height. */
export function keepLiveInputVisible(target: HTMLElement): void {
  const content = target.closest('.content')
  const row = target.closest('.live-set-grid')
  if (!(content instanceof HTMLElement) || !(row instanceof HTMLElement) || content.clientHeight <= 0) return
  const bounds = content.getBoundingClientRect()
  const viewport = window.visualViewport
  const bottom = Math.min(bounds.bottom, viewport ? viewport.offsetTop + viewport.height : innerHeight) - 16
  const pinned = content.querySelector('.live-pinned')?.getBoundingClientRect()
  const top = Math.max(bounds.top, pinned?.bottom ?? bounds.top) + 16
  if (bottom <= top) return
  const rowBounds = row.getBoundingClientRect()
  const anchor = rowBounds.height <= bottom - top ? rowBounds : target.getBoundingClientRect()
  const delta = anchor.top < top ? anchor.top - top : anchor.bottom > bottom ? anchor.bottom - bottom : 0
  if (delta) content.scrollTop += delta
}

export function useLiveInputVisibility(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return
    let frame: number | null = null
    const schedule = () => {
      if (frame !== null) return
      frame = requestAnimationFrame(() => {
        frame = null
        const target = document.activeElement
        if (target instanceof HTMLElement && target.closest('.live-workout-page') && target.matches('.live-set-input, .live-set-rpe')) keepLiveInputVisible(target)
      })
    }
    // keyboardOpen is boolean: later resize phases must also update visibility.
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
  }, [enabled])
}
