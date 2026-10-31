import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { addDays, type LocalDate } from '../../shared/local-date'
import type { Workout, WorkoutSlotDraft } from '../../shared/domain'
import { slotClock, slotMinutes, workoutSlot } from './workout-slot'

export interface DaySlotTap {
  resolve: (target: Element, x: number, y: number) => string | null
  open: (time: string) => void
}
export interface DayCardDrag {
  hourHeight: number
  resolve: (target: Element) => Workout | null
  preview: (value: { workout: Workout; slot: WorkoutSlotDraft } | null) => void
  drop: (workout: Workout, slot: WorkoutSlotDraft) => void
}

/** The calendar owns a contact once: tap, native scroll, day swipe or held card. */
export function useCoachDaySwipe(enabled: boolean, date: LocalDate, openDay: (date: LocalDate) => void, slotTap?: DaySlotTap, cardDrag?: DayCardDrag) {
  const [header, setHeader] = useState<HTMLElement | null>(null)
  const current = useRef({ date, openDay, slotTap, cardDrag })
  useLayoutEffect(() => { current.current = { date, openDay, slotTap, cardDrag } })
  useLayoutEffect(() => {
    const root = header?.closest<HTMLElement>('.schedule-day-view')
    if (!enabled || !root) return
    type Gesture = { id: number; x: number; y: number; lastY: number; kind: 'pending' | 'swipe' | 'drag'; tap: string | null;
      dragMoved: boolean; started: number; scrollTop: number; viewport: HTMLElement | null; card: Workout | null; slot: WorkoutSlotDraft | null }
    let gesture: Gesture | null = null
    let hold: ReturnType<typeof setTimeout> | null = null
    let frame: number | null = null
    let suppressClick = false
    let lastScroll = -Infinity
    const scrollPositions = new WeakMap<HTMLElement, { top: number; left: number }>()
    const position = (viewport: HTMLElement) => ({ top: viewport.scrollTop, left: viewport.scrollLeft })
    const clearHold = () => { if (hold !== null) clearTimeout(hold); hold = null }
    const markScroll = () => { lastScroll = performance.now(); if (gesture) { gesture.tap = null; if (gesture.kind !== 'drag') clearHold() } }
    const readScrollTop = (viewport: HTMLElement | null) => {
      if (!viewport) return 0
      const next = position(viewport), previous = scrollPositions.get(viewport)
      if (previous && (previous.top !== next.top || previous.left !== next.left)) markScroll()
      scrollPositions.set(viewport, next)
      return next.top
    }
    root.querySelectorAll<HTMLElement>('.schedule-v2-timeline').forEach(viewport => scrollPositions.set(viewport, position(viewport)))
    const reset = () => {
      const previous = gesture
      gesture = null
      clearHold()
      if (frame !== null) cancelAnimationFrame(frame)
      frame = null
      if (previous?.kind === 'drag') current.current.cardDrag?.preview(null)
      if (previous && root.hasPointerCapture(previous.id)) root.releasePointerCapture(previous.id)
    }
    const capture = (id: number) => { if (!root.hasPointerCapture(id)) root.setPointerCapture(id) }
    const updateDrag = () => {
      const active = gesture, controls = current.current.cardDrag
      if (active?.kind !== 'drag' || !active.card || !controls || !active.viewport) return
      const original = workoutSlot(active.card), start = slotMinutes(original.startTime), end = slotMinutes(original.endTime)
      if (start === null) return
      const duration = end !== null && end > start ? end - start : null
      const delta = (active.lastY - active.y + active.viewport.scrollTop - active.scrollTop) / controls.hourHeight * 60
      const next = Math.max(0, Math.min(1439 - (duration ?? 0), Math.round((start + delta) / 5) * 5))
      active.slot = { ...original, startTime: slotClock(next), endTime: duration !== null ? slotClock(next + duration) : null }
      controls.preview({ workout: active.card, slot: active.slot })
    }
    const autoScroll = () => {
      const active = gesture
      if (active?.kind !== 'drag' || !active.viewport) return
      const viewport = active.viewport, rect = viewport.getBoundingClientRect()
      const navigation = root.closest('.phone-frame')?.querySelector<HTMLElement>('.tab-bar')?.getBoundingClientRect()
      const visibleBottom = navigation && navigation.top > rect.top && navigation.top < rect.bottom ? navigation.top : innerHeight
      const top = Math.max(0, rect.top), bottom = Math.min(innerHeight, rect.bottom, visibleBottom)
      const dy = !active.dragMoved ? 0 : active.lastY < top + 48 ? -8 : active.lastY > bottom - 48 ? 8 : 0
      const next = Math.max(0, Math.min(viewport.scrollHeight - viewport.clientHeight, viewport.scrollTop + dy))
      if (dy && next !== viewport.scrollTop) { viewport.scrollTop = next; updateDrag() }
      frame = requestAnimationFrame(autoScroll)
    }
    const scroll = (event: Event) => {
      const viewport = event.target instanceof Element ? event.target.closest<HTMLElement>('.schedule-v2-timeline') : null
      if (viewport) readScrollTop(viewport)
      else markScroll()
      if (gesture?.kind === 'drag') updateDrag()
    }
    const cancel = (event: PointerEvent) => { if (gesture?.id === event.pointerId) { suppressClick = gesture.kind !== 'pending'; reset() } }
    const lost = (event: PointerEvent) => { if (event.target === root) cancel(event) }
    const down = (event: PointerEvent) => {
      suppressClick = false
      reset()
      const target = event.target
      if (!event.isPrimary || event.button !== 0 || event.clientX < 28 || !(target instanceof Element)
        || document.querySelector('dialog[open], [aria-modal="true"]')) return
      const link = target.closest('a')
      const calendarCard = link?.matches('.schedule-v2-event, .schedule-v2-untimed > a') ?? false
      if (target.closest('button,input,select,textarea,summary,[role="button"],[contenteditable="true"],dialog,[aria-modal="true"]') || link && !calendarCard) return
      const selection = window.getSelection()
      const anchor = selection?.anchorNode instanceof Element ? selection.anchorNode : selection?.anchorNode?.parentElement
      if (selection?.isCollapsed === false && !anchor?.closest('.coach-day-heading,.schedule-v2-event')) return
      const viewport = target.closest<HTMLElement>('.schedule-v2-timeline')
      const scrollTop = readScrollTop(viewport), stable = performance.now() - lastScroll >= 200
      const card = calendarCard ? current.current.cardDrag?.resolve(target) ?? null : null
      gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, lastY: event.clientY, kind: 'pending',
        tap: !calendarCard && stable ? current.current.slotTap?.resolve(target, event.clientX, event.clientY) ?? null : null,
        dragMoved: false, started: performance.now(), viewport, scrollTop, card, slot: null }
      if (card && viewport) hold = setTimeout(() => {
        hold = null
        if (!gesture || gesture.id !== event.pointerId || gesture.kind !== 'pending' || !root.isConnected
          || performance.now() - lastScroll < 200 || readScrollTop(viewport) !== scrollTop) return
        gesture.kind = 'drag'; gesture.tap = null; suppressClick = true
        capture(gesture.id); updateDrag(); frame = requestAnimationFrame(autoScroll)
      }, 420)
    }
    const move = (event: PointerEvent) => {
      const active = gesture
      if (!active || active.id !== event.pointerId) return
      const dx = event.clientX - active.x, dy = event.clientY - active.y
      active.lastY = event.clientY
      if (active.kind === 'drag') { if (Math.hypot(dx, dy) > 8) active.dragMoved = true; if (event.cancelable) event.preventDefault(); updateDrag(); return }
      if (Math.hypot(dx, dy) > 8) clearHold()
      if (Math.hypot(dx, dy) > 10) { active.tap = null; suppressClick = true }
      if (active.kind === 'pending' && Math.abs(dy) > 12 && Math.abs(dy) >= Math.abs(dx)) { reset(); return }
      if (Math.abs(dx) >= 12 && Math.abs(dx) > Math.abs(dy) * 1.25) {
        active.kind = 'swipe'; clearHold()
        if (event.cancelable) event.preventDefault()
        capture(active.id)
      }
    }
    const up = (event: PointerEvent) => {
      const active = gesture
      if (!active || active.id !== event.pointerId) return
      if (active.kind === 'drag') {
        active.lastY = event.clientY; updateDrag()
        const card = active.card, slot = active.slot
        suppressClick = true; event.preventDefault(); reset()
        if (card && slot && (slot.startTime !== card.startTime?.slice(0, 5) || slot.endTime !== (card.endTime?.slice(0, 5) ?? null))) current.current.cardDrag?.drop(card, slot)
        return
      }
      const scrollTop = readScrollTop(active.viewport)
      const dx = event.clientX - active.x, dy = event.clientY - active.y, elapsed = performance.now() - active.started
      const commit = active.kind === 'swipe' && Math.abs(dx) > Math.abs(dy) * 1.15
        && (Math.abs(dx) >= 48 || Math.abs(dx) >= 28 && elapsed <= 200 && Math.abs(dx) / Math.max(1, elapsed) >= .35)
      const tap = active.kind === 'pending' && Math.hypot(dx, dy) <= 10 && elapsed < 450
        && performance.now() - lastScroll >= 200 && scrollTop === active.scrollTop ? active.tap : null
      reset()
      if (!commit) { if (tap) { suppressClick = true; current.current.slotTap?.open(tap) }; return }
      suppressClick = true; event.preventDefault()
      const next = addDays(current.current.date, dx < 0 ? 1 : -1)
      current.current.date = next; current.current.openDay(next)
    }
    const touchMove = (event: TouchEvent) => {
      if (event.touches.length !== 1) { reset(); return }
      // Registered before native scroll chooses its path, as in whole-card Live hold.
      if ((gesture?.kind === 'drag' || gesture?.kind === 'swipe') && event.cancelable) event.preventDefault()
    }
    const click = (event: MouseEvent) => {
      if (!suppressClick || event.detail === 0) return
      suppressClick = false; event.preventDefault(); event.stopPropagation()
    }
    const key = (event: KeyboardEvent) => { suppressClick = false; if (event.key === 'Escape') reset() }
    const background = () => { if (document.hidden) reset() }
    const blur = () => reset()
    const contextMenu = (event: Event) => { if (gesture?.card) event.preventDefault() }
    root.addEventListener('scroll', scroll, true)
    root.addEventListener('pointerdown', down)
    window.addEventListener('pointermove', move, { passive: false })
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    root.addEventListener('lostpointercapture', lost)
    root.addEventListener('click', click, true)
    root.addEventListener('contextmenu', contextMenu)
    root.addEventListener('keydown', key)
    window.addEventListener('touchmove', touchMove, { passive: false, capture: true })
    window.addEventListener('blur', blur)
    document.addEventListener('visibilitychange', background)
    return () => {
      reset()
      root.removeEventListener('scroll', scroll, true)
      root.removeEventListener('pointerdown', down)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      root.removeEventListener('lostpointercapture', lost)
      root.removeEventListener('click', click, true)
      root.removeEventListener('contextmenu', contextMenu)
      root.removeEventListener('keydown', key)
      window.removeEventListener('touchmove', touchMove, true)
      window.removeEventListener('blur', blur)
      document.removeEventListener('visibilitychange', background)
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
