import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { isTrainerScheduleV2CalendarRoute } from './trainer-schedule-v2'

function calendarRoute(value: string | null): string | null {
  if (!value || !/^\/today(?:\?[^#]*)?$/.test(value)) return null
  return isTrainerScheduleV2CalendarRoute('/today', value.slice('/today'.length)) ? value : null
}

function readDestination(userId: string | undefined, name: string, validate: (value: string | null) => string | null): string | null {
  if (!userId) return null
  try { return validate(sessionStorage.getItem(`fit.coach-${name}-route.${userId}`)) } catch { return null }
}

export function readCoachCalendarRoute(userId: string | undefined): string | null {
  return readDestination(userId, 'calendar', calendarRoute)
}

function financeRoute(value: string | null): string | null {
  return value && /^\/finance(?:\?[^#]*)?$/.test(value) ? value : null
}

/** Navigation preference only; no workout contents or cross-account state. */
function useDestination(userId: string | undefined, enabled: boolean, pathname: string, search: string, name: string, fallback: string, validate: (value: string | null) => string | null) {
  const [saved, setSaved] = useState(() => ({ userId, route: readDestination(userId, name, validate) }))
  const current = enabled ? validate(`${pathname}${search}`) : null
  if (enabled && (saved.userId !== userId || current && saved.route !== current)) {
    setSaved({ userId, route: current ?? readDestination(userId, name, validate) })
  }
  useEffect(() => {
    if (!enabled || !userId || !current) return
    try { sessionStorage.setItem(`fit.coach-${name}-route.${userId}`, current) } catch { /* In-memory return remains available. */ }
  }, [current, enabled, name, userId])
  return current ?? readDestination(userId, name, validate) ?? (saved.userId === userId ? saved.route : null) ?? fallback
}

export function useCoachCalendarDestination(userId: string | undefined, enabled: boolean, pathname: string, search: string) {
  return useDestination(userId, enabled, pathname, search, 'calendar', '/today', calendarRoute)
}

export function useCoachFinanceDestination(userId: string | undefined, enabled: boolean, pathname: string, search: string) {
  return useDestination(userId, enabled, pathname, search, 'finance', '/finance', financeRoute)
}

/** Restore the owning route after async content grows, before a user scroll wins. */
export function useCoachNavigationScroll(content: RefObject<HTMLDivElement | null>, key: string | null) {
  const pendingFrame = useRef<number | null>(null)
  useLayoutEffect(() => {
    const viewport = content.current
    if (!key || !viewport) return
    let target = 0
    try { target = Number(sessionStorage.getItem(`fit.coach-route-scroll.${key}`) ?? 0) } catch { /* This route can still scroll. */ }
    if (!Number.isFinite(target) || target < 0) target = 0
    let restoring = true
    const save = () => {
      if (restoring) return
      try { sessionStorage.setItem(`fit.coach-route-scroll.${key}`, String(viewport.scrollTop)) } catch { /* Optional viewport preference. */ }
    }
    const restore = () => {
      if (!restoring) return
      const maximum = Math.max(0, viewport.scrollHeight - viewport.clientHeight)
      viewport.scrollTop = Math.min(target, maximum)
      if (maximum >= target) restoring = false
    }
    const schedule = () => {
      if (pendingFrame.current !== null) cancelAnimationFrame(pendingFrame.current)
      pendingFrame.current = requestAnimationFrame(() => { pendingFrame.current = null; restore() })
    }
    const userTakesOver = () => { restoring = false; save() }
    const resize = new ResizeObserver(schedule)
    const mutations = new MutationObserver(schedule)
    resize.observe(viewport)
    if (viewport.firstElementChild) resize.observe(viewport.firstElementChild)
    mutations.observe(viewport, { childList: true, subtree: true })
    viewport.addEventListener('scroll', save, { passive: true })
    for (const type of ['wheel', 'touchstart', 'pointerdown', 'keydown']) viewport.addEventListener(type, userTakesOver, { passive: true })
    schedule()
    return () => {
      resize.disconnect(); mutations.disconnect()
      if (pendingFrame.current !== null) cancelAnimationFrame(pendingFrame.current)
      pendingFrame.current = null
      viewport.removeEventListener('scroll', save)
      for (const type of ['wheel', 'touchstart', 'pointerdown', 'keydown']) viewport.removeEventListener(type, userTakesOver)
    }
  }, [content, key])
}
