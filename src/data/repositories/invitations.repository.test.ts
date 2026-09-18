import { beforeEach, describe, expect, it, vi } from 'vitest'

const queries = vi.hoisted(() => ({
  claimLink: vi.fn(),
  disconnectTrainer: vi.fn(),
  previewLink: vi.fn(),
  reconnect: vi.fn(),
}))
const yandexQueries = vi.hoisted(() => ({ claim: vi.fn(), preview: vi.fn() }))
vi.mock('../queries/invitations.queries', () => ({ invitationQueries: queries }))
vi.mock('../queries/yandex-invitation-links.queries', () => ({ yandexInvitationLinkQueries: yandexQueries }))

import {
  createYandexInvitationLinksRepository,
  invitationLinksRepository,
  invitationsRepository,
} from './invitations.repository'

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

describe('invitationsRepository.reconnect', () => {
  beforeEach(() => queries.reconnect.mockReset())

  it('normalizes the invitation code and returns the canonical client', async () => {
    queries.reconnect.mockResolvedValue({ data: 'client-1', error: null })

    await expect(invitationsRepository.reconnect(' abcd1234efgh ')).resolves.toBe('client-1')
    expect(queries.reconnect).toHaveBeenCalledWith('ABCD1234EFGH')
  })

  it('maps the explicit disconnect conflict', async () => {
    queries.reconnect.mockResolvedValue({
      data: null,
      error: { code: 'PT409', message: 'trainer_disconnect_required' },
    })

    await expect(invitationsRepository.reconnect('ABCD1234EFGH')).rejects.toMatchObject({
      code: 'trainer_disconnect_required',
      message: 'Сначала отключите текущего тренера в профиле. Ваши тренировки и результаты сохранятся.',
    })
  })
})

describe('invitationLinksRepository', () => {
  beforeEach(() => {
    queries.previewLink.mockReset()
    queries.claimLink.mockReset()
    yandexQueries.preview.mockReset()
    yandexQueries.claim.mockReset()
  })

  it('maps the public Supabase preview and claims only after authentication', async () => {
    queries.previewLink.mockResolvedValue({
      data: [{
        target_role: 'client',
        inviter_name: 'Анастасия',
        expires_at: '2099-09-25T12:00:00.000Z',
        invitation_status: 'active',
      }],
      error: null,
    })
    queries.claimLink.mockResolvedValue({ data: '52500000-0000-4000-8000-000000000010', error: null })

    await expect(invitationLinksRepository.preview('protected-token')).resolves.toMatchObject({
      targetRole: 'client',
      inviterName: 'Анастасия',
      status: 'active',
    })
    await expect(invitationLinksRepository.claim('protected-token')).resolves.toBe(
      '52500000-0000-4000-8000-000000000010',
    )
  })

  it('uses the Yandex public preview without a session and requires a session to claim', async () => {
    yandexQueries.preview.mockResolvedValue(new Response(JSON.stringify({ invitation: {
      targetRole: 'trainer',
      inviterName: 'Антон',
      expiresAt: '2099-09-25T12:00:00.000Z',
      status: 'active',
    } })))
    const publicRepository = createYandexInvitationLinksRepository('https://stage.example.test', null)

    await expect(publicRepository.preview('protected-token')).resolves.toMatchObject({
      targetRole: 'trainer',
      inviterName: 'Антон',
    })
    await expect(publicRepository.claim('protected-token')).rejects.toMatchObject({
      code: 'authentication_required',
    })
    expect(yandexQueries.claim).not.toHaveBeenCalled()
  })

  it('claims a protected link through the Yandex app session', async () => {
    yandexQueries.claim.mockResolvedValue(new Response(JSON.stringify({
      clientId: '52500000-0000-4000-8000-000000000010',
    })))
    const repository = createYandexInvitationLinksRepository(
      'https://stage.example.test',
      's'.repeat(43),
    )

    await expect(repository.claim('protected-token')).resolves.toBe(
      '52500000-0000-4000-8000-000000000010',
    )
    expect(yandexQueries.claim).toHaveBeenCalledWith(
      'https://stage.example.test',
      's'.repeat(43),
      'protected-token',
    )
  })
})
