import { useCallback, useSyncExternalStore } from 'react'
import type { AccountRole, Gender } from '../../shared/domain'
import type { BodyFigureVariant } from './body-progress-geometry'

export type BodyMapAppearance = BodyFigureVariant

const STORAGE_PREFIX = 'fit.bodyMapAppearance.'
const CHANGE_EVENT = 'fit-body-map-appearance-change'

function storageKey(userId: string | undefined, role: AccountRole | undefined) {
  return userId && role ? `${STORAGE_PREFIX}${role}.${userId}` : undefined
}

function isAppearance(value: string | null): value is BodyMapAppearance {
  return value === 'male' || value === 'female' || value === 'neutral'
}

export function defaultBodyMapAppearance(role: AccountRole | undefined, gender: Gender | null): BodyMapAppearance {
  return role === 'client' && gender ? gender : 'neutral'
}

export function allowedBodyMapAppearances(role: AccountRole | undefined, gender: Gender | null): readonly BodyMapAppearance[] {
  if (role === 'client') return gender ? [gender, 'neutral'] : ['neutral']
  return ['male', 'female', 'neutral']
}

export function getBodyMapAppearance(
  userId: string | undefined,
  role: AccountRole | undefined,
  gender: Gender | null,
): BodyMapAppearance {
  const fallback = defaultBodyMapAppearance(role, gender)
  const key = storageKey(userId, role)
  if (typeof window === 'undefined' || !key) return fallback
  try {
    const stored = window.localStorage.getItem(key)
    return isAppearance(stored) && allowedBodyMapAppearances(role, gender).includes(stored)
      ? stored
      : fallback
  } catch {
    return fallback
  }
}

export function setBodyMapAppearance(userId: string, role: AccountRole, appearance: BodyMapAppearance) {
  try {
    window.localStorage.setItem(storageKey(userId, role)!, appearance)
  } catch {
    // В текущей вкладке выбор всё равно обновится через событие.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT))
}

export function useBodyMapAppearance(
  userId: string | undefined,
  role: AccountRole | undefined,
  gender: Gender | null,
) {
  const key = storageKey(userId, role)
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
  const getSnapshot = useCallback(
    () => getBodyMapAppearance(userId, role, gender),
    [gender, role, userId],
  )
  const getServerSnapshot = useCallback(
    () => defaultBodyMapAppearance(role, gender),
    [gender, role],
  )
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
