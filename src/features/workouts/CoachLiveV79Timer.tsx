import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { CoachLiveDensity } from '../../app/coach-live-density'

type Props = {
  time: string
  elapsed: string
  resting: boolean
  paused: boolean
  density: CoachLiveDensity
  headerSlot: HTMLElement | null
  restAction: ReactNode
  compactAction: ReactNode
}
const clamp = (n: number) => Math.max(0, Math.min(1, n))
const smooth = (n: number) => { const v = clamp(n); return v * v * (3 - 2 * v) }

/** One display contract, two copies of the SAME product clock value. No timer,
 * lifecycle, scroll simulation or mutation belongs to this presentation. */
export function CoachLiveV79Digits({ value }: { value: string }) {
  return <span className="coach-live-digits" aria-hidden="true">{value.split(':').map((part, index) =>
    <span className="coach-live-digit-group" key={index}>{index > 0 && <span className="coach-live-colon">:</span>}{part}</span>)}</span>
}

export function CoachLiveV79Timer({ time, elapsed, resting, paused, density, headerSlot, restAction, compactAction }: Props) {
  const wrapper = useRef<HTMLDivElement>(null)
  const large = useRef<HTMLDivElement>(null)
  const [docked, setDocked] = useState(false)
  useLayoutEffect(() => {
    const container = wrapper.current
    const page = container?.closest<HTMLElement>('.live-workout-page')
    const scroll = container?.closest<HTMLElement>('.content')
    const header = page?.querySelector<HTMLElement>(':scope > .page-header')
    const clock = large.current
    if (!container || !page || !scroll || !header || !clock) return
    const paint = () => {
      const h = header.getBoundingClientRect(), c = clock.getBoundingClientRect(), w = container.getBoundingClientRect()
      const handoff = smooth((h.bottom - c.top) / Math.max(1, c.height))
      const status = 1 - smooth((h.bottom - w.top) / 44)
      // Different font sizes must not paint on top of each other at the seam.
      const largeOpacity = 1 - smooth(handoff / .72)
      const small = status < .001 ? smooth((handoff - .72) / .28) : 0
      page.style.setProperty('--v79-large-opacity', String(largeOpacity))
      page.style.setProperty('--v79-small-opacity', String(small))
      page.style.setProperty('--v79-status-opacity', String(status))
      page.style.setProperty('--v79-glow-opacity', String(1 - handoff))
      setDocked(small > .98)
    }
    paint()
    scroll.addEventListener('scroll', paint, { passive: true })
    window.addEventListener('resize', paint)
    const observer = new ResizeObserver(paint)
    observer.observe(container); observer.observe(clock); observer.observe(header)
    return () => {
      scroll.removeEventListener('scroll', paint)
      window.removeEventListener('resize', paint)
      observer.disconnect()
      for (const key of ['large-opacity', 'small-opacity', 'status-opacity', 'glow-opacity']) page.style.removeProperty(`--v79-${key}`)
    }
  }, [headerSlot, density])
  const state = paused ? 'paused' : resting ? 'rest' : 'live'
  const label = paused ? 'Пауза' : `${resting ? 'Отдых' : 'Тренировка'}: ${time}`
  return <div ref={wrapper} className="coach-v79-timer" data-state={state}>
    <div className="coach-v79-glow" aria-hidden="true" />
    <div ref={large} className={`coach-v79-large-clock${time.length > 5 ? ' long-clock' : ''}`} role="img" aria-label={label}>
      {paused ? <span className="coach-v79-paused">Пауза</span> : <CoachLiveV79Digits value={time} />}
      {resting && !paused && <span className="coach-v79-elapsed" aria-label={`Тренировка: ${elapsed}`}><CoachLiveV79Digits value={elapsed} /></span>}
    </div>
    <div className="coach-v79-actions">{restAction}</div>
    {headerSlot && createPortal(<div className="coach-v79-dock" data-state={state}>
      <div className={`coach-v79-small-clock${time.length > 5 ? ' long-clock' : ''}`} aria-hidden="true">
        {paused ? <span>Пауза</span> : <CoachLiveV79Digits value={time} />}
      </div>
      <div className="coach-v79-small-action" inert={!docked}>{compactAction}</div>
    </div>, headerSlot)}
  </div>
}
