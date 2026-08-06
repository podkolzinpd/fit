import { useCallback, useSyncExternalStore } from 'react'

const RPE_DISPLAY_STORAGE_PREFIX = 'fit.rpeDisplay.'
const RPE_DISPLAY_CHANGE_EVENT = 'fit-rpe-display-change'

function storageKey(userId: string | undefined) {
  return userId ? `${RPE_DISPLAY_STORAGE_PREFIX}${userId}` : undefined
}

/** RPE — дополнительное поле: по умолчанию не занимает место в формах. */
export function getRpeDisplay(userId: string | undefined): boolean {
  const key = storageKey(userId)
  if (typeof window === 'undefined' || !key) return false
  try {
    return window.localStorage.getItem(key) === 'true'
  } catch {
    return false
  }
}

export function setRpeDisplay(userId: string, visible: boolean) {
  try {
    window.localStorage.setItem(`${RPE_DISPLAY_STORAGE_PREFIX}${userId}`, String(visible))
  } catch {
    // В текущей вкладке настройка всё равно обновится через событие.
  }
  window.dispatchEvent(new Event(RPE_DISPLAY_CHANGE_EVENT))
}

export function useRpeDisplay(userId: string | undefined) {
  const key = storageKey(userId)
  const subscribe = useCallback((onStoreChange: () => void) => {
    if (typeof window === 'undefined') return () => undefined
    const onStorage = (event: StorageEvent) => {
      if (event.key === key) onStoreChange()
    }
    window.addEventListener(RPE_DISPLAY_CHANGE_EVENT, onStoreChange)
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener(RPE_DISPLAY_CHANGE_EVENT, onStoreChange)
      window.removeEventListener('storage', onStorage)
    }
  }, [key])
  const getSnapshot = useCallback(() => getRpeDisplay(userId), [userId])
  return useSyncExternalStore(subscribe, getSnapshot, () => false)
}
