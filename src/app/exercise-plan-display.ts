import { useCallback, useSyncExternalStore } from 'react'

const REST_DISPLAY_STORAGE_PREFIX = 'fit.exercisePlan.restDisplay.'
const REST_DISPLAY_CHANGE_EVENT = 'fit-exercise-plan-rest-display-change'

function storageKey(userId: string | undefined) {
  return userId ? `${REST_DISPLAY_STORAGE_PREFIX}${userId}` : undefined
}

/** Персональная настройка редактора плана: показывать отдых у каждого упражнения. */
export function getExercisePlanRestDisplay(userId: string | undefined): boolean {
  const key = storageKey(userId)
  if (typeof window === 'undefined' || !key) return false
  try {
    return window.localStorage.getItem(key) === 'true'
  } catch {
    return false
  }
}

export function setExercisePlanRestDisplay(userId: string, visible: boolean) {
  try {
    window.localStorage.setItem(`${REST_DISPLAY_STORAGE_PREFIX}${userId}`, String(visible))
  } catch {
    // В текущей вкладке настройка всё равно обновится через событие.
  }
  window.dispatchEvent(new Event(REST_DISPLAY_CHANGE_EVENT))
}

export function useExercisePlanRestDisplay(userId: string | undefined) {
  const key = storageKey(userId)
  const subscribe = useCallback((onStoreChange: () => void) => {
    if (typeof window === 'undefined') return () => undefined
    const onStorage = (event: StorageEvent) => {
      if (event.key === key) onStoreChange()
    }
    window.addEventListener(REST_DISPLAY_CHANGE_EVENT, onStoreChange)
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener(REST_DISPLAY_CHANGE_EVENT, onStoreChange)
      window.removeEventListener('storage', onStorage)
    }
  }, [key])
  const getSnapshot = useCallback(() => getExercisePlanRestDisplay(userId), [userId])
  return useSyncExternalStore(subscribe, getSnapshot, () => false)
}
