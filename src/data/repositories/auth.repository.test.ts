import { beforeEach, describe, expect, it, vi } from 'vitest'
import { authRepository } from './auth.repository'

const queries = vi.hoisted(() => ({
  getLinkedClient: vi.fn(),
  getTrainer: vi.fn(),
  initializeAccount: vi.fn(),
  getProfile: vi.fn(),
}))

vi.mock('../queries/auth.queries', () => ({
  authQueries: {
    getLinkedClient: queries.getLinkedClient,
    getTrainer: queries.getTrainer,
    initializeAccount: queries.initializeAccount,
    getProfile: queries.getProfile,
  },
}))

describe('authRepository.initialize', () => {
  beforeEach(() => {
    queries.getLinkedClient.mockReset()
    queries.getTrainer.mockReset()
    queries.initializeAccount.mockReset()
    queries.getProfile.mockReset()
  })

  it('resolves a linked client without creating a trainer profile', async () => {
    queries.getLinkedClient.mockResolvedValue({
      data: {
        id: 'client-1',
        trainer_id: 'trainer-1',
        full_name: 'Анна Смирнова',
      },
      error: null,
    })

    const actor = await authRepository.initialize({
      id: 'auth-client-1',
      email: 'client@example.test',
      user_metadata: { role: 'trainer' },
    })

    expect(actor).toEqual({
      kind: 'client',
      role: 'client',
      userId: 'auth-client-1',
      email: 'client@example.test',
      firstName: 'Анна',
      lastName: 'Смирнова',
      timezone: 'Europe/Moscow',
      clientId: 'client-1',
      trainerId: 'trainer-1',
      fullName: 'Анна Смирнова',
    })
    expect(queries.getTrainer).not.toHaveBeenCalled()
    expect(queries.initializeAccount).not.toHaveBeenCalled()
  })

  it('initializes an unlinked account as a trainer', async () => {
    queries.getLinkedClient.mockResolvedValue({ data: null, error: null })
    queries.getTrainer.mockResolvedValue({ data: null, error: null })
    queries.initializeAccount.mockResolvedValue({ data: null, error: null })
    queries.getProfile.mockResolvedValue({
      data: {
        first_name: 'Ирина',
        last_name: null,
        timezone: 'Europe/Moscow',
      },
      error: null,
    })

    const actor = await authRepository.initialize({
      id: 'trainer-1',
      email: 'trainer@example.test',
      user_metadata: { first_name: 'Ирина' },
    })

    expect(actor.kind).toBe('trainer')
    expect(queries.initializeAccount).toHaveBeenCalledWith('trainer', 'Ирина', undefined)
  })
})
