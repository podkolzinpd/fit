import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react'
import {
  YandexAppSessionExpiredError,
  yandexPilotRepository,
  type YandexAppSession,
} from '../data/repositories/yandex-pilot.repository'
import {
  getYandexAppSessionEntryConfig,
  isYandexAppSessionPilotEnabled,
} from './feature-flags'

const STORAGE_KEY = 'fit.yandexAppSession.v1'
const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/

interface StoredYandexAppSession {
  token: string
  expiresAt: string
}

interface YandexAppSessionState {
  session: YandexAppSession | null
  loading: boolean
  error: string | null
  establish: (session: YandexAppSession) => void
  retry: () => Promise<void>
  signOut: () => Promise<void>
}

const YandexAppSessionContext = createContext<YandexAppSessionState | null>(null)

function readStoredSession(storage: Pick<Storage, 'getItem'>): StoredYandexAppSession | null {
  const raw = storage.getItem(STORAGE_KEY)
  if (raw === null) return null
  try {
    const value: unknown = JSON.parse(raw)
    if (typeof value !== 'object' || value === null) return null
    const record = value as Record<string, unknown>
    const token = record.token
    const expiresAt = record.expiresAt
    if (typeof token !== 'string' || !SESSION_TOKEN_PATTERN.test(token)) return null
    if (typeof expiresAt !== 'string' || !Number.isFinite(Date.parse(expiresAt))) return null
    return { token, expiresAt }
  } catch {
    return null
  }
}

function persistSession(storage: Pick<Storage, 'setItem'>, session: YandexAppSession): void {
  storage.setItem(STORAGE_KEY, JSON.stringify({
    token: session.session.token,
    expiresAt: session.session.expiresAt,
  } satisfies StoredYandexAppSession))
}

function clearStoredSession(storage: Pick<Storage, 'removeItem'>): void {
  storage.removeItem(STORAGE_KEY)
}

export function YandexAppSessionProvider({ children }: PropsWithChildren) {
  const config = useMemo(() => getYandexAppSessionEntryConfig(), [])
  const [session, setSession] = useState<YandexAppSession | null>(null)
  const [loading, setLoading] = useState(config !== null)
  const [error, setError] = useState<string | null>(null)
  const revisionRef = useRef(0)

  const clearLocalSession = useCallback(() => {
    revisionRef.current += 1
    clearStoredSession(window.localStorage)
    setSession(null)
    setLoading(false)
  }, [])

  const restore = useCallback(async () => {
    const revision = ++revisionRef.current
    if (config === null) {
      setSession(null)
      setLoading(false)
      setError(null)
      return
    }

    const stored = readStoredSession(window.localStorage)
    if (stored === null || Date.parse(stored.expiresAt) <= Date.now()) {
      clearStoredSession(window.localStorage)
      setSession(null)
      setLoading(false)
      setError(null)
      return
    }

    setLoading(true)
    setError(null)
    try {
      const restored = await yandexPilotRepository.getAppSession(config.apiBaseUrl, stored.token)
      if (revision !== revisionRef.current) return
      if (!isYandexAppSessionPilotEnabled(restored.profile.id)) {
        try {
          await yandexPilotRepository.revokeAppSession(config.apiBaseUrl, stored.token)
        } catch {
          // Не сохраняем и не возвращаем токен. Серверный rollout assignment
          // остаётся границей авторизации, даже если revoke временно недоступен.
        }
        clearStoredSession(window.localStorage)
        setSession(null)
        setError('Этот профиль не добавлен в пилот входа через Yandex ID.')
        return
      }
      setSession({ ...restored, session: stored })
    } catch (caught) {
      if (revision !== revisionRef.current) return
      setSession(null)
      if (caught instanceof YandexAppSessionExpiredError) clearStoredSession(window.localStorage)
      setError(caught instanceof Error ? caught.message : 'Не удалось восстановить сессию Yandex ID.')
    } finally {
      if (revision === revisionRef.current) setLoading(false)
    }
  }, [config])

  const establish = useCallback((nextSession: YandexAppSession) => {
    if (config === null || !isYandexAppSessionPilotEnabled(nextSession.profile.id)) {
      throw new Error('Этот профиль не добавлен в пилот входа через Yandex ID.')
    }
    revisionRef.current += 1
    persistSession(window.localStorage, nextSession)
    setSession(nextSession)
    setError(null)
    setLoading(false)
  }, [config])

  const signOut = useCallback(async () => {
    const current = session ?? (() => {
      const stored = readStoredSession(window.localStorage)
      return stored === null ? null : {
        accessMode: 'read_write' as const,
        profile: null,
        session: stored,
      }
    })()
    clearLocalSession()
    setError(null)
    if (config === null || current === null) return
    try {
      await yandexPilotRepository.revokeAppSession(config.apiBaseUrl, current.session.token)
    } catch (caught) {
      if (caught instanceof YandexAppSessionExpiredError) return
      setError('Сессия удалена с этого устройства, но сервер не подтвердил выход. Она автоматически истечёт не позднее указанного срока.')
    }
  }, [clearLocalSession, config, session])

  useEffect(() => {
    void restore()
  }, [restore])

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY) void restore()
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [restore])

  useEffect(() => {
    if (session === null) return
    const remaining = Date.parse(session.session.expiresAt) - Date.now()
    if (remaining <= 0) {
      clearLocalSession()
      return
    }
    const timeout = window.setTimeout(clearLocalSession, Math.min(remaining, 2_147_483_647))
    return () => window.clearTimeout(timeout)
  }, [clearLocalSession, session])

  const value = useMemo(() => ({
    session,
    loading,
    error,
    establish,
    retry: restore,
    signOut,
  }), [session, loading, error, establish, restore, signOut])

  return <YandexAppSessionContext value={value}>{children}</YandexAppSessionContext>
}

export function useYandexAppSession(): YandexAppSessionState {
  const context = use(YandexAppSessionContext)
  if (context === null) {
    throw new Error('useYandexAppSession должен использоваться внутри YandexAppSessionProvider')
  }
  return context
}

export function useOptionalYandexAppSession(): YandexAppSessionState | null {
  return use(YandexAppSessionContext)
}
