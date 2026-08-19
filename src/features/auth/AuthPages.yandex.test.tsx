import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { YandexPilotCallbackPage } from './AuthPages'
import { createYandexAuthorizationUrl } from './yandex-pilot-oauth'

const pilot = vi.hoisted(() => ({ exchangeCodeForProfile: vi.fn() }))
vi.mock('../../data/repositories/yandex-pilot.repository', () => ({
  yandexPilotRepository: { exchangeCodeForProfile: pilot.exchangeCodeForProfile },
}))

async function callbackSearch(): Promise<string> {
  const authorizationUrl = new URL(await createYandexAuthorizationUrl(
    'public-client-id',
    'http://localhost/auth/yandex/callback',
  ))
  return `?code=one-time-code&state=${authorizationUrl.searchParams.get('state')}`
}

describe('Yandex ID pilot callback page', () => {
  beforeEach(() => {
    pilot.exchangeCodeForProfile.mockReset()
    vi.stubEnv('VITE_YANDEX_ID_PILOT_ENABLED', 'true')
    vi.stubEnv('VITE_YANDEX_OAUTH_CLIENT_ID', 'public-client-id')
    vi.stubEnv('VITE_YANDEX_API_BASE_URL', 'https://stage.example.test')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    window.history.replaceState(null, '', '/')
    sessionStorage.clear()
  })

  it('removes the OAuth fragment and shows only the read-only profile', async () => {
    pilot.exchangeCodeForProfile.mockResolvedValue({
      accessMode: 'read_only',
      profile: {
        id: 'd2b80c5e-f60b-42b0-ae3f-308e91bbcb9b',
        firstName: 'Ирина',
        lastName: null,
        timezone: 'Europe/Moscow',
        accountRole: 'trainer',
      },
    })
    window.history.replaceState(null, '', `/auth/yandex/callback${await callbackSearch()}`)

    render(<MemoryRouter><YandexPilotCallbackPage /></MemoryRouter>)

    expect(window.location.search).toBe('')
    expect(await screen.findByRole('heading', { name: 'Доступ подтверждён' })).toBeVisible()
    expect(screen.getByText('Ирина')).toBeVisible()
    expect(screen.getByText('Только чтение')).toBeVisible()
    expect(pilot.exchangeCodeForProfile).toHaveBeenCalledWith(
      'https://stage.example.test',
      'one-time-code',
      expect.stringMatching(/^[A-Za-z0-9_-]{43,128}$/),
    )
  })

  it('shows an allowlist error without exposing the pilot profile', async () => {
    pilot.exchangeCodeForProfile.mockRejectedValue(new Error('Этот аккаунт пока не добавлен в пилот.'))
    window.history.replaceState(null, '', `/auth/yandex/callback${await callbackSearch()}`)

    render(<MemoryRouter><YandexPilotCallbackPage /></MemoryRouter>)

    expect(await screen.findByRole('heading', { name: 'Не удалось войти' })).toBeVisible()
    expect(screen.getByText('Этот аккаунт пока не добавлен в пилот.')).toBeVisible()
    await waitFor(() => expect(window.location.search).toBe(''))
  })
})
