import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { PropsWithChildren } from 'react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  actor: null as null | { userId: string; email: string; role: 'client' | 'trainer' },
}))
const claimLink = vi.hoisted(() => vi.fn())
const preview = vi.hoisted(() => vi.fn())
const signOut = vi.hoisted(() => vi.fn())
const signOutYandex = vi.hoisted(() => vi.fn())

vi.mock('../../app/auth-context', () => ({
  useAuth: () => ({ actor: state.actor, loading: false, error: null }),
}))
vi.mock('../../app/data-backend-context', () => ({
  useDataBackend: () => ({ source: 'supabase', invitations: { claimLink } }),
}))
vi.mock('../../app/yandex-app-session-context', () => ({
  useYandexAppSession: () => ({ signOut: signOutYandex }),
}))
vi.mock('../../data/repositories/auth.repository', () => ({
  authRepository: { signOut },
}))
vi.mock('../../data/repositories/invitations.repository', () => ({
  invitationsRepository: { claimLink },
}))
vi.mock('../../data/repositories/public-invitation-links.repository', () => ({
  publicInvitationLinksRepository: { preview },
}))
vi.mock('./AuthPages', () => ({
  AuthIdentityScreen: ({ children, className }: PropsWithChildren<{ className?: string }>) => <main className={className}>{children}</main>,
}))

import { InvitationPage } from './InvitationPage'

const token = `ABCDEF123456.${'a'.repeat(64)}`

function memoryStorage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() { return values.size },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => Array.from(values.keys())[index] ?? null,
    removeItem: (key) => { values.delete(key) },
    setItem: (key, value) => { values.set(key, value) },
  }
}

function LocationProbe() {
  const location = useLocation()
  const navigationState: unknown = location.state
  return <output>{JSON.stringify({ path: location.pathname, state: navigationState })}</output>
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/invite']}>
    <Routes>
      <Route path="/invite" element={<InvitationPage />} />
      <Route path="/auth" element={<LocationProbe />} />
      <Route path="/clients/:clientId" element={<LocationProbe />} />
    </Routes>
  </MemoryRouter></QueryClientProvider>)
}

describe('InvitationPage', () => {
  beforeEach(() => {
    state.actor = null
    claimLink.mockReset()
    preview.mockReset()
    signOut.mockReset().mockResolvedValue(undefined)
    signOutYandex.mockReset().mockResolvedValue(undefined)
    Object.defineProperty(window, 'sessionStorage', { configurable: true, value: memoryStorage() })
    window.history.replaceState(null, '', `/invite#token=${token}&source=supabase`)
    preview.mockResolvedValue({
      targetRole: 'trainer', inviterName: 'Антон',
      expiresAt: '2026-09-25T12:00:00.000Z', status: 'active',
    })
  })

  it('shows the sender before login and carries the intended role into registration', async () => {
    const user = userEvent.setup()
    renderPage()

    expect(await screen.findByRole('heading', { name: 'Антон приглашает вас стать тренером' })).toBeVisible()
    expect(window.location.hash).toBe('')
    await user.click(screen.getByRole('button', { name: 'Создать аккаунт' }))

    expect(screen.getByRole('status')).toHaveTextContent('"path":"/auth"')
    expect(screen.getByRole('status')).toHaveTextContent('"mode":"register"')
    expect(screen.getByRole('status')).toHaveTextContent('"inviteRole":"trainer"')
  })

  it('does not let an account with the wrong role accept the invitation', async () => {
    const user = userEvent.setup()
    state.actor = { userId: 'client-1', email: 'client@example.test', role: 'client' }
    renderPage()

    expect(await screen.findByText('Это приглашение предназначено тренеру')).toBeVisible()
    expect(claimLink).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Войти под другим аккаунтом' }))

    await waitFor(() => expect(signOut).toHaveBeenCalledOnce())
    expect(signOutYandex).toHaveBeenCalledOnce()
    expect(screen.getByRole('status')).toHaveTextContent('"path":"/auth"')
  })

  it('claims once for the matching role and opens the connected client card', async () => {
    const user = userEvent.setup()
    state.actor = { userId: 'trainer-1', email: 'trainer@example.test', role: 'trainer' }
    claimLink.mockResolvedValue('52500000-0000-4000-8000-000000000010')
    renderPage()

    await user.click(await screen.findByRole('button', { name: 'Стать тренером' }))
    expect(await screen.findByRole('heading', { name: 'Спортсмен подключён' })).toBeVisible()
    expect(claimLink).toHaveBeenCalledTimes(1)
    expect(window.sessionStorage.getItem('fit.pendingInvitationLink.v1')).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Открыть карточку' }))
    expect(screen.getByRole('status')).toHaveTextContent('/clients/52500000-0000-4000-8000-000000000010')
  })
})
