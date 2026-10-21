import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { YandexAppSessionTransport } from '../yandex-app-session-transport'

const { getSession, appSession } = vi.hoisted(() => ({
  getSession: vi.fn(),
  appSession: vi.fn<() => YandexAppSessionTransport | null>(),
}))
vi.mock('./client', () => ({ supabase: { auth: { getSession } } }))
vi.mock('../yandex-app-session-transport', () => ({ yandexAppSessionTransport: appSession }))

const generate = async () => {
  const { trainingSummaryQueries } = await import('./training-summaries.queries')
  return trainingSummaryQueries.generate('client-1', '2026-08-01', '2026-08-20', false, 'manual_refresh')
}

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  appSession.mockReturnValue(null)
  getSession.mockResolvedValue({ data: { session: { access_token: 'legacy-token' } } })
  vi.stubEnv('VITE_YANDEX_LEGACY_FUNCTIONS_API_BASE_URL', '')
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ cached: true }))))
})
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

it('closes an explicit retired AI override without HTTP, token refresh or Cloud Function fallback', async () => {
  vi.stubEnv('VITE_YANDEX_LEGACY_FUNCTIONS_API_BASE_URL', 'https://retired.example.test')
  const result = await generate()
  expect(result.data).toBeNull()
  expect(result.error).toBeInstanceOf(Error)
  expect(fetch).not.toHaveBeenCalled()
  expect(getSession).not.toHaveBeenCalled()
})

it.each([200, 503])('preserves native summary HTTP %s despite a stale legacy override', async status => {
  vi.stubEnv('VITE_YANDEX_LEGACY_FUNCTIONS_API_BASE_URL', 'https://retired.example.test')
  appSession.mockReturnValue({ apiBaseUrl: 'https://native.example.test', sessionToken: 's'.repeat(43), accessMode: 'read_write' })
  const response = new Response(JSON.stringify({ cached: true }), { status })
  vi.mocked(fetch).mockImplementation(input => Promise.resolve(String(input).endsWith('/health')
    ? new Response('{}', { headers: { 'x-fit-request-id': 'synthetic-health' } }) : response))
  const result = await generate()
  expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).endsWith('/training-summaries/generate'))).toHaveLength(1)
  expect(vi.mocked(fetch).mock.calls.every(([url]) => String(url).startsWith('https://native.example.test/'))).toBe(true)
  const request = vi.mocked(fetch).mock.calls.find(([url]) => String(url).endsWith('/training-summaries/generate'))
  expect(request?.[0]).toBe('https://native.example.test/v1/clients/client-1/training-summaries/generate')
  expect(request?.[1]?.method).toBe('POST')
  expect(new Headers(request?.[1]?.headers).get('x-fit-session')).toBe('s'.repeat(43))
  expect(request?.[1]?.body).toBe(JSON.stringify({ client_id: 'client-1', period_start: '2026-08-01', period_end: '2026-08-20', force: false, trigger_reason: 'manual_refresh' }))
  if (status === 200) expect(result).toEqual({ data: { cached: true }, error: null })
  else expect(result).toEqual({ data: null, error: { context: response } })
})

it('rejects an absent native session without a remote fallback', async () => {
  const result = await generate()
  expect(result.data).toBeNull()
  expect(result.error).toEqual(new Error('authentication_required'))
  expect(fetch).not.toHaveBeenCalled()
})
