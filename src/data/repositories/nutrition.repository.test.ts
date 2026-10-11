import { afterEach, expect, it, vi } from 'vitest'
import type { SessionActor } from '../../shared/domain'
import { localDate } from '../../shared/local-date'
import type { NutritionConnection, NutritionDraft, NutritionEntry } from '../../shared/nutrition'
import { resetYandexPlatformRequestStateForTests } from '../queries/request-diagnostics'
import { createYandexMainRepository } from './yandex-main.repository'
import { unsupportedNutritionRepository } from './nutrition.repository'

const actor: SessionActor = { kind: 'trainer', role: 'trainer', userId: 'f00d0000-6010-4000-8000-000000000004',
  email: null, firstName: 'Тренер', lastName: null, timezone: 'Europe/Moscow' }
const base = 'https://nutrition-contract.example', clientId = 'f00d0000-6010-4000-8000-000000000001'
const food = { id: 'f00d0000-6010-4000-8000-000000000014', name: 'Курица с рисом', basis: '100g', calories: 152.2, protein: 9.8, fat: 4.2, carbs: 18.8 }
const entry: NutritionEntry = { ...food, basis: '100g', day: '2026-10-10', meal: 'lunch', grams: 150, version: 1,
  totals: { calories: 228.3, protein: 14.7, fat: 6.3, carbs: 28.2 }, updatedAt: '2026-10-10T09:00:00Z', deletedAt: null }
const connection: NutritionConnection = { clientId, trainerId: actor.userId, name: 'Тренер', connectionStartedAt: '2026-10-09T10:00:00Z', granted: false }
const draft: NutritionDraft = { id: entry.id, expectedVersion: 0, day: localDate(entry.day), meal: 'lunch', grams: 150, food: { kind: 'catalog', id: food.id } }
function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'x-fit-request-id': 'nutrition-contract-request' } })
}
function setup(payload: unknown, status = 200) {
  const fetchMock = vi.fn<typeof fetch>().mockImplementation((url) => Promise.resolve(String(url).endsWith('/health')
    ? response({ status: 'ok' }) : response(payload, status)))
  vi.stubGlobal('fetch', fetchMock)
  return { fetchMock, nutrition: createYandexMainRepository(base, 'n'.repeat(43), actor).nutrition }
}
afterEach(() => { vi.unstubAllGlobals(); resetYandexPlatformRequestStateForTests() })

it('maps only food facts, not store links, prices or source identifiers', async () => {
  const { nutrition, fetchMock } = setup({ foods: [{ ...food, sourceId: 120063, url: 'https://store.example', price: 500 }], hasMore: false })
  expect(await nutrition.search('курица с рисом', 2)).toEqual({ foods: [food], hasMore: false })
  expect(String(fetchMock.mock.calls[0]?.[0])).toBe(`${base}/v1/nutrition/foods?q=${encodeURIComponent('курица с рисом')}&page=2`)
})

it('uses separate own and trainer routes and preserves a locked diary without fake totals', async () => {
  const { nutrition, fetchMock } = setup({ access: 'locked', entries: [], totals: null })
  expect(await nutrition.day(localDate(entry.day), clientId)).toEqual({ access: 'locked', entries: [], totals: null })
  expect(fetchMock.mock.calls[0]?.[0]).toBe(`${base}/v1/clients/${clientId}/nutrition?day=${entry.day}`)
  await nutrition.day(localDate(entry.day))
  expect(fetchMock.mock.calls[1]?.[0]).toBe(`${base}/v1/me/nutrition?day=${entry.day}`)
})

it('rejects malformed or contradictory locked responses', async () => {
  const { nutrition } = setup({ access: 'locked', entries: [entry], totals: null })
  await expect(nutrition.day(localDate(entry.day))).rejects.toMatchObject({ code: 'invalid_response' })
})

it('keeps immutable entry snapshots and unknown macros in recent food', async () => {
  const { nutrition } = setup({ entries: [{ ...entry, protein: null, totals: { ...entry.totals, protein: null } }] })
  expect((await nutrition.recent())[0]).toMatchObject({ version: 1, calories: 152.2, protein: null, totals: { protein: null } })
})

it('writes the same operation/version once through the session transport', async () => {
  const { nutrition, fetchMock } = setup({ entry })
  expect(await nutrition.save(draft)).toEqual(entry)
  const writes = fetchMock.mock.calls.filter(([, init]) => init?.method === 'PUT')
  expect(writes).toHaveLength(1)
  expect(writes[0]?.[0]).toBe(`${base}/v1/me/nutrition/entries`)
  expect(JSON.parse(String(writes[0]?.[1]?.body))).toEqual(draft)
  expect(new Headers(writes[0]?.[1]?.headers).get('x-fit-session')).toBe('n'.repeat(43))
})

it('soft delete and undo transmit only selected id, displayed version and desired visibility', async () => {
  const { nutrition, fetchMock } = setup({ entry })
  await nutrition.setDeleted(entry.id, 3, true)
  await nutrition.setDeleted(entry.id, 4, false)
  const writes = fetchMock.mock.calls.filter(([, init]) => init?.method === 'PUT')
  expect(writes.map(([, init]) => JSON.parse(String(init?.body)) as unknown)).toEqual([{ expectedVersion: 3, deleted: true }, { expectedVersion: 4, deleted: false }])
  expect(writes[0]?.[0]).toBe(`${base}/v1/me/nutrition/entries/${entry.id}/visibility`)
})

it('consent transmits the exact active connection, not a global permission', async () => {
  const { nutrition, fetchMock } = setup({ granted: true })
  await nutrition.setConsent(connection, true)
  const write = fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT')
  expect(JSON.parse(String(write?.[1]?.body))).toEqual({ clientId, trainerId: actor.userId, connectionStartedAt: connection.connectionStartedAt, granted: true })
})

it.each([[409, 'conflict', 'PT409'], [403, 'forbidden', 'PT403'], [429, 'rate_limited', 'rate_limited'], [503, 'nutrition_search_unavailable', 'service_unavailable']] as const)(
  'maps safe nutrition error %s without exposing upstream text or retrying writes', async (status, code, mapped) => {
    const { nutrition, fetchMock } = setup({ error: code, message: 'private SQL and store credentials' }, status)
    const error = await nutrition.save(draft).catch((error: unknown) => error)
    expect(error).toMatchObject({ code: mapped })
    expect(String(error)).not.toMatch(/private SQL|store credentials|Yandex Cloud/)
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'PUT')).toHaveLength(1)
  },
)

it('unsupported legacy composition does not become a second nutrition store', async () => {
  await expect(unsupportedNutritionRepository.day(localDate(entry.day))).rejects.toMatchObject({ code: 'nutrition_unavailable' })
  await expect(unsupportedNutritionRepository.save(draft)).rejects.toMatchObject({ code: 'nutrition_unavailable' })
})
