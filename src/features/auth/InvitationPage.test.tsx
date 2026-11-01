import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { PropsWithChildren } from 'react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  actor: null as null | { userId: string; email: string; role: 'client' | 'trainer'; firstName?: string; lastName?: string },
  backendAvailable: true,
  backendSource: 'supabase' as 'supabase' | 'yandex',
}))
const claimLink = vi.hoisted(() => vi.fn())
const preview = vi.hoisted(() => vi.fn())
const signOut = vi.hoisted(() => vi.fn())

vi.mock('../../app/auth-context', () => ({
  useAuth: () => ({ actor: state.actor, loading: false, error: null, signOut }),
}))
vi.mock('../../app/data-backend-context', () => ({
  useOptionalDataBackend: () => state.backendAvailable ? { source: state.backendSource, invitations: { claimLink } } : null,
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
      <Route path="/me" element={<LocationProbe />} />
    </Routes>
  </MemoryRouter></QueryClientProvider>)
}

describe('InvitationPage', () => {
  beforeEach(() => {
    state.actor = null
    state.backendAvailable = true
    state.backendSource = 'supabase'
    claimLink.mockReset()
    preview.mockReset()
    signOut.mockReset().mockResolvedValue(undefined)
    Object.defineProperty(window, 'sessionStorage', { configurable: true, value: memoryStorage() })
    window.history.replaceState(null, '', `/invite?token=${token}&source=supabase`)
    preview.mockResolvedValue({
      targetRole: 'trainer', inviterName: 'Антон',
      expiresAt: '2026-09-25T12:00:00.000Z', status: 'active',
    })
  })

  it('shows the sender before login and carries the intended role into registration', async () => {
    const user = userEvent.setup()
    renderPage()

    expect(await screen.findByRole('heading', { name: 'Приглашение стать тренером' })).toBeVisible()
    expect(screen.getByRole('region', { name: 'Отправитель приглашения' })).toHaveTextContent('Антон')
    expect(window.location.search).toBe('')
    expect(window.location.hash).toBe('')
    await user.click(screen.getByRole('button', { name: 'Создать аккаунт' }))

    expect(screen.getByRole('status')).toHaveTextContent('"path":"/auth"')
    expect(screen.getByRole('status')).toHaveTextContent('"mode":"register"')
    expect(screen.getByRole('status')).toHaveTextContent('"inviteRole":"trainer"')
  })

  it('keeps the link reloadable and explains how to continue when storage is blocked', async () => {
    const blockedStorage = memoryStorage()
    blockedStorage.getItem = () => { throw new DOMException('Access is denied', 'SecurityError') }
    blockedStorage.setItem = () => { throw new DOMException('Access is denied', 'SecurityError') }
    Object.defineProperty(window, 'sessionStorage', { configurable: true, value: blockedStorage })

    const firstRender = renderPage()

    expect(await screen.findByRole('heading', { name: 'Приглашение стать тренером' })).toBeVisible()
    expect(screen.getByText('Откройте ссылку в Safari или Chrome')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Создать аккаунт' })).not.toBeInTheDocument()
    expect(window.location.search).toBe(`?token=${token}&source=supabase`)

    firstRender.unmount()
    renderPage()

    expect(await screen.findByRole('heading', { name: 'Приглашение стать тренером' })).toBeVisible()
    expect(window.location.search).toBe(`?token=${token}&source=supabase`)
  })

  it('keeps existing fragment links working', async () => {
    window.history.replaceState(null, '', `/invite#token=${token}&source=supabase`)
    renderPage()

    expect(await screen.findByRole('heading', { name: 'Приглашение стать тренером' })).toBeVisible()
    expect(window.location.hash).toBe('')
  })

  it('does not let an account with the wrong role accept the invitation', async () => {
    const user = userEvent.setup()
    state.actor = { userId: 'client-1', email: 'client@example.test', role: 'client' }
    renderPage()

    expect(await screen.findByText('Это приглашение предназначено тренеру')).toBeVisible()
    expect(claimLink).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Войти под другим аккаунтом' }))

    await waitFor(() => expect(signOut).toHaveBeenCalledOnce())
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

  it('claims a migrated legacy-source link through the Yandex backend', async () => {
    const user = userEvent.setup()
    state.backendSource = 'yandex'
    state.actor = { userId: 'trainer-1', email: 'trainer@example.test', role: 'trainer' }
    claimLink.mockResolvedValue('52500000-0000-4000-8000-000000000010')
    renderPage()

    await user.click(await screen.findByRole('button', { name: 'Стать тренером' }))

    expect(await screen.findByRole('heading', { name: 'Спортсмен подключён' })).toBeVisible()
    expect(claimLink).toHaveBeenCalledWith(token)
  })

  it.each(['expired', 'revoked'] as const)('shows terminal %s without offering a claim or a network retry', async status => {
    preview.mockResolvedValue({ targetRole: 'client', inviterName: 'Антон', expiresAt: '2026-09-25T12:00:00.000Z', status })
    renderPage()
    expect(await screen.findByText(status === 'expired' ? 'Срок приглашения истёк' : 'Приглашение отменено')).toBeVisible()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(claimLink).not.toHaveBeenCalled()
    expect(window.sessionStorage.getItem('fit.pendingInvitationLink.v1')).toBeNull()
  })

  it('retries a failed preview while preserving the captured invitation', async () => {
    preview.mockRejectedValueOnce(new Error('Network unavailable'))
    const user = userEvent.setup()
    renderPage()
    expect(await screen.findByText('Не удалось проверить приглашение')).toBeVisible()
    expect(window.sessionStorage.getItem('fit.pendingInvitationLink.v1')).toContain(token)
    await user.click(screen.getByRole('button', { name: 'Повторить' }))
    expect(await screen.findByRole('heading', { name: 'Приглашение стать тренером' })).toBeVisible()
    expect(preview).toHaveBeenCalledTimes(2)
    expect(claimLink).not.toHaveBeenCalled()
  })

  it('identifies the current athlete and claims once during a slow response', async () => {
    state.actor = { userId: 'client-1', email: 'client@example.test', role: 'client', firstName: 'Анна', lastName: 'Лесная' }
    preview.mockResolvedValue({ targetRole: 'client', inviterName: 'Антон', expiresAt: '2026-09-25T12:00:00.000Z', status: 'claimed' })
    let resolve: (id: string) => void = () => { throw new Error('claim_not_started') }
    claimLink.mockImplementation(() => new Promise<string>(done => { resolve = done }))
    const user = userEvent.setup()
    renderPage()
    expect(await screen.findByText('Вы вошли как', { exact: false })).toHaveTextContent('Анна Лесная')
    await user.dblClick(screen.getByRole('button', { name: 'Проверить подключение' }))
    expect(claimLink).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Проверяем…' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Войти под другим аккаунтом' })).toBeDisabled()
    resolve('client-1')
    await user.click(await screen.findByRole('button', { name: 'Открыть кабинет' }))
    expect(screen.getByRole('status')).toHaveTextContent('"path":"/me"')
  })

  it('does not claim when the signed-in backend is unavailable', async () => {
    state.actor = { userId: 'trainer-1', email: 'trainer@example.test', role: 'trainer' }
    state.backendAvailable = false
    renderPage()
    expect(await screen.findByRole('button', { name: 'Стать тренером' })).toBeDisabled()
    expect(screen.getByText('Войдите в аккаунт снова')).toBeVisible()
    expect(claimLink).not.toHaveBeenCalled()
  })
})
