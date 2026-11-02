import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { YandexAppSessionTransport } from '../yandex-app-session-transport'

const { appSession, getSession, invoke } = vi.hoisted(() => ({
  appSession: vi.fn<() => YandexAppSessionTransport | null>(), getSession: vi.fn(), invoke: vi.fn(),
}))
vi.mock('./client', () => ({ supabase: { auth: { getSession }, functions: { invoke } } }))
vi.mock('../yandex-app-session-transport', () => ({ yandexAppSessionTransport: appSession }))
import { parseWorkout, suggestGoalCriteria } from './workout-ai.queries'

const native = { apiBaseUrl: 'http://127.0.0.1:4100', sessionToken: 's'.repeat(43), accessMode: 'read_write' as const }
beforeEach(() => {
  vi.clearAllMocks()
  appSession.mockReturnValue(native)
  vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockImplementation(input => Promise.resolve(String(input).endsWith('/health')
    ? new Response('{}', { headers: { 'x-fit-request-id': 'fixture-health' } })
    : Response.json({ reply: 'Ответ', action: null, items: [], unmatched: [], criteria: [], needsInput: [], unsupportedReason: null }))))
})
afterEach(() => vi.unstubAllGlobals())

it('requires a native session for every AI operation without Supabase or HTTP fallback', async () => {
  appSession.mockReturnValue(null)
  expect((await parseWorkout('присед', [])).error).toEqual(new Error('authentication_required'))
  expect((await suggestGoalCriteria('цель', [], [])).error).toEqual(new Error('authentication_required'))
  expect(fetch).not.toHaveBeenCalled()
  expect(getSession).not.toHaveBeenCalled()
  expect(invoke).not.toHaveBeenCalled()
})

it.each(['parser', 'goal'] as const)('preserves native %s request and response', async kind => {
  if (kind === 'parser') expect((await parseWorkout('присед', [])).data).toMatchObject({ items: [], unmatched: [] })
  else expect((await suggestGoalCriteria('цель', [], [])).data).toMatchObject({ criteria: [], needsInput: [] })
  const requests = vi.mocked(fetch).mock.calls.filter(([url]) => !String(url).endsWith('/health'))
  expect(requests).toHaveLength(1)
  const [url, init] = requests[0]!
  expect(url).toBe(native.apiBaseUrl + '/v1/assistant/yandex/parse-workout')
  expect(new Headers(init?.headers).get('x-fit-session')).toBe(native.sessionToken)
  expect(new Headers(init?.headers).has('x-supabase-authorization')).toBe(false)
  expect(init?.body).toBe(JSON.stringify(kind === 'parser' ? { text: 'присед', systemCatalog: [] } : { kind: 'goal_criteria', text: 'цель', systemCatalog: [], customMetrics: [] }))
  expect(getSession).not.toHaveBeenCalled()
  expect(invoke).not.toHaveBeenCalled()
})
