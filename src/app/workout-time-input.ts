import { useCallback, useSyncExternalStore } from 'react'

const STORAGE_KEY = 'fit.workoutTimeWheel'
const CHANGE_EVENT = 'fit-workout-time-input-change'
let inMemoryPreference = false
let storageUnavailable = false

/** The keyboard is the default; the wheel is an explicit device preference. */
export function getWorkoutTimeWheel(): boolean {
  if (typeof window === 'undefined') return false
  if (storageUnavailable) return inMemoryPreference
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'true'
  } catch {
    storageUnavailable = true
    return inMemoryPreference
  }
}

export function setWorkoutTimeWheel(enabled: boolean) {
  inMemoryPreference = enabled
  try {
    window.localStorage.setItem(STORAGE_KEY, String(enabled))
  } catch {
    // Private mode can permit reading storage while rejecting writes.
    storageUnavailable = true
  }
  window.dispatchEvent(new Event(CHANGE_EVENT))
}

export function useWorkoutTimeWheel() {
  const subscribe = useCallback((onStoreChange: () => void) => {
    if (typeof window === 'undefined') return () => undefined
    const onStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY) onStoreChange()
    }
    window.addEventListener(CHANGE_EVENT, onStoreChange)
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener(CHANGE_EVENT, onStoreChange)
      window.removeEventListener('storage', onStorage)
    }
  }, [])
  return useSyncExternalStore(subscribe, getWorkoutTimeWheel, () => false)
}
