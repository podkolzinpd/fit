import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { YandexAppSessionProvider, useYandexAppSession } from './yandex-app-session-context'

const repository = vi.hoisted(() => ({
  getAppSession: vi.fn(),
  revokeAppSession: vi.fn(),
}))

vi.mock('../data/repositories/yandex-pilot.repository', async (importOriginal) => {
  const original = await importOriginal<typeof import('../data/repositories/yandex-pilot.repository')>()
  return {
    ...original,
    yandexPilotRepository: repository,
  }
})

const PROFILE_ID = 'd2b80c5e-f60b-42b0-ae3f-308e91bbcb9b'
const TOKEN = 'a'.repeat(43)
const profile = {
  accessMode: 'read_write' as const,
  profile: {
    id: PROFILE_ID,
    firstName: 'Ирина',
    lastName: null,
    timezone: 'Europe/Moscow',
    accountRole: 'trainer' as const,
  },
}

function Probe() {
  const { session, loading, error, retry, signOut } = useYandexAppSession()
  return <div>
    <p>{loading ? 'loading' : session?.profile.firstName ?? error ?? 'anonymous'}</p>
    <button onClick={() => void retry()}>retry</button>
    <button onClick={() => void signOut()}>logout</button>
  </div>
}

function storeSession(expiresAt = '2099-09-01T12:00:00.000Z'): void {
  window.localStorage.setItem('fit.yandexAppSession.v1', JSON.stringify({ token: TOKEN, expiresAt }))
}

describe('YandexAppSessionProvider', () => {
  const storage = new Map<string, string>()

  beforeEach(() => {
    storage.clear()
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        clear: () => storage.clear(),
        getItem: (key: string) => storage.get(key) ?? null,
        removeItem: (key: string) => storage.delete(key),
        setItem: (key: string, value: string) => storage.set(key, value),
      },
    })
    repository.getAppSession.mockReset().mockResolvedValue(profile)
    repository.revokeAppSession.mockReset().mockResolvedValue(undefined)
    vi.stubEnv('VITE_YANDEX_APP_SESSION_ENABLED', 'true')
    vi.stubEnv('VITE_YANDEX_APP_SESSION_PILOT_USER_IDS', PROFILE_ID)
    vi.stubEnv('VITE_YANDEX_OAUTH_CLIENT_ID', 'public-client-id')
    vi.stubEnv('VITE_YANDEX_API_BASE_URL', 'https://stage.example.test')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    storage.clear()
  })

  it('restores a non-expired session through the server', async () => {
    storeSession()
    render(<YandexAppSessionProvider><Probe /></YandexAppSessionProvider>)

    expect(await screen.findByText('Ирина')).toBeVisible()
    expect(repository.getAppSession).toHaveBeenCalledWith('https://stage.example.test', TOKEN)
  })

  it('drops an expired local session without contacting the server', async () => {
    storeSession('2020-01-01T00:00:00.000Z')
    render(<YandexAppSessionProvider><Probe /></YandexAppSessionProvider>)

    expect(await screen.findByText('anonymous')).toBeVisible()
    expect(repository.getAppSession).not.toHaveBeenCalled()
    expect(window.localStorage.getItem('fit.yandexAppSession.v1')).toBeNull()
  })

  it('keeps a recoverable session for retry after a network error', async () => {
    repository.getAppSession
      .mockRejectedValueOnce(new Error('Yandex Cloud вход временно недоступен.'))
      .mockResolvedValueOnce(profile)
    storeSession()
    render(<YandexAppSessionProvider><Probe /></YandexAppSessionProvider>)

    expect(await screen.findByText('Yandex Cloud вход временно недоступен.')).toBeVisible()
    expect(window.localStorage.getItem('fit.yandexAppSession.v1')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'retry' }))
    expect(await screen.findByText('Ирина')).toBeVisible()
  })

  it('revokes the server session and clears the local token on logout', async () => {
    storeSession()
    render(<YandexAppSessionProvider><Probe /></YandexAppSessionProvider>)
    expect(await screen.findByText('Ирина')).toBeVisible()

    fireEvent.click(screen.getByRole('button', { name: 'logout' }))

    await waitFor(() => expect(repository.revokeAppSession).toHaveBeenCalledWith(
      'https://stage.example.test', TOKEN,
    ))
    expect(screen.getByText('anonymous')).toBeVisible()
    expect(window.localStorage.getItem('fit.yandexAppSession.v1')).toBeNull()
  })

  it('revokes and rejects a profile outside the frontend rollout allowlist', async () => {
    vi.stubEnv('VITE_YANDEX_APP_SESSION_PILOT_USER_IDS', '11111111-1111-4111-8111-111111111111')
    storeSession()
    render(<YandexAppSessionProvider><Probe /></YandexAppSessionProvider>)

    expect(await screen.findByText('Этот профиль не добавлен в пилот входа через Yandex ID.')).toBeVisible()
    expect(repository.revokeAppSession).toHaveBeenCalledWith('https://stage.example.test', TOKEN)
    expect(window.localStorage.getItem('fit.yandexAppSession.v1')).toBeNull()
  })
})
