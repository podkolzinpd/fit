import { useCallback, useSyncExternalStore } from 'react'
import type { AccountRole, Gender } from '../../shared/domain'
import type { BodyFigureVariant } from './body-progress-geometry'

export type BodyMapDisplayMode = 'real' | 'list'

// Earlier versions silently converted the retired scheme to "list". Use a new
// preference key so that conversion cannot hide a figure when gender is known.
const STORAGE_PREFIX = 'fit.bodyMapDisplay.v2.'
const CHANGE_EVENT = 'fit-body-map-display-change'

function storageKey(
  viewerUserId: string | undefined,
  role: AccountRole | undefined,
  clientId: string | undefined,
) {
  const scope = role === 'trainer' ? 'account' : clientId
  return viewerUserId && role && scope
    ? `${STORAGE_PREFIX}${role}.${viewerUserId}.${scope}`
    : undefined
}

function isDisplayMode(value: string | null): value is BodyMapDisplayMode {
  return value === 'real' || value === 'list'
}

export function defaultBodyMapDisplayMode(
  gender: Gender | null,
  role?: AccountRole,
): BodyMapDisplayMode {
  return role === 'trainer' || gender ? 'real' : 'list'
}

export function resolveBodyFigureVariant(mode: BodyMapDisplayMode, gender: Gender | null): BodyFigureVariant {
  return mode === 'real' && gender ? gender : 'neutral'
}

export function getBodyMapDisplayMode(
  viewerUserId: string | undefined,
  role: AccountRole | undefined,
  clientId: string | undefined,
  gender: Gender | null,
): BodyMapDisplayMode {
  const fallback = defaultBodyMapDisplayMode(gender, role)
  const key = storageKey(viewerUserId, role, clientId)
  if (typeof window === 'undefined' || !key) return fallback
  try {
    const stored = window.localStorage.getItem(key)
    if (isDisplayMode(stored)) return stored === 'real' && !gender ? fallback : stored
    return fallback
  } catch {
    return fallback
  }
}

export function setBodyMapDisplayMode(
  viewerUserId: string,
  role: AccountRole,
  clientId: string | undefined,
  mode: BodyMapDisplayMode,
) {
  try {
    window.localStorage.setItem(storageKey(viewerUserId, role, clientId)!, mode)
  } catch {
    // В текущей вкладке выбор всё равно обновится через событие.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT))
}

export function useBodyMapDisplayMode(
  viewerUserId: string | undefined,
  role: AccountRole | undefined,
  clientId: string | undefined,
  gender: Gender | null,
) {
  const key = storageKey(viewerUserId, role, clientId)
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
    () => getBodyMapDisplayMode(viewerUserId, role, clientId, gender),
    [clientId, gender, role, viewerUserId],
  )
  const getServerSnapshot = useCallback(
    () => defaultBodyMapDisplayMode(gender, role),
    [gender, role],
  )
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
