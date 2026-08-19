import { beforeEach, describe, expect, it, vi } from 'vitest'
import { yandexPilotRepository } from './yandex-pilot.repository'

const queries = vi.hoisted(() => ({ exchangeCodeForProfile: vi.fn() }))
vi.mock('../queries/yandex-pilot.queries', () => ({ yandexPilotQueries: queries }))

const profile = {
  accessMode: 'read_only',
  profile: {
    id: 'd2b80c5e-f60b-42b0-ae3f-308e91bbcb9b',
    firstName: 'Ирина',
    lastName: null,
    timezone: 'Europe/Moscow',
    accountRole: 'trainer',
  },
}

describe('yandexPilotRepository', () => {
  beforeEach(() => queries.exchangeCodeForProfile.mockReset())

  it('accepts the explicit read-only profile contract', async () => {
    queries.exchangeCodeForProfile.mockResolvedValue(new Response(JSON.stringify(profile), { status: 200 }))
    await expect(yandexPilotRepository.exchangeCodeForProfile('https://stage.example.test', 'code', 'verifier'))
      .resolves.toEqual(profile)
  })

  it('keeps non-allowlisted identities outside the pilot', async () => {
    queries.exchangeCodeForProfile.mockResolvedValue(new Response('{}', { status: 403 }))
    await expect(yandexPilotRepository.exchangeCodeForProfile('https://stage.example.test', 'code', 'verifier'))
      .rejects.toThrow('Этот аккаунт пока не добавлен в пилот')
  })

  it('rejects a malformed success response', async () => {
    queries.exchangeCodeForProfile.mockResolvedValue(new Response(JSON.stringify({ profile: { id: 'raw-yandex-id' } }), { status: 200 }))
    await expect(yandexPilotRepository.exchangeCodeForProfile('https://stage.example.test', 'code', 'verifier'))
      .rejects.toThrow('Stage вернул неподдерживаемый формат профиля')
  })
})
