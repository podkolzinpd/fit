import { afterEach, describe, expect, it, vi } from 'vitest'
import { diagnosticAllowed, PrivateSummaryDiagnostic } from './private-diagnostic.js'
import { requestYandexSummary, summarizeClientTraining } from './index.js'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals() })

describe('private summary diagnostic', () => {
  it('runs the real collector but never saves either diagnostic response', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-09-11T10:00:00Z'))
    vi.stubEnv('SUPABASE_URL', 'https://supabase.example.test')
    vi.stubEnv('SUPABASE_PUBLISHABLE_KEY', 'test-public')
    vi.stubEnv('YANDEX_CLOUD_API_KEY', 'test-key')
    vi.stubEnv('YANDEX_CLOUD_FOLDER_ID', 'test-folder')
    const actorId = '00000000-0000-4000-8000-000000000002'
    const clientId = '00000000-0000-4000-8000-000000000001'
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const modelCalls: string[] = []
    const writes: string[] = []
    const json = (value: unknown) => Promise.resolve(Response.json(value))
    const fetchMock = vi.fn<typeof fetch>().mockImplementation((request, init) => {
      const url = new URL(typeof request === 'string' ? request : request instanceof URL ? request.href : request.url)
      if (url.hostname === 'llm.api.cloud.yandex.net') {
        modelCalls.push(url.pathname)
        return json({ result: { alternatives: [{ message: { text: 'private answer' }, status: 'ALTERNATIVE_STATUS_FINAL' }] } })
      }
      if (init?.method && init.method !== 'GET' && !url.pathname.endsWith('/rpc/get_client_goal')) writes.push(url.pathname)
      if (url.pathname === '/auth/v1/user') return json({ id: actorId, email: 'test@client-testgmail.com', email_confirmed_at: '2026-01-01' })
      if (url.pathname.endsWith('/clients')) return json({ id: clientId, trainer_id: actorId, auth_user_id: actorId, goal: null })
      if (url.pathname.endsWith('/rpc/get_client_goal')) return json(null)
      if (url.pathname.endsWith('/workouts')) return json(url.searchParams.get('limit') === '1'
        ? { workout_date: '2026-09-01' }
        : [{ id: 'workout-1', workout_date: '2026-09-01', status: 'done', deleted_at: null }])
      return json([])
    })
    vi.stubGlobal('fetch', fetchMock)
    const invoke = (diagnostic: string, diagnostic_fingerprint?: string) => summarizeClientTraining(new Request('https://local.test', {
      method: 'POST', headers: { authorization: 'Bearer test-token' },
      body: JSON.stringify({ client_id: clientId, period_start: '2026-08-12', period_end: '2026-09-11', diagnostic, diagnostic_fingerprint }),
    }))
    const preflight = await invoke('preflight')
    expect(preflight.status).toBe(200)
    const metadata = await preflight.json() as { fingerprint: string }
    expect(modelCalls).toHaveLength(0)
    expect((await invoke('run_once', 'wrong')).status).toBe(409)
    expect(modelCalls).toHaveLength(0)
    const result = await invoke('run_once', metadata.fingerprint)
    expect(result.status).toBe(200)
    expect(await result.json()).toMatchObject({ diagnostic: true, calls: 1, answer: 'private answer' })
    expect(result.headers.get('cache-control')).toBe('no-store')
    expect(modelCalls).toHaveLength(1)
    expect(writes).toEqual([])
    expect(JSON.stringify([...log.mock.calls, ...warn.mock.calls])).not.toContain('private answer')
  })

  it('denies unverified, unrelated and expired identities', () => {
    const approved = { email: 'test@client-testgmail.com', email_confirmed_at: '2026-01-01' }
    expect(diagnosticAllowed(approved, true, Date.parse('2026-09-11T10:00:00Z'))).toBe(true)
    expect(diagnosticAllowed(approved, false, 0)).toBe(false)
    expect(diagnosticAllowed({ email: approved.email }, true, 0)).toBe(false)
    expect(diagnosticAllowed(approved, true, Date.parse('2026-09-13T00:00:00Z'))).toBe(false)
    expect(diagnosticAllowed({}, true, 0)).toBe(false)
    expect(diagnosticAllowed({ email: 'other@example.test', email_confirmed_at: '2026-01-01' }, true, 0)).toBe(false)
    expect(diagnosticAllowed({ email: 'other@example.test', email_confirmed_at: '2026-01-01' }, false, 0)).toBe(false)
    expect(diagnosticAllowed({}, true, Date.parse('2026-09-13T00:00:00Z'))).toBe(false)
  })

  it('returns rejected text privately with one call and no raw logging', async () => {
    vi.stubEnv('YANDEX_CLOUD_API_KEY', 'test-key')
    vi.stubEnv('YANDEX_CLOUD_FOLDER_ID', 'test-folder')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const answer = 'private malformed answer'
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ result: {
      alternatives: [{ message: { text: answer }, status: 'ALTERNATIVE_STATUS_FINAL' }],
      usage: { completionTokens: '3' }, modelVersion: 'test',
    } }))
    let captured: unknown
    try {
      await requestYandexSummary({}, '2026-08-12', '2026-09-11', { diagnostic: true, fetchImpl })
    } catch (error) { captured = error }
    expect(captured).toBeInstanceOf(PrivateSummaryDiagnostic)
    expect((captured as PrivateSummaryDiagnostic).result).toMatchObject({ answer, issues: ['diagnostic_response_parse_failed'] })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(warn).not.toHaveBeenCalled()
    expect(errorLog).not.toHaveBeenCalled()
  })

  it('does not retry a diagnostic network failure or create chunks', async () => {
    vi.stubEnv('YANDEX_CLOUD_API_KEY', 'test-key')
    vi.stubEnv('YANDEX_CLOUD_FOLDER_ID', 'test-folder')
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new Error('network'))
    await expect(requestYandexSummary({}, '2026-08-12', '2026-09-11', { diagnostic: true, fetchImpl })).rejects.toThrow('yandex_cloud_unavailable')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    fetchImpl.mockClear()
    await expect(requestYandexSummary({ text: 'x'.repeat(80001) }, '2026-08-12', '2026-09-11', { diagnostic: true, fetchImpl })).rejects.toThrow('diagnostic_direct_only')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('rejects run without preflight before accessing any backend', async () => {
    const fetchMock = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const result = await summarizeClientTraining(new Request('https://local.test', { method: 'POST', body: JSON.stringify({
      client_id: '00000000-0000-4000-8000-000000000001', period_start: '2026-08-12', period_end: '2026-09-11', diagnostic: 'run_once',
    }) }))
    expect(result.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
