import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AuthProvider, useAuth } from './auth-context'

vi.mock('#fit/local-legacy-composition', async () => import('./native-only-composition'))
vi.mock('../data/queries/client', () => { throw new Error('Native app imported the legacy client') })
vi.mock('@supabase/supabase-js', () => { throw new Error('Native app imported the Supabase SDK') })
const session = vi.hoisted(() => ({ retry: vi.fn(), signOut: vi.fn() }))
vi.mock('./yandex-app-session-context', () => ({
  useOptionalYandexAppSession: () => ({ session: null, loading: false, error: null, ...session }),
  useYandexAppSession: () => ({ session: null, loading: false, error: null, ...session }),
  YandexAppSessionProvider: ({ children }: { children: ReactNode }) => children,
}))

function Probe() {
  const auth = useAuth()
  return <>
    <p>{auth.loading ? 'loading' : auth.actor === null ? 'anonymous' : 'authenticated'}</p>
    <button onClick={() => void auth.refresh()}>Refresh</button>
    <button onClick={() => void auth.signOut()}>Logout</button>
  </>
}

describe('native frontend composition', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks() })

  it('keeps auth native when the old auth flag is absent', async () => {
    vi.stubEnv('VITE_YANDEX_ONLY_AUTH_ENABLED', '')
    const cache = new QueryClient()
    cache.setQueryData(['previous-session'], 'cached')
    render(<QueryClientProvider client={cache}><AuthProvider><Probe /></AuthProvider></QueryClientProvider>)
    expect(screen.getByText('anonymous')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Refresh'))
    await waitFor(() => expect(session.retry).toHaveBeenCalledOnce())
    fireEvent.click(screen.getByText('Logout'))
    await waitFor(() => expect(session.signOut).toHaveBeenCalledOnce())
    await waitFor(() => expect(cache.getQueryData(['previous-session'])).toBeUndefined())
  })
})
