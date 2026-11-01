import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthProvider, useAuth } from './auth-context'

const native = vi.hoisted(() => ({
  state: null as null | {
    session: { accessMode: 'read_write'; profile: { id: string; firstName: string | null; lastName: string | null; timezone: string; accountRole: 'trainer' | 'client'; client?: { id: string; trainerId: string; fullName: string } | null }; session: { token: string; expiresAt: string } } | null
    loading: boolean; error: string | null; retry: ReturnType<typeof vi.fn>; signOut: ReturnType<typeof vi.fn>
  },
}))
vi.mock('./yandex-app-session-context', () => ({ useOptionalYandexAppSession: () => native.state }))
vi.mock('@supabase/supabase-js', () => { throw new Error('Native auth must not load an SDK') })
vi.mock('../data/repositories/yandex-assistant.repository', () => { throw new Error('Auth imported Assistant data') })

function restore(role: 'trainer' | 'client' = 'trainer', withCard = false) {
  native.state = { session: {
    accessMode: 'read_write',
    profile: { id: 'profile-1', firstName: 'Тест', lastName: null, timezone: 'Europe/Moscow', accountRole: role,
      ...(role === 'client' ? { client: withCard ? { id: 'client-1', trainerId: 'trainer-1', fullName: 'Спортсмен' } : null } : {}),
    },
    session: { token: 'a'.repeat(43), expiresAt: '2099-01-01T00:00:00.000Z' },
  }, loading: false, error: null, retry: vi.fn().mockResolvedValue(undefined), signOut: vi.fn().mockResolvedValue(undefined) }
  return native.state
}

function Probe() {
  const auth = useAuth()
  const [error, setError] = useState('')
  return <>
    <p>{auth.loading ? 'loading' : auth.actor ? `${auth.actor.kind}:${auth.actor.role}:${auth.actor.userId}` : auth.error ?? 'anonymous'}</p>
    <button onClick={() => void auth.refresh().catch(e => setError(String(e)))}>Refresh</button>
    <button onClick={() => void auth.signOut().catch(e => setError(String(e)))}>Logout</button>
    {error && <p role="alert">{error}</p>}
  </>
}
function mount(children: ReactNode) {
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return { cache, ...render(<QueryClientProvider client={cache}><AuthProvider>{children}</AuthProvider></QueryClientProvider>) }
}

beforeEach(() => { native.state = null; vi.stubEnv('VITE_YANDEX_MAIN_ROUTING_ENABLED', 'true') })
afterEach(() => vi.unstubAllEnvs())

describe('native AuthProvider', () => {
  it('has no implicit identity when no native session exists', () => {
    mount(<Probe />)
    expect(screen.getByText('anonymous')).toBeVisible()
  })
  it.each([
    ['trainer', false, 'trainer:trainer:profile-1'],
    ['client', false, 'trainer:client:profile-1'],
    ['client', true, 'client:client:profile-1'],
  ] as const)('preserves the %s actor contract with card=%s', (role, withCard, expected) => {
    restore(role, withCard)
    mount(<Probe />)
    expect(screen.getByText(expected)).toBeVisible()
  })
  it('refreshes only the native session', async () => {
    const session = restore()
    mount(<Probe />)
    fireEvent.click(screen.getByText('Refresh'))
    await waitFor(() => expect(session.retry).toHaveBeenCalledOnce())
  })
  it('clears cached server data only after a confirmed native logout', async () => {
    const session = restore()
    let finish: (() => void) | undefined
    session.signOut.mockImplementation(() => new Promise<void>(resolve => { finish = resolve }))
    const { cache } = mount(<Probe />)
    cache.setQueryData(['previous-user'], 'private-fixture')
    fireEvent.click(screen.getByText('Logout'))
    expect(cache.getQueryData(['previous-user'])).toBe('private-fixture')
    act(() => { finish?.() })
    await waitFor(() => expect(cache.getQueryData(['previous-user'])).toBeUndefined())
  })
  it('keeps the current interface and cache when native logout fails', async () => {
    restore().signOut.mockRejectedValue(new Error('logout_failed'))
    const { cache } = mount(<Probe />)
    cache.setQueryData(['current-user'], 'retained-fixture')
    fireEvent.click(screen.getByText('Logout'))
    expect(await screen.findByRole('alert')).toHaveTextContent('logout_failed')
    expect(screen.getByText('trainer:trainer:profile-1')).toBeVisible()
    expect(cache.getQueryData(['current-user'])).toBe('retained-fixture')
  })
  it('keeps a pending native request alive during session refresh', async () => {
    restore()
    let finish: ((value: boolean) => void) | undefined
    const load = vi.fn(() => new Promise<boolean>(resolve => { finish = resolve }))
    function Pending() { const query = useQuery({ queryKey: ['native-legal'], queryFn: load }); return <p>{query.data ? 'accepted' : 'checking'}</p> }
    mount(<><Probe /><Pending /></>)
    await waitFor(() => expect(load).toHaveBeenCalledOnce())
    fireEvent.click(screen.getByText('Refresh'))
    act(() => { finish?.(true) })
    expect(await screen.findByText('accepted')).toBeVisible()
    expect(load).toHaveBeenCalledOnce()
  })
  it('preserves native loading and recoverable restore errors', () => {
    const state = restore()
    state.session = null
    state.loading = true
    const { rerender } = mount(<Probe />)
    expect(screen.getByText('loading')).toBeVisible()
    state.loading = false
    state.error = 'restore_failed'
    rerender(<QueryClientProvider client={new QueryClient()}><AuthProvider><Probe /></AuthProvider></QueryClientProvider>)
    expect(screen.getByText('restore_failed')).toBeVisible()
  })
})
