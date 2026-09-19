import type { FastifyInstance } from 'fastify'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { buildApp } from './app.js'
import { PilotConnectionCommandError } from './connection-commands.js'
import type { PilotInvitationLinks } from './pilot-invitation-links.js'

const clientId = '52500000-0000-4000-8000-000000000010'
const invitationId = '52500000-0000-4000-8000-000000000020'
const token = `ABCDEF123456.${'a'.repeat(64)}`
const sessionToken = 's'.repeat(43)

const apps: FastifyInstance[] = []

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()))
})

function links(overrides: Partial<PilotInvitationLinks> = {}) {
  const invitationLinks = {
    preview: vi.fn(() => Promise.resolve({
      targetRole: 'trainer' as const,
      inviterName: 'Антон',
      expiresAt: '2026-09-25T12:00:00.000Z',
      status: 'active' as const,
    })),
    create: vi.fn(() => Promise.resolve({
      id: invitationId,
      clientId,
      targetRole: 'trainer' as const,
      code: 'ABCDEF123456',
      token,
      expiresAt: '2026-09-25T12:00:00.000Z',
    })),
    claim: vi.fn(() => Promise.resolve(clientId)),
    ...overrides,
  } satisfies PilotInvitationLinks
  return invitationLinks
}

describe('invitation link API', () => {
  it('previews a bearer link without an account session', async () => {
    const invitationLinks = links()
    const app = buildApp({ pilotInvitationLinks: invitationLinks, logger: false })
    apps.push(app)

    const response = await app.inject({
      method: 'POST',
      url: '/v1/invitation-links/preview',
      payload: { token },
    })

    expect(response.statusCode).toBe(200)
    expect(response.headers['cache-control']).toBe('no-store')
    expect(response.json()).toEqual({ invitation: {
      targetRole: 'trainer',
      inviterName: 'Антон',
      expiresAt: '2026-09-25T12:00:00.000Z',
      status: 'active',
    } })
    expect(invitationLinks.preview).toHaveBeenCalledWith(token)
  })

  it('creates and claims the same protected link through an actor session', async () => {
    const invitationLinks = links()
    const app = buildApp({ pilotInvitationLinks: invitationLinks, logger: false })
    apps.push(app)

    const created = await app.inject({
      method: 'POST',
      url: '/v1/invitation-links',
      headers: { 'x-fit-pilot-session': sessionToken },
      payload: { clientId, targetRole: 'trainer' },
    })
    const claimed = await app.inject({
      method: 'POST',
      url: '/v1/invitation-links/claim',
      headers: { 'x-fit-pilot-session': sessionToken },
      payload: { token },
    })

    expect(created.statusCode).toBe(201)
    expect(created.json()).toMatchObject({ invitation: { id: invitationId, token } })
    expect(claimed.statusCode).toBe(200)
    expect(claimed.json()).toEqual({ clientId })
    expect(invitationLinks.create).toHaveBeenCalledWith(sessionToken, clientId, 'trainer')
    expect(invitationLinks.claim).toHaveBeenCalledWith(sessionToken, token)
  })

  it('rejects malformed tokens before touching the database contract', async () => {
    const invitationLinks = links()
    const app = buildApp({ pilotInvitationLinks: invitationLinks, logger: false })
    apps.push(app)

    const preview = await app.inject({
      method: 'POST', url: '/v1/invitation-links/preview', payload: { token: 'short' },
    })
    const claim = await app.inject({
      method: 'POST', url: '/v1/invitation-links/claim',
      headers: { 'x-fit-pilot-session': sessionToken }, payload: { token: 'short' },
    })

    expect(preview.statusCode).toBe(400)
    expect(claim.statusCode).toBe(400)
    expect(invitationLinks.preview).not.toHaveBeenCalled()
    expect(invitationLinks.claim).not.toHaveBeenCalled()
  })

  it('maps missing previews and domain claim failures without exposing details', async () => {
    const invitationLinks = links({
      preview: vi.fn(() => Promise.resolve(null)),
      claim: vi.fn(() => Promise.reject(new PilotConnectionCommandError('forbidden'))),
    })
    const app = buildApp({ pilotInvitationLinks: invitationLinks, logger: false })
    apps.push(app)

    const preview = await app.inject({
      method: 'POST', url: '/v1/invitation-links/preview', payload: { token },
    })
    const claim = await app.inject({
      method: 'POST', url: '/v1/invitation-links/claim',
      headers: { 'x-fit-pilot-session': sessionToken }, payload: { token },
    })

    expect(preview.statusCode).toBe(404)
    expect(preview.json()).toEqual({ error: 'resource_not_found' })
    expect(claim.statusCode).toBe(403)
    expect(claim.json()).toEqual({ error: 'action_not_allowed' })
  })
})
