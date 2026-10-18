import { useLayoutEffect, useState } from 'react'

/** Keep the two sticky paint surfaces in the same viewport coordinate space.
 * Scroll changes paint only: never React state, timer identity or input focus. */
export function useCoachLiveHalo(enabled: boolean) {
  const [pinned, setPinned] = useState<HTMLDivElement | null>(null)
  useLayoutEffect(() => {
    if (!enabled || !pinned) return
    const root = pinned.closest<HTMLElement>('.coach-live-density')
    const header = root?.querySelector<HTMLElement>(':scope > .page-header')
    const clock = pinned.querySelector<HTMLElement>('.coach-live-clock')
    if (!root || !header || !clock) return
    const paint = () => {
      const head = header.getBoundingClientRect()
      const block = pinned.getBoundingClientRect()
      const digits = clock.getBoundingClientRect()
      const visible = Math.max(0, Math.min(1, (digits.bottom - head.bottom) / Math.max(1, digits.height)))
      pinned.style.setProperty('--coach-live-halo-y', `${head.top - block.top}px`)
      root.style.setProperty('--coach-live-halo-fade', String(visible * visible * (3 - 2 * visible)))
    }
    paint()
    // Scroll events already run at rendering cadence. Paint in that event,
    // rather than delaying one additional frame at the sticky seam.
    window.addEventListener('scroll', paint, true)
    window.addEventListener('resize', paint)
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(paint)
    observer?.observe(header)
    observer?.observe(pinned)
    observer?.observe(clock)
    return () => {
      window.removeEventListener('scroll', paint, true)
      window.removeEventListener('resize', paint)
      observer?.disconnect()
      pinned.style.removeProperty('--coach-live-halo-y')
      root.style.removeProperty('--coach-live-halo-fade')
    }
  }, [enabled, pinned])
  return setPinned
}
