import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { addDays, type LocalDate } from '../../shared/local-date'

export interface DaySlotTap {
  resolve: (target: Element, x: number, y: number) => string | null
  open: (time: string) => void
}

/** One calendar source: a completed gesture calls the existing openDay. */
export function useCoachDaySwipe(enabled: boolean, date: LocalDate, openDay: (date: LocalDate) => void, slotTap?: DaySlotTap) {
  const [header, setHeader] = useState<HTMLElement | null>(null)
  const current = useRef({ date, openDay, slotTap })
  useLayoutEffect(() => { current.current = { date, openDay, slotTap } })
  useLayoutEffect(() => {
    const root = header?.closest<HTMLElement>('.schedule-day-view')
    if (!enabled || !root) return
    let gesture: { id: number; x: number; y: number; horizontal: boolean; tap: string | null; started: number; scrollTop: number; viewport: HTMLElement | null } | null = null
    let suppressClick = false
    let lastScroll = -Infinity
    const scrollPositions = new WeakMap<HTMLElement, { top: number; left: number }>()
    const position = (viewport: HTMLElement) => ({ top: viewport.scrollTop, left: viewport.scrollLeft })
    const markScroll = () => { lastScroll = performance.now(); if (gesture) gesture.tap = null }
    const readScrollTop = (viewport: HTMLElement | null) => {
      if (!viewport) return 0
      const next = position(viewport), previous = scrollPositions.get(viewport)
      // WebKit may deliver scroll after pointerup. Observe the position itself
      // before accepting contact, including the contact that stops inertia.
      if (previous && (previous.top !== next.top || previous.left !== next.left)) markScroll()
      scrollPositions.set(viewport, next)
      return next.top
    }
    root.querySelectorAll<HTMLElement>('.schedule-v2-timeline').forEach(viewport => scrollPositions.set(viewport, position(viewport)))
    const scroll = (event: Event) => {
      markScroll()
      const viewport = event.target instanceof Element ? event.target.closest<HTMLElement>('.schedule-v2-timeline') : null
      if (viewport) scrollPositions.set(viewport, position(viewport))
    }
    const reset = () => { gesture = null }
    const cancel = (event: PointerEvent) => { if (gesture?.id === event.pointerId) reset() }
    // Touch implicitly captures the initial child. Transferring that capture
    // to root emits a bubbling child lostpointercapture: it is not cancellation.
    const lost = (event: PointerEvent) => { if (event.target === root) cancel(event) }
    const down = (event: PointerEvent) => {
      suppressClick = false
      gesture = null
      const target = event.target
      if (!event.isPrimary || event.button !== 0 || event.clientX < 28 || !(target instanceof Element)
        || target.closest('button, a, input, select, textarea, summary, [role="button"], [contenteditable="true"], dialog, [aria-modal="true"]')
        || document.querySelector('dialog[open], [aria-modal="true"]')) return
      const selection = window.getSelection()
      const anchor = selection?.anchorNode instanceof Element ? selection.anchorNode : selection?.anchorNode?.parentElement
      // WebKit Back may restore a range in the non-editable date even though
      // that heading is user-select:none. It must not disable the next swipe.
      if (selection?.isCollapsed === false && !anchor?.closest('.coach-day-heading')) return
      const viewport = target.closest<HTMLElement>('.schedule-v2-timeline')
      const scrollTop = readScrollTop(viewport)
      gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, horizontal: false,
        tap: performance.now() - lastScroll >= 200 ? current.current.slotTap?.resolve(target, event.clientX, event.clientY) ?? null : null,
        started: performance.now(), viewport, scrollTop }

    }
    const move = (event: PointerEvent) => {
      if (!gesture || gesture.id !== event.pointerId) return
      const dx = event.clientX - gesture.x, dy = event.clientY - gesture.y
      if (Math.hypot(dx, dy) > 10) gesture.tap = null
      if (!gesture.horizontal && Math.abs(dy) > 12 && Math.abs(dy) >= Math.abs(dx)) { reset(); return }
      if (Math.abs(dx) >= 16 && Math.abs(dx) > Math.abs(dy) * 1.4) {
        gesture.horizontal = true
        if (event.cancelable) event.preventDefault()
        if (!root.hasPointerCapture(event.pointerId)) root.setPointerCapture(event.pointerId)
      }
    }
    const up = (event: PointerEvent) => {
      if (!gesture || gesture.id !== event.pointerId) return
      const scrollTop = readScrollTop(gesture.viewport)
      const dx = event.clientX - gesture.x, dy = event.clientY - gesture.y
      const commit = gesture.horizontal && Math.abs(dx) >= 56 && Math.abs(dx) > Math.abs(dy) * 1.4
      const tap = !gesture.horizontal && Math.hypot(dx, dy) <= 10 && performance.now() - gesture.started < 450
        && performance.now() - lastScroll >= 200 && scrollTop === gesture.scrollTop ? gesture.tap : null
      reset()
      if (!commit) {
        if (tap) { suppressClick = true; current.current.slotTap?.open(tap) }
        return
      }
      suppressClick = true
      event.preventDefault()
      const next = addDays(current.current.date, dx < 0 ? 1 : -1)
      current.current.date = next
      current.current.openDay(next)
    }
    const click = (event: MouseEvent) => {
      if (!suppressClick || event.detail === 0) return
      suppressClick = false
      event.preventDefault()
      event.stopPropagation()
    }
    const key = () => { suppressClick = false }
    root.addEventListener('scroll', scroll, true)
    root.addEventListener('pointerdown', down)
    root.addEventListener('pointermove', move, { passive: false })
    root.addEventListener('pointerup', up)
    root.addEventListener('pointercancel', cancel)
    root.addEventListener('lostpointercapture', lost)
    root.addEventListener('click', click, true)
    root.addEventListener('keydown', key)
    return () => {
      root.removeEventListener('scroll', scroll, true)
      root.removeEventListener('pointerdown', down)
      root.removeEventListener('pointermove', move)
      root.removeEventListener('pointerup', up)
      root.removeEventListener('pointercancel', cancel)
      root.removeEventListener('lostpointercapture', lost)
      root.removeEventListener('click', click, true)
      root.removeEventListener('keydown', key)
    }
  }, [enabled, header])
  return setHeader
}

type DayLabel = { date: LocalDate; title: string; weekday: string }
export function CoachDayHeading(label: DayLabel) {
  const [view, setView] = useState<{ label: DayLabel; previous: DayLabel | null }>({ label, previous: null })
  if (view.label.date !== label.date) {
    const reduced = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    setView({ label, previous: reduced ? null : view.label })
  }
  useEffect(() => {
    if (!view.previous) return
    const timer = window.setTimeout(() => setView(current => ({ ...current, previous: null })), 220)
    return () => window.clearTimeout(timer)
  }, [view.label.date, view.previous])
  return <div className="coach-day-heading" data-direction={view.previous && view.label.date < view.previous.date ? 'previous' : 'next'} data-animating={view.previous ? '' : undefined}>
    {view.previous && <div key={`old-${view.previous.date}`} className="coach-day-heading-outgoing" aria-hidden="true"><h1>{view.previous.title}</h1><p>{view.previous.weekday}</p></div>}
    <div key={view.label.date} className="coach-day-heading-current"><h1>{view.label.title}</h1><p>{view.label.weekday}</p></div>
  </div>
}
