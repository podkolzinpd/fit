import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TrainerActor } from '../../shared/domain'
import { YandexAccountLinkingCard } from './YandexAccountLinkingCard'

const createYandexAuthorizationUrl = vi.hoisted(() => vi.fn())
const getSession = vi.hoisted(() => vi.fn())
const getYandexAccountLinkStatus = vi.hoisted(() => vi.fn())

vi.mock('./yandex-pilot-oauth', () => ({ createYandexAuthorizationUrl }))
vi.mock('../../data/repositories/auth.repository', () => ({
  authRepository: { getSession },
}))
vi.mock('../../data/repositories/yandex-pilot.repository', () => ({
  yandexPilotRepository: { getYandexAccountLinkStatus },
}))

const actor: TrainerActor = {
  kind: 'trainer',
  userId: 'trainer-1',
  role: 'trainer',
  email: 'trainer@test.com',
  firstName: 'Ирина',
  lastName: null,
  timezone: 'Europe/Moscow',
}

function renderCard(onNavigate?: (url: string) => void) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(<QueryClientProvider client={queryClient}>
    <YandexAccountLinkingCard actor={actor} onNavigate={onNavigate} />
  </QueryClientProvider>)
}

describe('YandexAccountLinkingCard', () => {
  beforeEach(() => {
    createYandexAuthorizationUrl.mockReset()
    getSession.mockReset()
    getYandexAccountLinkStatus.mockReset()
    getSession.mockResolvedValue({
      data: { session: { access_token: 'supabase-session' } },
      error: null,
    })
    getYandexAccountLinkStatus.mockResolvedValue({ linked: false })
    vi.stubEnv('VITE_YANDEX_OAUTH_CLIENT_ID', 'public-client-id')
    vi.stubEnv('VITE_YANDEX_API_BASE_URL', 'https://stage.example.test')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    sessionStorage.clear()
  })

  it('stays hidden when the global linking switch is off', () => {
    vi.stubEnv('VITE_YANDEX_SESSION_LINKING_ENABLED', '')

    renderCard()

    expect(screen.queryByText(/Yandex ID/)).not.toBeInTheDocument()
    expect(getYandexAccountLinkStatus).not.toHaveBeenCalled()
  })

  it('shows the linking action to every authenticated user when the global switch is on', async () => {
    vi.stubEnv('VITE_YANDEX_SESSION_LINKING_ENABLED', 'true')

    renderCard()

    expect(await screen.findByRole('heading', { name: 'Привязать Yandex ID' })).toBeVisible()
    expect(getYandexAccountLinkStatus).toHaveBeenCalledWith(
      'https://stage.example.test',
      'supabase-session',
    )
  })

  it('removes the home prompt after the account is linked', async () => {
    vi.stubEnv('VITE_YANDEX_SESSION_LINKING_ENABLED', 'true')
    getYandexAccountLinkStatus.mockResolvedValue({ linked: true })

    renderCard()

    await waitFor(() => expect(getYandexAccountLinkStatus).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('heading', { name: /Yandex ID/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Привязать Yandex ID' })).not.toBeInTheDocument()
  })

  it('retries a failed status check', async () => {
    const user = userEvent.setup()
    vi.stubEnv('VITE_YANDEX_SESSION_LINKING_ENABLED', 'true')
    getYandexAccountLinkStatus
      .mockRejectedValueOnce(new Error('Не удалось проверить привязку Yandex ID.'))
      .mockResolvedValueOnce({ linked: true })

    renderCard()

    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось проверить привязку Yandex ID.')
    await user.click(screen.getByRole('button', { name: 'Повторить' }))
    await waitFor(() => expect(getYandexAccountLinkStatus).toHaveBeenCalledTimes(2))
    expect(screen.queryByRole('heading', { name: /Yandex ID/ })).not.toBeInTheDocument()
  })

  it('starts the linking OAuth flow for an unlinked user', async () => {
    const user = userEvent.setup()
    const onNavigate = vi.fn()
    createYandexAuthorizationUrl.mockResolvedValue('https://oauth.yandex.ru/authorize?state=state')
    vi.stubEnv('VITE_YANDEX_SESSION_LINKING_ENABLED', 'true')

    renderCard(onNavigate)

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

  it('shows a retryable error when the OAuth URL cannot be created', async () => {
    const user = userEvent.setup()
    createYandexAuthorizationUrl.mockRejectedValue(new Error('storage unavailable'))
    vi.stubEnv('VITE_YANDEX_SESSION_LINKING_ENABLED', 'true')

    renderCard(vi.fn())

    await user.click(await screen.findByRole('button', { name: 'Привязать Yandex ID' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось начать привязку Yandex ID')
    expect(screen.getByRole('button', { name: 'Привязать Yandex ID' })).toBeEnabled()
  })
})
