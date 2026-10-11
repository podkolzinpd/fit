import Fastify, { type FastifyInstance } from 'fastify'
import { Writable } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { registerNutritionRoutes, type NutritionDiary } from './nutrition-routes.js'
import { NutritionCatalogUnavailableError } from './nutrition-catalog.js'
import { NutritionSearchRateLimitError } from './nutrition-diary.js'
import { PilotDomainCommandError } from './domain-commands.js'
import { YandexAppSessionDeniedError, YandexAppSessionInvalidError } from './db/yandex-app-transaction.js'

const apps: FastifyInstance[] = []
const headers = { 'x-fit-session': 'synthetic-session'.repeat(3) }
const id = '10000000-0000-4000-8000-000000000001'
const draft = { id, expectedVersion: 0, day: '2026-10-10', meal: 'lunch', grams: 150,
  food: { kind: 'manual', name: 'Курица с рисом', basis: '100g', calories: 152.2, protein: 9.8, fat: 4.2, carbs: 18.8 } }
afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())) })
function fixture(enabled = true) {
  const diary = {
    day: vi.fn<NutritionDiary['day']>().mockResolvedValue({ access: 'granted', entries: [], lastRecordedDay: null, totals: { calories: 0, protein: 0, fat: 0, carbs: 0 } }),
    recent: vi.fn<NutritionDiary['recent']>().mockResolvedValue({ entries: [] }),
    save: vi.fn<NutritionDiary['save']>(), search: vi.fn<NutritionDiary['search']>(),
    setDeleted: vi.fn<NutritionDiary['setDeleted']>(), consents: vi.fn<NutritionDiary['consents']>(),
    setConsent: vi.fn<NutritionDiary['setConsent']>(),
  }
  const app = Fastify({ logger: false })
  registerNutritionRoutes(app, enabled ? diary : undefined)
  apps.push(app)
  return { app, diary }
}

describe('nutrition HTTP boundary', () => {
  it('logs route templates without food searches, dates, profile IDs, bodies or credentials', async () => {
    let logs = ''
    const stream = new Writable({ write(chunk: Buffer, _encoding, callback) { logs += chunk.toString(); callback() } })
    const app = Fastify({ logger: { stream } })
    registerNutritionRoutes(app, undefined)
    apps.push(app)
    await app.inject({ url: '/v1/nutrition/foods?q=private-food-search&page=2', headers })
    await app.inject({ url: `/v1/clients/${id}/nutrition?day=2026-10-10`, headers })
    await app.inject({ method: 'PUT', url: `/v1/me/nutrition/entries/${id}/visibility`, headers,
      payload: { expectedVersion: 1, deleted: true, privateSentinel: 'private-body' } })
    expect(logs).toContain('/v1/nutrition/foods')
    expect(logs).toContain('/v1/clients/:clientId/nutrition')
    expect(logs).toContain('/v1/me/nutrition/entries/:entryId/visibility')
    for (const sensitive of ['private-food-search', '2026-10-10', id, 'private-body', headers['x-fit-session']]) {
      expect(logs).not.toContain(sensitive)
    }
  })
  it.each([{}, { 'x-fit-pilot-session': 'pilot' }, { ...headers, 'x-fit-pilot-session': 'pilot' }])(
    'rejects missing, read-only or ambiguous credentials before calling the service', async (credentials) => {
      const { app, diary } = fixture()
      const response = await app.inject({ method: 'PUT', url: '/v1/me/nutrition/entries', headers: credentials, payload: draft })
      expect([401, 403]).toContain(response.statusCode)
      expect(response.headers['cache-control']).toBe('no-store')
      expect(diary.save).not.toHaveBeenCalled()
    },
  )
  it('fails closed when the server service is absent', async () => {
    const { app, diary } = fixture(false)
    const response = await app.inject({ method: 'GET', url: '/v1/me/nutrition?day=2026-10-10', headers })
    expect(response.statusCode).toBe(503)
    expect(diary.day).not.toHaveBeenCalled()
  })
  it('uses session authority, not body identity, and does not retry writes', async () => {
    const { app, diary } = fixture()
    diary.save.mockResolvedValue({ entry: { ...draft, name: draft.food.name, basis: '100g', calories: 152.2,
      protein: 9.8, fat: 4.2, carbs: 18.8, totals: { calories: 228.3, protein: 14.7, fat: 6.3, carbs: 28.2 },
      meal: 'lunch', version: 1, updatedAt: '2026-10-10T00:00:00.000Z', deletedAt: null } })
    const response = await app.inject({ method: 'PUT', url: '/v1/me/nutrition/entries', headers,
      payload: { ...draft, ownerId: 'attacker', trainerId: 'attacker' } })
    expect(response.statusCode).toBe(200)
    expect(diary.save).toHaveBeenCalledExactlyOnceWith({ accessMode: 'read_write', token: headers['x-fit-session'] }, draft)
    expect(response.headers['cache-control']).toBe('no-store')
  })
  it.each([
    ['/v1/me/nutrition?day=2026-02-29', 'GET', undefined],
    ['/v1/clients/other/nutrition?day=2026-10-10', 'GET', undefined],
    ['/v1/nutrition/foods?q=a', 'GET', undefined],
    ['/v1/nutrition/foods?q=рис&page=0', 'GET', undefined],
    ['/v1/me/nutrition/entries', 'PUT', { ...draft, grams: 0 }],
    [`/v1/me/nutrition/entries/${id}/visibility`, 'PUT', { expectedVersion: 0, deleted: true }],
    ['/v1/me/nutrition/consents', 'PUT', { clientId: id, trainerId: id, connectionStartedAt: 'old', granted: true }],
  ] as const)('rejects invalid request %s', async (url, method, payload) => {
    const { app, diary } = fixture()
    const response = await app.inject({ method, url, headers, ...(payload === undefined ? {} : { payload }) })
    expect(response.statusCode).toBe(422)
    for (const method of Object.values(diary)) expect(method).not.toHaveBeenCalled()
  })
  it('preserves the trainer locked state without inventing totals', async () => {
    const { app, diary } = fixture()
    diary.day.mockResolvedValue({ access: 'locked', entries: [], totals: null })
    const response = await app.inject({ method: 'GET', url: `/v1/clients/${id}/nutrition?day=2026-10-10`, headers })
    expect(response.json()).toEqual({ access: 'locked', entries: [], totals: null })
    expect(diary.day).toHaveBeenCalledExactlyOnceWith({ accessMode: 'read_write', token: headers['x-fit-session'] }, '2026-10-10', id)
  })
  it.each([
    [new YandexAppSessionInvalidError(), 401, 'unauthorized'],
    [new YandexAppSessionDeniedError(), 403, 'action_not_allowed'],
    [new PilotDomainCommandError('forbidden'), 403, 'nutrition_forbidden'],
    [new PilotDomainCommandError('not_found'), 404, 'nutrition_not_found'],
    [new PilotDomainCommandError('conflict'), 409, 'nutrition_conflict'],
    [new NutritionSearchRateLimitError(), 429, 'nutrition_search_rate_limited'],
    [new NutritionCatalogUnavailableError(), 503, 'nutrition_search_unavailable'],
    [new Error('private SQL, source body, session token'), 503, 'service_unavailable'],
  ])('maps errors safely without leaking details', async (error, status, code) => {
    const { app, diary } = fixture()
    diary.search.mockRejectedValue(error)
    const response = await app.inject({ method: 'GET', url: '/v1/nutrition/foods?q=рис', headers })
    expect(response.statusCode).toBe(status)
    expect(response.json()).toEqual({ error: code })
    expect(response.body).not.toMatch(/private SQL|source body|session token/)
    if (status === 429) expect(response.headers['retry-after']).toBe('1')
  })
})
