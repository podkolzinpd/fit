import { useCallback, useSyncExternalStore } from 'react'

export type CoachLiveDensity = 'original' | 'compact'
const prefix = 'fit.coachLiveDensity.'
const changed = 'fit-coach-live-density-change'
// Like the time-input preference, this must work when private-mode writes fail.
// Keep fallback state per account, not one shared preference for the device.
const fallback = new Map<string, CoachLiveDensity>()

export function getCoachLiveDensity(userId: string | undefined): CoachLiveDensity {
  if (!userId || typeof window === 'undefined') return 'original'
  if (fallback.has(userId)) return fallback.get(userId)!
  try { return window.localStorage.getItem(`${prefix}${userId}`) === 'compact' ? 'compact' : 'original' }
  catch { return 'original' }
}

export function setCoachLiveDensity(userId: string, density: CoachLiveDensity) {
  if (!userId || typeof window === 'undefined') return
  try {
    window.localStorage.setItem(`${prefix}${userId}`, density)
    fallback.delete(userId)
  } catch { fallback.set(userId, density) }
  window.dispatchEvent(new Event(changed))
}

export function useCoachLiveDensity(userId: string | undefined) {
  const subscribe = useCallback((onChange: () => void) => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === `${prefix}${userId}` || event.key === null) {
        if (userId) fallback.delete(userId)
        onChange()
      }
    }
    window.addEventListener(changed, onChange)
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener(changed, onChange)
      window.removeEventListener('storage', onStorage)
    }
  }, [userId])
  const snapshot = useCallback(() => getCoachLiveDensity(userId), [userId])
  return useSyncExternalStore(subscribe, snapshot, () => 'original' as const)
}
