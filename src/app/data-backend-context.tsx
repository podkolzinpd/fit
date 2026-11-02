import { createContext, use, useMemo, type PropsWithChildren } from 'react'
import type { DataBackend } from '../data/contracts/backend'
import { createYandexMainRepository } from '../data/repositories/yandex-main.repository'
import { getYandexAppSessionEntryConfig, getYandexMainRoutingConfig, isYandexMainRoutingEnabled, isYandexOnlyAuthEnabled } from './feature-flags'
import { useAuth } from './auth-context'
import { useYandexAppSession } from './yandex-app-session-context'

export type { DataBackend } from '../data/contracts/backend'

export const DataBackendContext = createContext<DataBackend | 'yandex-session-unavailable' | null>(null)

export function DataBackendProvider({ children }: PropsWithChildren) {
  const { actor } = useAuth()
  const { session } = useYandexAppSession()
  const config = useMemo(
    () => getYandexMainRoutingConfig() ?? getYandexAppSessionEntryConfig(),
    [],
  )
  const value = useMemo(() => {
    if (actor !== null && isYandexOnlyAuthEnabled()
      && (session === null || config === null || actor.userId !== session.profile.id
        || session.accessMode !== 'read_write')) {
      return 'yandex-session-unavailable'
    }
    if (actor === null || session === null || config === null
      || actor.userId !== session.profile.id
      || (!isYandexMainRoutingEnabled() && session.accessMode !== 'read_write')) {
      return 'yandex-session-unavailable'
    }
    return createYandexMainRepository(config.apiBaseUrl, session.session.token, actor)
  }, [actor, config, session])

  return <DataBackendContext value={value}>{children}</DataBackendContext>
}

export function useDataBackend(): DataBackend {
  const backend = use(DataBackendContext)
  if (backend === 'yandex-session-unavailable') {
    throw new Error('Сессия Yandex ID недоступна. Войдите снова.')
  }
  if (backend !== null) return backend
  throw new Error('useDataBackend должен использоваться внутри DataBackendProvider')
}

// Public invitation preview must not require an authenticated data backend.
// This does not relax the mandatory backend contract of protected features.
export function useOptionalDataBackend(): DataBackend | null {
  const backend = use(DataBackendContext)
  if (backend === 'yandex-session-unavailable') return null
  return backend
}
