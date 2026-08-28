import { beforeEach, describe, expect, it, vi } from 'vitest'

const queries = vi.hoisted(() => ({ disconnectTrainer: vi.fn() }))
vi.mock('../queries/invitations.queries', () => ({ invitationQueries: queries }))

import { invitationsRepository } from './invitations.repository'

describe('invitationsRepository.disconnectTrainer', () => {
  beforeEach(() => queries.disconnectTrainer.mockReset())

  it('returns the atomic disconnect result', async () => {
    queries.disconnectTrainer.mockResolvedValue({
      data: { clientId: 'client-1', trainerId: 'trainer-1', status: 'disconnected' },
      error: null,
    })

    await expect(invitationsRepository.disconnectTrainer('client-1')).resolves.toEqual({
      clientId: 'client-1', trainerId: 'trainer-1', status: 'disconnected',
    })
    expect(queries.disconnectTrainer).toHaveBeenCalledWith('client-1')
  })

  it('treats an already disconnected relationship as a successful result', async () => {
    queries.disconnectTrainer.mockResolvedValue({
      data: { clientId: 'client-1', status: 'already_disconnected' },
      error: null,
    })

    await expect(invitationsRepository.disconnectTrainer('client-1')).resolves.toEqual({
      clientId: 'client-1', trainerId: null, status: 'already_disconnected',
    })
  })

  it('maps a legacy migration conflict without exposing database details', async () => {
    queries.disconnectTrainer.mockResolvedValue({
      data: null,
      error: { code: 'PT409', message: 'client_requires_safe_migration' },
    })

    await expect(invitationsRepository.disconnectTrainer('client-1')).rejects.toMatchObject({
      code: 'client_requires_safe_migration',
      message: 'Сейчас отключить тренера безопасно не получилось. Ваши данные не изменены. Попробуйте позже или напишите в поддержку.',
    })
  })
})
