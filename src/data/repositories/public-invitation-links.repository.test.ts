import { beforeEach, describe, expect, it, vi } from 'vitest'

const previewLink = vi.hoisted(() => vi.fn())
const getYandexMainRoutingConfig = vi.hoisted(() => vi.fn())

vi.mock('./invitations.repository', () => ({ invitationsRepository: { previewLink } }))
vi.mock('../../app/feature-flags', () => ({ getYandexMainRoutingConfig }))

import { publicInvitationLinksRepository } from './public-invitation-links.repository'

const token = `ABCDEF123456.${'a'.repeat(64)}`

describe('publicInvitationLinksRepository', () => {
  beforeEach(() => {
    previewLink.mockReset()
    getYandexMainRoutingConfig.mockReset()
    vi.unstubAllGlobals()
  })

  it('reads a Supabase invitation only from its explicit source', async () => {
    previewLink.mockResolvedValue({ targetRole: 'trainer', inviterName: 'Антон' })

    await expect(publicInvitationLinksRepository.preview('supabase', token)).resolves.toMatchObject({
      targetRole: 'trainer', inviterName: 'Антон',
    })
    expect(previewLink).toHaveBeenCalledWith(token)
    expect(getYandexMainRoutingConfig).not.toHaveBeenCalled()
  })

  it('uses the public Yandex endpoint and does not fall back to another backend', async () => {
    getYandexMainRoutingConfig.mockReturnValue({ apiBaseUrl: 'https://api.fit.test' })
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({ invitation: {
      targetRole: 'client', inviterName: 'Анастасия',
      expiresAt: '2026-09-25T12:00:00.000Z', status: 'active',
    } }), { status: 200 }))))

    await expect(publicInvitationLinksRepository.preview('yandex', token)).resolves.toMatchObject({
      targetRole: 'client', inviterName: 'Анастасия',
    })
    expect(previewLink).not.toHaveBeenCalled()
  })

  it('returns a missing Yandex invitation without querying Supabase', async () => {
    getYandexMainRoutingConfig.mockReturnValue({ apiBaseUrl: 'https://api.fit.test' })
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(null, { status: 404 }))))

    await expect(publicInvitationLinksRepository.preview('yandex', token)).resolves.toBeNull()
    expect(previewLink).not.toHaveBeenCalled()
  })
})
