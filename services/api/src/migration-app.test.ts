import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  YandexIdentityRejectedError,
  YandexIdentityUnavailableError,
  type YandexIdentityProvider,
} from './auth/yandex-identity.js'
import {
  PilotEnrollmentConflictError,
  type PilotEnroller,
} from './db/yandex-pilot-enrollment.js'
import { buildMigrationApp } from './migration-app.js'

const apps: ReturnType<typeof buildMigrationApp>[] = []

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()))
})

describe('migration endpoint', () => {
  it('reports the migration names returned by the locked runner', async () => {
    const runMigrations = vi.fn().mockResolvedValue(['000003_client_memberships'])
    const app = buildMigrationApp({ logger: false, runMigrations })
    apps.push(app)

    const response = await app.inject({ method: 'POST', url: '/migrate' })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      status: 'migrated',
      migrations: ['000003_client_memberships'],
    })
    expect(runMigrations).toHaveBeenCalledOnce()
  })

  it('does not expose migration or connection errors', async () => {
    const runMigrations = vi
      .fn()
      .mockRejectedValue(new Error('postgresql://owner:secret@database'))
    const app = buildMigrationApp({ logger: false, runMigrations })
    apps.push(app)

    const response = await app.inject({ method: 'POST', url: '/migrate' })

    expect(response.statusCode).toBe(500)
    expect(response.json()).toEqual({ status: 'migration_failed' })
    expect(response.body).not.toContain('secret')
  })
})

describe('stage Yandex ID pilot enrollment', () => {
  const subjectHash = 'd'.repeat(64)

  function buildPilot(overrides: {
    enroll?: PilotEnroller['enroll']
    verifyAccessToken?: YandexIdentityProvider['verifyAccessToken']
  } = {}) {
    const verifyAccessToken = vi.fn(
      overrides.verifyAccessToken
      ?? (() => Promise.resolve({ subjectHash })),
    )
    const enroll = vi.fn(
      overrides.enroll ?? (() => Promise.resolve({ created: true })),
    )
    const app = buildMigrationApp({
      logger: false,
      pilotEnrollment: {
        enroller: { enroll },
        identityProvider: { verifyAccessToken },
      },
      runMigrations: () => Promise.resolve([]),
    })
    apps.push(app)
    return { app, enroll, verifyAccessToken }
  }

  it('does not register the enrollment route unless explicitly enabled', async () => {
    const app = buildMigrationApp({
      logger: false,
      runMigrations: () => Promise.resolve([]),
    })
    apps.push(app)

    const response = await app.inject({
      method: 'POST',
      url: '/pilot/enroll',
      payload: { accessToken: 'test-token', accountRole: 'trainer' },
    })

    expect(response.statusCode).toBe(404)
  })

  it('validates identity and creates a read-only rollout assignment', async () => {
    const { app, enroll, verifyAccessToken } = buildPilot()

    const response = await app.inject({
      method: 'POST',
      url: '/pilot/enroll',
      payload: { accessToken: 'test-token', accountRole: 'trainer' },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      status: 'enrolled',
      accessMode: 'read_only',
      created: true,
    })
    expect(verifyAccessToken).toHaveBeenCalledWith('test-token')
    expect(enroll).toHaveBeenCalledWith(subjectHash, 'trainer')
    expect(response.body).not.toContain('test-token')
    expect(response.body).not.toContain(subjectHash)
  })

  it('rejects malformed requests before calling identity services', async () => {
    const { app, enroll, verifyAccessToken } = buildPilot()

    const response = await app.inject({
      method: 'POST',
      url: '/pilot/enroll',
      payload: { accessToken: '', accountRole: 'owner' },
    })

    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({ status: 'invalid_request' })
    expect(verifyAccessToken).not.toHaveBeenCalled()
    expect(enroll).not.toHaveBeenCalled()
  })

  it('returns generic errors for rejected or unavailable identities', async () => {
    for (const [error, expectedStatus, expectedBody] of [
      [new YandexIdentityRejectedError(), 401, 'identity_rejected'],
      [new YandexIdentityUnavailableError(), 503, 'enrollment_unavailable'],
    ] as const) {
      const { app } = buildPilot({
        verifyAccessToken: () => Promise.reject(error),
      })
      const response = await app.inject({
        method: 'POST',
        url: '/pilot/enroll',
        payload: { accessToken: 'secret-token', accountRole: 'client' },
      })

      expect(response.statusCode).toBe(expectedStatus)
      expect(response.json()).toEqual({ status: expectedBody })
      expect(response.body).not.toContain('secret-token')
    }
  })

  it('does not change the role of an existing identity', async () => {
    const { app } = buildPilot({
      enroll: () => Promise.reject(new PilotEnrollmentConflictError()),
    })

    const response = await app.inject({
      method: 'POST',
      url: '/pilot/enroll',
      payload: { accessToken: 'test-token', accountRole: 'client' },
    })

    expect(response.statusCode).toBe(409)
    expect(response.json()).toEqual({ status: 'account_role_conflict' })
  })

  it('does not expose unexpected enrollment errors', async () => {
    const { app } = buildPilot({
      enroll: () => Promise.reject(new Error('database-password=secret')),
    })

    const response = await app.inject({
      method: 'POST',
      url: '/pilot/enroll',
      payload: { accessToken: 'test-token', accountRole: 'trainer' },
    })

    expect(response.statusCode).toBe(500)
    expect(response.json()).toEqual({ status: 'enrollment_failed' })
    expect(response.body).not.toContain('secret')
  })
})
