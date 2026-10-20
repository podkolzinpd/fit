import { useCallback, useSyncExternalStore } from 'react'

export type ClientLiveDensity = 'original' | 'compact'
const prefix = 'fit.clientLiveDensity.'
const changed = 'fit-client-live-density-change'
// Like the time-input preference, this must work when private-mode writes fail.
// Keep fallback state per account, not one shared preference for the device.
const fallback = new Map<string, ClientLiveDensity>()

export function getClientLiveDensity(userId: string | undefined): ClientLiveDensity {
  if (!userId || typeof window === 'undefined') return 'original'
  if (fallback.has(userId)) return fallback.get(userId)!
  try { return window.localStorage.getItem(`${prefix}${userId}`) === 'compact' ? 'compact' : 'original' }
  catch { return 'original' }
}

export function setClientLiveDensity(userId: string, density: ClientLiveDensity) {
  if (!userId || typeof window === 'undefined') return
  try {
    window.localStorage.setItem(`${prefix}${userId}`, density)
    fallback.delete(userId)
  } catch { fallback.set(userId, density) }
  window.dispatchEvent(new Event(changed))
}

export function useClientLiveDensity(userId: string | undefined) {
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
  const snapshot = useCallback(() => getClientLiveDensity(userId), [userId])
  return useSyncExternalStore(subscribe, snapshot, () => 'original' as const)
}
