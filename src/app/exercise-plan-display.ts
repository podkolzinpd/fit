import { useCallback, useSyncExternalStore } from 'react'
import { readPreferenceStorage, writePreferenceStorage } from './preference-storage'

const REST_DISPLAY_STORAGE_PREFIX = 'fit.exercisePlan.restDisplay.'
const REST_DISPLAY_CHANGE_EVENT = 'fit-exercise-plan-rest-display-change'

export function exercisePlanRestStorageKey(userId: string | undefined) {
  return userId ? `${REST_DISPLAY_STORAGE_PREFIX}${userId}` : undefined
}

/** Персональная настройка редактора плана: показывать отдых у каждого упражнения. */
export function getExercisePlanRestDisplay(userId: string | undefined): boolean {
  const key = exercisePlanRestStorageKey(userId)
  if (typeof window === 'undefined' || !key) return false
  return readPreferenceStorage(key) === 'true'
}

export function setExercisePlanRestDisplay(userId: string, visible: boolean) {
  writePreferenceStorage(`${REST_DISPLAY_STORAGE_PREFIX}${userId}`, String(visible))
  window.dispatchEvent(new Event(REST_DISPLAY_CHANGE_EVENT))
}

export function useExercisePlanRestDisplay(userId: string | undefined) {
  const key = exercisePlanRestStorageKey(userId)
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
