import { useCallback, useSyncExternalStore } from 'react'
import type { AccountRole, Gender } from '../../shared/domain'
import type { BodyFigureVariant } from './body-progress-geometry'

export type BodyMapDisplayMode = 'real' | 'scheme'

const STORAGE_PREFIX = 'fit.bodyMapDisplay.'
const LEGACY_STORAGE_PREFIX = 'fit.bodyMapAppearance.'
const CHANGE_EVENT = 'fit-body-map-display-change'

function storageKey(
  viewerUserId: string | undefined,
  role: AccountRole | undefined,
  clientId: string | undefined,
) {
  return viewerUserId && role && clientId
    ? `${STORAGE_PREFIX}${role}.${viewerUserId}.${clientId}`
    : undefined
}

function legacyStorageKey(viewerUserId: string | undefined, role: AccountRole | undefined) {
  return viewerUserId && role ? `${LEGACY_STORAGE_PREFIX}${role}.${viewerUserId}` : undefined
}

function isDisplayMode(value: string | null): value is BodyMapDisplayMode {
  return value === 'real' || value === 'scheme'
}

function legacyDisplayMode(value: string | null): BodyMapDisplayMode | null {
  if (value === 'male' || value === 'female') return 'real'
  if (value === 'neutral') return 'scheme'
  return null
}

export function defaultBodyMapDisplayMode(gender: Gender | null): BodyMapDisplayMode {
  return gender ? 'real' : 'scheme'
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
  const fallback = defaultBodyMapDisplayMode(gender)
  const key = storageKey(viewerUserId, role, clientId)
  if (typeof window === 'undefined' || !key) return fallback
  try {
    const stored = window.localStorage.getItem(key)
    if (isDisplayMode(stored) && (stored !== 'real' || gender)) return stored

    // Смысл прежнего выбора переносим только клиенту. Глобальный выбор тренера
    // не мигрируем: он и был причиной применения одной фигуры ко всем клиентам.
    if (role === 'client') {
      const legacyKey = legacyStorageKey(viewerUserId, role)
      const migrated = legacyKey ? legacyDisplayMode(window.localStorage.getItem(legacyKey)) : null
      if (migrated && (migrated !== 'real' || gender)) {
        window.localStorage.setItem(key, migrated)
        return migrated
      }
    }
    return fallback
  } catch {
    return fallback
  }
}

export function setBodyMapDisplayMode(
  viewerUserId: string,
  role: AccountRole,
  clientId: string,
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
    () => defaultBodyMapDisplayMode(gender),
    [gender],
  )
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
