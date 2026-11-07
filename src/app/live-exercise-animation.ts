import { useCallback, useSyncExternalStore } from 'react'
import { readPreferenceStorage, writePreferenceStorage } from './preference-storage'

const STORAGE_PREFIX = 'fit.liveExerciseAnimation.'
const CHANGE_EVENT = 'fit-live-exercise-animation-change'

export function liveExerciseAnimationStorageKey(userId: string | undefined) {
  return userId ? `${STORAGE_PREFIX}${userId}` : undefined
}

/** Existing default stays on; a scoped caller may choose off until an explicit per-user choice. */
export function getLiveExerciseAnimation(userId: string | undefined, defaultEnabled = true): boolean {
  const key = liveExerciseAnimationStorageKey(userId)
  if (typeof window === 'undefined' || !key) return defaultEnabled
  const stored = readPreferenceStorage(key)
  return stored === null ? defaultEnabled : stored !== 'false'
}

export function setLiveExerciseAnimation(userId: string, visible: boolean) {
  writePreferenceStorage(`${STORAGE_PREFIX}${userId}`, String(visible))
  window.dispatchEvent(new Event(CHANGE_EVENT))
}

export function useLiveExerciseAnimation(userId: string | undefined, defaultEnabled = true) {
  const key = liveExerciseAnimationStorageKey(userId)
  const subscribe = useCallback((onStoreChange: () => void) => {
    if (typeof window === 'undefined') return () => undefined
    const onStorage = (event: StorageEvent) => {
      if (event.key === key) onStoreChange()
    }
    window.addEventListener(CHANGE_EVENT, onStoreChange)
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener(CHANGE_EVENT, onStoreChange)
      window.removeEventListener('storage', onStorage)
    }
  }, [key])
  const getSnapshot = useCallback(() => getLiveExerciseAnimation(userId, defaultEnabled), [userId, defaultEnabled])
  return useSyncExternalStore(subscribe, getSnapshot, () => defaultEnabled)
}
