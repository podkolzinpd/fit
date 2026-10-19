import { useCallback, useSyncExternalStore } from 'react'

const STORAGE_PREFIX = 'fit.liveExerciseAnimation.'
const CHANGE_EVENT = 'fit-live-exercise-animation-change'

function storageKey(userId: string | undefined) {
  return userId ? `${STORAGE_PREFIX}${userId}` : undefined
}

/** Existing default stays on; a scoped caller may choose off until an explicit per-user choice. */
export function getLiveExerciseAnimation(userId: string | undefined, defaultEnabled = true): boolean {
  const key = storageKey(userId)
  if (typeof window === 'undefined' || !key) return defaultEnabled
  try {
    const stored = window.localStorage.getItem(key)
    return stored === null ? defaultEnabled : stored !== 'false'
  } catch {
    return defaultEnabled
  }
}

export function setLiveExerciseAnimation(userId: string, visible: boolean) {
  try {
    window.localStorage.setItem(`${STORAGE_PREFIX}${userId}`, String(visible))
  } catch {
    // В текущей вкладке настройка всё равно обновится через событие.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT))
}

export function useLiveExerciseAnimation(userId: string | undefined, defaultEnabled = true) {
  const key = storageKey(userId)
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
