import { beforeEach, describe, expect, it, vi } from 'vitest'

import { yandexPilotRepository } from './yandex-pilot.repository'

const queries = vi.hoisted(() => ({
  exchangeCodeForSession: vi.fn(),
  listClients: vi.fn(),
}))
vi.mock('../queries/yandex-pilot.queries', () => ({ yandexPilotQueries: queries }))

const session = {
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
}

const clients = {
  accessMode: 'read_only',
  clients: [{
    id: '6e577cc7-3b56-4a86-bc85-1ce2426ce249',
    hasAccount: false,
    fullName: 'Анна Смирнова',
    canonicalFullName: 'Анна Смирнова',
    gender: 'female',
    ageYears: 31,
    ageUpdatedAt: '2026-08-20',
    heightCm: 168,
    goal: null,
    note: null,
    currentWeightKg: null,
    lastActivityAt: '2026-08-20T12:00:00.000Z',
    archivedAt: null,
    version: 1,
    membershipVersion: 1,
  }],
}

describe('yandexPilotRepository', () => {
  beforeEach(() => {
    queries.exchangeCodeForSession.mockReset()
    queries.listClients.mockReset()
  })

  it('accepts the explicit read-only session contract', async () => {
    queries.exchangeCodeForSession.mockResolvedValue(
      new Response(JSON.stringify(session), { status: 200 }),
    )

    await expect(yandexPilotRepository.exchangeCodeForSession(
      'https://stage.example.test',
      'code',
      'verifier',
    )).resolves.toEqual(session)
  })

  it('keeps non-allowlisted identities outside the pilot', async () => {
    queries.exchangeCodeForSession.mockResolvedValue(new Response('{}', { status: 403 }))

    await expect(yandexPilotRepository.exchangeCodeForSession(
      'https://stage.example.test',
      'code',
      'verifier',
    )).rejects.toThrow('Этот аккаунт пока не добавлен в пилот')
  })

  it('rejects a malformed session response', async () => {
    queries.exchangeCodeForSession.mockResolvedValue(new Response(JSON.stringify({
      profile: { id: 'raw-yandex-id' },
      session: { token: 'raw-yandex-token' },
    }), { status: 200 }))

    await expect(yandexPilotRepository.exchangeCodeForSession(
      'https://stage.example.test',
      'code',
      'verifier',
    )).rejects.toThrow('Stage вернул неподдерживаемый формат сессии')
  })

  it('reads clients with the app session and validates the domain shape', async () => {
    queries.listClients.mockResolvedValue(
      new Response(JSON.stringify(clients), { status: 200 }),
    )

    await expect(yandexPilotRepository.listClients(
      'https://stage.example.test',
      's'.repeat(43),
    )).resolves.toEqual(clients.clients)
    expect(queries.listClients).toHaveBeenCalledWith(
      'https://stage.example.test',
      's'.repeat(43),
    )
  })

  it('rejects an invalid client response instead of rendering partial data', async () => {
    queries.listClients.mockResolvedValue(new Response(JSON.stringify({
      accessMode: 'read_only',
      clients: [{ id: 'not-a-uuid' }],
    }), { status: 200 }))

    await expect(yandexPilotRepository.listClients(
      'https://stage.example.test',
      's'.repeat(43),
    )).rejects.toThrow('Stage вернул неподдерживаемый формат клиентов.')
  })
})
