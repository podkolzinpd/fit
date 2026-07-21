import { createContext, use, useCallback, useEffect, useMemo, useState, type PropsWithChildren } from 'react'
import type { SessionActor } from '../shared/domain'
import { authRepository } from '../data/repositories/auth.repository'

interface AuthState {
  actor: SessionActor | null
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: PropsWithChildren) {
  const [actor, setActor] = useState<SessionActor | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const result = await authRepository.getSession()
      if (result.error) throw result.error
      const user = result.data.session?.user
      setActor(user ? await authRepository.initialize({ id: user.id, email: user.email,
        user_metadata: user.user_metadata }) : null)
      setError(null)
    } catch (caught) {
      setActor(null)
      setError(caught instanceof Error ? caught.message : 'Ошибка авторизации')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
    const { data } = authRepository.onAuthStateChange(async () => { await refresh() })
    return () => data.subscription.unsubscribe()
  }, [refresh])

  const value = useMemo(() => ({ actor, loading, error, refresh }), [actor, loading, error, refresh])
  return <AuthContext value={value}>{children}</AuthContext>
}

export function useAuth(): AuthState {
  const context = use(AuthContext)
  if (!context) throw new Error('useAuth должен использоваться внутри AuthProvider')
  return context
}
