import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TrainerActor } from '../../shared/domain'
import { YandexAccountLinkingCard } from './YandexAccountLinkingCard'

const createYandexAuthorizationUrl = vi.hoisted(() => vi.fn())
vi.mock('./yandex-pilot-oauth', () => ({ createYandexAuthorizationUrl }))

const actor: TrainerActor = {
  kind: 'trainer',
  userId: 'trainer-1',
  role: 'trainer',
  email: 'trainer@test.com',
  firstName: 'Ирина',
  lastName: null,
  timezone: 'Europe/Moscow',
}

describe('YandexAccountLinkingCard', () => {
  beforeEach(() => {
    createYandexAuthorizationUrl.mockReset()
    vi.stubEnv('VITE_YANDEX_ID_PILOT_ENABLED', 'true')
    vi.stubEnv('VITE_YANDEX_OAUTH_CLIENT_ID', 'public-client-id')
    vi.stubEnv('VITE_YANDEX_API_BASE_URL', 'https://stage.example.test')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    sessionStorage.clear()
  })

  it('stays hidden by default even when the base Yandex config exists', () => {
    vi.stubEnv('VITE_YANDEX_SESSION_LINKING_ENABLED', '')
    vi.stubEnv('VITE_YANDEX_SESSION_LINKING_PILOT_USER_IDS', 'trainer-1')

    render(<YandexAccountLinkingCard actor={actor} />)

    expect(screen.queryByRole('heading', { name: 'Привязать Yandex ID' })).not.toBeInTheDocument()
  })

  it('stays hidden for a user outside the allowlist', () => {
    vi.stubEnv('VITE_YANDEX_SESSION_LINKING_ENABLED', 'true')
    vi.stubEnv('VITE_YANDEX_SESSION_LINKING_PILOT_USER_IDS', 'trainer-2')

    render(<YandexAccountLinkingCard actor={actor} />)

    expect(screen.queryByRole('button', { name: 'Привязать Yandex ID' })).not.toBeInTheDocument()
  })

  it('starts the linking OAuth flow for an allowlisted user', async () => {
    const user = userEvent.setup()
    const onNavigate = vi.fn()
    createYandexAuthorizationUrl.mockResolvedValue('https://oauth.yandex.ru/authorize?state=state')
    vi.stubEnv('VITE_YANDEX_SESSION_LINKING_ENABLED', 'true')
    vi.stubEnv('VITE_YANDEX_SESSION_LINKING_PILOT_USER_IDS', 'trainer-1')

    render(<YandexAccountLinkingCard actor={actor} onNavigate={onNavigate} />)

    await user.click(screen.getByRole('button', { name: 'Привязать Yandex ID' }))

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
    vi.stubEnv('VITE_YANDEX_SESSION_LINKING_PILOT_USER_IDS', 'trainer-1')

    render(<YandexAccountLinkingCard actor={actor} onNavigate={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'Привязать Yandex ID' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось начать привязку Yandex ID')
    expect(screen.getByRole('button', { name: 'Привязать Yandex ID' })).toBeEnabled()
  })
})
