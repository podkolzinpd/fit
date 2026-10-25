import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildApp } from '../app.js'
import { YandexAppSessionDeniedError } from '../db/yandex-app-transaction.js'
import { YandexIdentityUnavailableError } from './yandex-identity.js'
import { YandexOAuthCodeUnavailableError } from './yandex-oauth-code.js'
import { yandexAuthFailureDiagnostics, type YandexAuthStage } from './yandex-auth-diagnostics.js'

type Options = NonNullable<Parameters<typeof buildApp>[0]>
const payload = { code: 'synthetic-private-code', codeVerifier: 'v'.repeat(43) }
const failure = Object.assign(new Error('synthetic-private-sql'), { code: '22023', detail: 'synthetic-private-detail' })
const defaults: Options = {
  logger: false,
  oauthCodeProvider: { exchangeCode: () => Promise.resolve('synthetic-private-token') },
  identityProvider: { verifyAccessToken: () => Promise.resolve({ subjectHash: 'a'.repeat(64), loginHash: 'b'.repeat(64), nutritionLoginHash: 'c'.repeat(64) }) },
  yandexAppSessionIssuer: { issue: () => Promise.reject(failure) },
}

afterEach(() => vi.restoreAllMocks())

describe('Yandex login failure diagnostics', () => {
  // Each case covers a distinct boundary in the actual login sequence, not a UI matrix.
  const cases: { stage: YandexAuthStage; options: Options; code: string; reason?: string; status?: number }[] = [
    { stage: 'configuration', options: {}, code: 'unknown', reason: 'not_configured' },
    { stage: 'oauth_code', options: { oauthCodeProvider: { exchangeCode: () => Promise.reject(new YandexOAuthCodeUnavailableError()) } }, code: 'unknown', reason: 'provider_unavailable' },
    { stage: 'identity', options: { identityProvider: { verifyAccessToken: () => Promise.reject(new YandexIdentityUnavailableError()) } }, code: 'unknown', reason: 'provider_unavailable' },
    { stage: 'identity', options: { identityProvider: { verifyAccessToken: () => Promise.reject(failure) } }, code: '22023', status: 500 },
    { stage: 'trainer_activation', options: { trainerScheduleV2AutoActivator: { activate: () => Promise.reject(failure) } }, code: '22023' },
    { stage: 'lime_activation', options: { fitLimeAutoActivator: { bind: () => Promise.reject(failure) } }, code: '22023' },
    { stage: 'assistant_activation', options: { assistantFeatureLinksAutoActivator: { bind: () => Promise.reject(failure) } }, code: '22023' },
    { stage: 'nutrition_activation', options: { nutritionAutoActivator: { bind: () => Promise.reject(failure) } }, code: '22023' },
    { stage: 'session_issue', options: {}, code: '22023' },
    { stage: 'handoff_issue', options: { yandexOnlyAuthEnabled: true,
      yandexAppSessionIssuer: { issue: () => Promise.reject(new YandexAppSessionDeniedError()) },
      yandexAuthHandoffService: { issue: () => Promise.reject(failure), register: vi.fn() } }, code: '22023' },
  ]
  it.each(cases)('correlates $stage failures without leaking identity, SQL or credentials', async ({ stage, options, code, reason, status = 503 }) => {
    const app = buildApp(stage === 'configuration' ? { logger: false } : { ...defaults, ...options })
    const records: { requestId: string; fields: unknown }[] = []
    app.addHook('onRequest', (request, _reply, done) => {
      for (const level of ['error', 'warn'] as const) {
        vi.spyOn(request.log, level).mockImplementation((fields: unknown) => { records.push({ requestId: request.id, fields }) })
      }
      done()
    })
    try {
      const response = await app.inject({ method: 'POST', url: '/v1/auth/yandex/session', payload })
      expect(response.statusCode).toBe(status)
      if (status === 503) expect(response.json()).toEqual({ error: 'service_unavailable' })
      expect(response.body).not.toContain('synthetic-private')
      const record = records.find(row => row.requestId === response.headers['x-fit-request-id'])
      expect(record?.fields).toMatchObject({
        event: 'yandex_auth_failed', authStage: stage, errorCode: code, authFailure: reason ?? 'unexpected',
      })
      // These spies see fields before Fastify's existing req/res serializers.
      // Check our new diagnostic and the exception forwarded to the 500 handler,
      // not raw in-memory request objects passed to those serializers.
      expect(JSON.stringify(record?.fields)).not.toMatch(/synthetic-private|aaaaaaaa|bbbbbbbb|cccccccc|vvvvvvvv|detail|stack|SELECT/)
      for (const row of records) {
        if (typeof row.fields === 'object' && row.fields !== null && 'err' in row.fields) {
          const error = row.fields.err
          expect(error).not.toBe(failure)
          if (error instanceof Error) {
            expect(error.message).not.toContain('synthetic-private')
            expect(error.cause).toBeUndefined()
          }
        }
      }
    } finally { await app.close() }
  })

  it('keeps the original SQLSTATE after rollback failure and rejects arbitrary error codes', () => {
    expect(yandexAuthFailureDiagnostics('session_issue', new AggregateError([failure, new Error('private-rollback')]))).toMatchObject({ errorCode: '22023' })
    for (const code of ['PRIVATE_TOKEN', 'secret', '42P01\nprivate']) {
      expect(yandexAuthFailureDiagnostics('session_issue', { code })).toMatchObject({ errorCode: 'unknown' })
    }
  })

  it('distinguishes upstream HTTP, network and invalid JSON without logging the response', () => {
    expect(yandexAuthFailureDiagnostics('oauth_code', new YandexOAuthCodeUnavailableError('http', 502)))
      .toMatchObject({ providerFailure: 'http', providerStatus: 502 })
    expect(yandexAuthFailureDiagnostics('identity', new YandexIdentityUnavailableError('network')))
      .toMatchObject({ providerFailure: 'network' })
    expect(yandexAuthFailureDiagnostics('oauth_code', new YandexOAuthCodeUnavailableError('invalid_response')))
      .toMatchObject({ providerFailure: 'invalid_response' })
    expect(yandexAuthFailureDiagnostics('identity', new YandexIdentityUnavailableError('http', NaN)))
      .not.toHaveProperty('providerStatus')
  })
})
