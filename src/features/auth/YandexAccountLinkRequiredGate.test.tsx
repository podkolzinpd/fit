import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TrainerActor } from '../../shared/domain'
import { YandexAccountLinkRequiredGate } from './YandexAccountLinkRequiredGate'

const createYandexAuthorizationUrl = vi.hoisted(() => vi.fn())
const getSession = vi.hoisted(() => vi.fn())
const getYandexAccountLinkStatus = vi.hoisted(() => vi.fn())
const signOut = vi.hoisted(() => vi.fn())
const useOptionalYandexAppSession = vi.hoisted(() => vi.fn())

const actor: TrainerActor = {
  kind: 'trainer',
  userId: 'trainer-1',
  role: 'trainer',
  email: 'trainer@test.com',
  firstName: 'Ирина',
  lastName: null,
  timezone: 'Europe/Moscow',
}

vi.mock('./yandex-pilot-oauth', () => ({ createYandexAuthorizationUrl }))
vi.mock('../../app/auth-context', () => ({
  useAuth: () => ({ actor, loading: false, error: null, signOut }),
}))
vi.mock('../../app/yandex-app-session-context', () => ({ useOptionalYandexAppSession }))
vi.mock('../../data/repositories/auth.repository', () => ({
  authRepository: { getSession },
}))
vi.mock('../../data/repositories/yandex-pilot.repository', () => ({
  yandexPilotRepository: { getYandexAccountLinkStatus },
}))

function renderGate(onNavigate?: (url: string) => void) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(<QueryClientProvider client={queryClient}>
    <MemoryRouter>
      <YandexAccountLinkRequiredGate onNavigate={onNavigate}>
        <p>Основное приложение</p>
      </YandexAccountLinkRequiredGate>
    </MemoryRouter>
  </QueryClientProvider>)
}

describe('YandexAccountLinkRequiredGate', () => {
  beforeEach(() => {
    createYandexAuthorizationUrl.mockReset()
    getSession.mockReset()
    getYandexAccountLinkStatus.mockReset()
    signOut.mockReset()
    useOptionalYandexAppSession.mockReset()
    getSession.mockResolvedValue({
      data: { session: { access_token: 'supabase-session' } },
      error: null,
    })
    getYandexAccountLinkStatus.mockResolvedValue({ linked: false })
    useOptionalYandexAppSession.mockReturnValue({ session: null })
    vi.stubEnv('VITE_YANDEX_ACCOUNT_LINK_REQUIRED', 'true')
    vi.stubEnv('VITE_YANDEX_SESSION_LINKING_ENABLED', 'true')
    vi.stubEnv('VITE_YANDEX_OAUTH_CLIENT_ID', 'public-client-id')
    vi.stubEnv('VITE_YANDEX_API_BASE_URL', 'https://stage.example.test')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    sessionStorage.clear()
  })

  it('does not check or block the app while the independent gate flag is off', () => {
    vi.stubEnv('VITE_YANDEX_ACCOUNT_LINK_REQUIRED', '')

    renderGate()

    expect(screen.getByText('Основное приложение')).toBeVisible()
    expect(getYandexAccountLinkStatus).not.toHaveBeenCalled()
  })

  it('lets an already linked FIT profile continue without another action', async () => {
    getYandexAccountLinkStatus.mockResolvedValue({ linked: true })

    renderGate()

    expect(await screen.findByText('Основное приложение')).toBeVisible()
    expect(screen.queryByRole('heading', { name: 'Привяжите Yandex ID' })).not.toBeInTheDocument()
  })

  it('lets an active Yandex app session continue without a Supabase status check', () => {
    useOptionalYandexAppSession.mockReturnValue({
      session: { profile: { id: actor.userId }, session: { token: 'token' } },
    })

    renderGate()

    expect(screen.getByText('Основное приложение')).toBeVisible()
    expect(getYandexAccountLinkStatus).not.toHaveBeenCalled()
  })

  it('blocks the product routes for an unlinked profile and keeps one primary action', async () => {
    renderGate()

    expect(await screen.findByRole('heading', { name: 'Привяжите Yandex ID' })).toBeVisible()
    expect(screen.queryByText('Основное приложение')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Привязать Yandex ID' })).toHaveClass('primary')
    expect(screen.getByRole('button', { name: 'Выйти' })).toBeVisible()
    expect(screen.getByRole('link', { name: 'Условия использования' })).toHaveAttribute('href', '/legal/terms')
  })

  it('retries a failed status check and opens the app after a linked response', async () => {
    const user = userEvent.setup()
    getYandexAccountLinkStatus
      .mockRejectedValueOnce(new Error('Yandex API временно недоступен.'))
      .mockResolvedValueOnce({ linked: true })

    renderGate()

    expect(await screen.findByRole('alert')).toHaveTextContent('Yandex API временно недоступен.')
    await user.click(screen.getByRole('button', { name: 'Повторить' }))
    expect(await screen.findByText('Основное приложение')).toBeVisible()
    expect(getYandexAccountLinkStatus).toHaveBeenCalledTimes(2)
  })

  it('starts the existing PKCE linking flow and exposes pending state', async () => {
    const user = userEvent.setup()
    const onNavigate = vi.fn()
    createYandexAuthorizationUrl.mockResolvedValue('https://oauth.yandex.ru/authorize?state=state')

    renderGate(onNavigate)

    await user.click(await screen.findByRole('button', { name: 'Привязать Yandex ID' }))

    expect(screen.getByRole('button', { name: 'Переходим в Yandex ID…' })).toBeDisabled()
    await waitFor(() => expect(onNavigate).toHaveBeenCalledWith('https://oauth.yandex.ru/authorize?state=state'))
    expect(createYandexAuthorizationUrl).toHaveBeenCalledWith(
      'public-client-id',
      `${window.location.origin}/auth/yandex/callback`,
      sessionStorage,
      'link',
    )
  })

  it('keeps the user in a recoverable state when the OAuth flow cannot start', async () => {
    const user = userEvent.setup()
    createYandexAuthorizationUrl.mockRejectedValue(new Error('storage unavailable'))

    renderGate(vi.fn())

    await user.click(await screen.findByRole('button', { name: 'Привязать Yandex ID' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось начать привязку Yandex ID')
    expect(screen.getByRole('button', { name: 'Привязать Yandex ID' })).toBeEnabled()
  })

  it('fails closed when the required gate is enabled without public linking config', () => {
    vi.stubEnv('VITE_YANDEX_API_BASE_URL', '')

    renderGate()

    expect(screen.getByRole('heading', { name: 'Привязка Yandex ID недоступна' })).toBeVisible()
    expect(screen.queryByText('Основное приложение')).not.toBeInTheDocument()
    expect(getYandexAccountLinkStatus).not.toHaveBeenCalled()
  })
})
