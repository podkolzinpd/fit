import { beforeEach, describe, expect, it, vi } from 'vitest'

const previewLink = vi.hoisted(() => vi.fn())
const getYandexMainRoutingConfig = vi.hoisted(() => vi.fn())
const isYandexMainRoutingEnabled = vi.hoisted(() => vi.fn())

vi.mock('./invitations.repository', () => ({ invitationsRepository: { previewLink } }))
vi.mock('../../app/feature-flags', () => ({
  getYandexMainRoutingConfig,
  isYandexMainRoutingEnabled,
}))

import { publicInvitationLinksRepository } from './public-invitation-links.repository'

const token = `ABCDEF123456.${'a'.repeat(64)}`

describe('publicInvitationLinksRepository', () => {
  beforeEach(() => {
    previewLink.mockReset()
    getYandexMainRoutingConfig.mockReset()
    isYandexMainRoutingEnabled.mockReset().mockReturnValue(false)
    vi.unstubAllGlobals()
  })

  it('rejects an unconfigured native API without invoking the retired source', async () => {
    getYandexMainRoutingConfig.mockReturnValue(null)
    await expect(publicInvitationLinksRepository.preview('supabase', token)).rejects.toThrow('Приглашение временно недоступно')
    expect(previewLink).not.toHaveBeenCalled()
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

  it('reads a migrated legacy-source link from Yandex when main routing is enabled', async () => {
    isYandexMainRoutingEnabled.mockReturnValue(true)
    getYandexMainRoutingConfig.mockReturnValue({ apiBaseUrl: 'https://api.fit.test' })
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({ invitation: {
      targetRole: 'client', inviterName: 'Анастасия',
      expiresAt: '2026-09-25T12:00:00.000Z', status: 'active',
    } }), { status: 200 }))))

    await expect(publicInvitationLinksRepository.preview('supabase', token)).resolves.toMatchObject({
      targetRole: 'client', inviterName: 'Анастасия',
    })
    expect(previewLink).not.toHaveBeenCalled()
  })
})
