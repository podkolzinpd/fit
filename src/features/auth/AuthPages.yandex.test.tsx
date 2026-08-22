import { StrictMode } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { YandexPilotCallbackPage } from './AuthPages'
import { createYandexAuthorizationUrl } from './yandex-pilot-oauth'

const pilot = vi.hoisted(() => ({
  exchangeCodeForSession: vi.fn(),
  listClients: vi.fn(),
  listConnections: vi.fn(),
}))
vi.mock('../../data/repositories/yandex-pilot.repository', () => ({
  yandexPilotRepository: {
    exchangeCodeForSession: pilot.exchangeCodeForSession,
    listClients: pilot.listClients,
    listConnections: pilot.listConnections,
  },
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
    pilot.exchangeCodeForSession.mockReset()
    pilot.listClients.mockReset()
    pilot.listConnections.mockReset()
    pilot.listConnections.mockResolvedValue({ memberships: [], invitations: [] })
    vi.stubEnv('VITE_YANDEX_ID_PILOT_ENABLED', 'true')
    vi.stubEnv('VITE_YANDEX_OAUTH_CLIENT_ID', 'public-client-id')
    vi.stubEnv('VITE_YANDEX_API_BASE_URL', 'https://stage.example.test')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    window.history.replaceState(null, '', '/')
    sessionStorage.clear()
  })

  it('removes the OAuth query and shows the read-only profile with its clients', async () => {
    pilot.exchangeCodeForSession.mockResolvedValue({
      accessMode: 'read_only',
      profile: {
        id: 'd2b80c5e-f60b-42b0-ae3f-308e91bbcb9b',
        firstName: 'Ирина',
        lastName: null,
        timezone: 'Europe/Moscow',
        accountRole: 'trainer',
      },
      session: {
        token: 's'.repeat(43),
        expiresAt: '2026-08-20T13:15:00.000Z',
      },
    })
    pilot.listClients.mockResolvedValue([{
      id: '6e577cc7-3b56-4a86-bc85-1ce2426ce249',
      fullName: 'Анна Смирнова',
      ageYears: 31,
      heightCm: 168,
      goal: 'Подготовка к старту',
    }])
    pilot.listConnections.mockResolvedValue({
      memberships: [{
        clientId: '6e577cc7-3b56-4a86-bc85-1ce2426ce249',
        trainerId: 'd2b80c5e-f60b-42b0-ae3f-308e91bbcb9b',
        firstName: 'Ирина',
        lastName: null,
        joinedAt: '2026-08-20T12:00:00.000Z',
        isRoot: true,
      }],
      invitations: [{
        id: 'a64d98d9-5b1d-4d4a-9028-2114fa361c0f',
        clientId: '6e577cc7-3b56-4a86-bc85-1ce2426ce249',
        targetRole: 'client',
        expiresAt: '2026-08-27T12:00:00.000Z',
        createdAt: '2026-08-20T12:00:00.000Z',
      }],
    })
    window.history.replaceState(null, '', `/auth/yandex/callback${await callbackSearch()}`)

    render(<StrictMode><MemoryRouter><YandexPilotCallbackPage /></MemoryRouter></StrictMode>)

    expect(window.location.search).toBe('')
    expect(await screen.findByRole('heading', { name: 'Доступ подтверждён' })).toBeVisible()
    expect(screen.getByText('Ирина')).toBeVisible()
    expect(screen.getByText('Только чтение')).toBeVisible()
    expect(await screen.findAllByText('Анна Смирнова')).toHaveLength(2)
    expect(screen.getByText('31 лет · 168 см · Подготовка к старту')).toBeVisible()
    expect(screen.queryByRole('link', { name: 'Анна Смирнова' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Связи и приглашения' })).toBeVisible()
    expect(screen.getByText('Ирина · основной')).toBeVisible()
    expect(screen.getByText(/Активное приглашение для клиента до/)).toBeVisible()
    expect(pilot.exchangeCodeForSession).toHaveBeenCalledWith(
      'https://stage.example.test',
      'one-time-code',
      expect.stringMatching(/^[A-Za-z0-9_-]{43,128}$/),
    )
    expect(pilot.listClients).toHaveBeenCalledWith(
      'https://stage.example.test',
      's'.repeat(43),
    )
    expect(pilot.exchangeCodeForSession).toHaveBeenCalledTimes(1)
    expect(pilot.listClients).toHaveBeenCalledTimes(1)
    expect(pilot.listConnections).toHaveBeenCalledWith(
      'https://stage.example.test',
      's'.repeat(43),
    )
    expect(pilot.listConnections).toHaveBeenCalledTimes(1)
  })

  it('shows an explicit empty state before tenant data is migrated', async () => {
    pilot.exchangeCodeForSession.mockResolvedValue({
      accessMode: 'read_only',
      profile: {
        id: 'd2b80c5e-f60b-42b0-ae3f-308e91bbcb9b',
        firstName: null,
        lastName: null,
        timezone: 'Europe/Moscow',
        accountRole: 'trainer',
      },
      session: {
        token: 's'.repeat(43),
        expiresAt: '2026-08-20T13:15:00.000Z',
      },
    })
    pilot.listClients.mockResolvedValue([])
    window.history.replaceState(null, '', `/auth/yandex/callback${await callbackSearch()}`)

    render(<MemoryRouter><YandexPilotCallbackPage /></MemoryRouter>)

    expect(await screen.findByText('В stage пока нет клиентов')).toBeVisible()
    expect(screen.getByText('Список появится после переноса данных этого тренера.')).toBeVisible()
    expect(screen.getByText('В stage пока нет связей')).toBeVisible()
    expect(screen.getByText('Они появятся после переноса memberships и активных приглашений.')).toBeVisible()
  })

  it('keeps the profile visible and retries a failed client read', async () => {
    const user = userEvent.setup()
    pilot.exchangeCodeForSession.mockResolvedValue({
      accessMode: 'read_only',
      profile: {
        id: 'd2b80c5e-f60b-42b0-ae3f-308e91bbcb9b',
        firstName: 'Ирина',
        lastName: null,
        timezone: 'Europe/Moscow',
        accountRole: 'trainer',
      },
      session: {
        token: 's'.repeat(43),
        expiresAt: '2026-08-20T13:15:00.000Z',
      },
    })
    pilot.listClients
      .mockRejectedValueOnce(new Error('Пилот временно недоступен. Попробуйте позднее.'))
      .mockResolvedValueOnce([])
    window.history.replaceState(null, '', `/auth/yandex/callback${await callbackSearch()}`)

    render(<MemoryRouter><YandexPilotCallbackPage /></MemoryRouter>)

    expect(await screen.findByText('Пилот временно недоступен. Попробуйте позднее.')).toBeVisible()
    expect(screen.getByText('Ирина')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Повторить' }))
    expect(await screen.findByText('В stage пока нет клиентов')).toBeVisible()
    expect(pilot.listClients).toHaveBeenCalledTimes(2)
  })

  it('keeps the profile visible and retries a failed connections read', async () => {
    const user = userEvent.setup()
    pilot.exchangeCodeForSession.mockResolvedValue({
      accessMode: 'read_only',
      profile: {
        id: 'd2b80c5e-f60b-42b0-ae3f-308e91bbcb9b',
        firstName: 'Ирина',
        lastName: null,
        timezone: 'Europe/Moscow',
        accountRole: 'trainer',
      },
      session: {
        token: 's'.repeat(43),
        expiresAt: '2026-08-20T13:15:00.000Z',
      },
    })
    pilot.listClients.mockResolvedValue([])
    pilot.listConnections
      .mockRejectedValueOnce(new Error('Пилот временно недоступен. Попробуйте позднее.'))
      .mockResolvedValueOnce({ memberships: [], invitations: [] })
    window.history.replaceState(null, '', `/auth/yandex/callback${await callbackSearch()}`)

    render(<MemoryRouter><YandexPilotCallbackPage /></MemoryRouter>)

    expect(await screen.findByText('Пилот временно недоступен. Попробуйте позднее.')).toBeVisible()
    expect(screen.getByText('Ирина')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Повторить' }))
    expect(await screen.findByText('В stage пока нет связей')).toBeVisible()
    expect(pilot.listConnections).toHaveBeenCalledTimes(2)
  })

  it('shows an allowlist error without exposing the pilot profile', async () => {
    pilot.exchangeCodeForSession.mockRejectedValue(new Error('Этот аккаунт пока не добавлен в пилот.'))
    window.history.replaceState(null, '', `/auth/yandex/callback${await callbackSearch()}`)

    render(<MemoryRouter><YandexPilotCallbackPage /></MemoryRouter>)

    expect(await screen.findByRole('heading', { name: 'Не удалось войти' })).toBeVisible()
    expect(screen.getByText('Этот аккаунт пока не добавлен в пилот.')).toBeVisible()
    await waitFor(() => expect(window.location.search).toBe(''))
  })
})
