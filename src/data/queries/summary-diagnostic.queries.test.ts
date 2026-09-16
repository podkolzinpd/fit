import { afterEach, expect, it, vi } from 'vitest'

const invokeLegacyCloudFunction = vi.hoisted(() => vi.fn())
vi.mock('./legacy-cloud-functions', () => ({ invokeLegacyCloudFunction }))

import { legacySummaryDiagnosticQuery, summaryDiagnosticQuery } from './summary-diagnostic.queries'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  invokeLegacyCloudFunction.mockReset()
})

it('runs the Supabase diagnostic through the same legacy bridge with no model call', async () => {
  invokeLegacyCloudFunction.mockResolvedValue({
    data: {
      diagnostic: true,
      calls: 0,
      fingerprint: 'fingerprint',
      stats: { workouts: 1, exercises: 2, sets: 3, model_input_chars: 400 },
    },
    error: null,
    response: new Response('{}', { headers: { 'x-fit-request-id': 'request-id' } }),
  })

  await expect(legacySummaryDiagnosticQuery('client-id', '2026-08-16', '2026-09-15')).resolves.toMatchObject({
    diagnostic: true,
    calls: 0,
    ready: true,
    code: 'available',
    request_id: 'request-id',
  })
  expect(invokeLegacyCloudFunction).toHaveBeenCalledWith('summarize-client-training', {
    client_id: 'client-id',
    period_start: '2026-08-16',
    period_end: '2026-09-15',
    force: true,
    trigger_reason: 'manual_refresh',
    diagnostic: 'preflight',
  }, { includeResponse: true })
})

it('uses the production bridge and stops at the no-model preflight', async () => {
  vi.stubGlobal('crypto', { randomUUID: () => '18940d82-9075-48d2-a847-8feee301b4d7' })
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
    diagnostic: true,
    calls: 0,
    ready: true,
    code: 'available',
    fingerprint: 'fingerprint',
    stats: { workouts: 1, exercises: 2, sets: 3, model_input_chars: 400 },
  }), {
    status: 200,
    headers: {
      'x-fit-request-id': '18940d82-9075-48d2-a847-8feee301b4d7',
      'x-fit-release-id': 'release-id',
    },
  }))
  vi.stubGlobal('fetch', fetch)

  await expect(summaryDiagnosticQuery('https://stage.example.test', 'session-token', 'client-id', '2026-08-16', '2026-09-15')).resolves.toMatchObject({
    calls: 0,
    request_id: '18940d82-9075-48d2-a847-8feee301b4d7',
    release_id: 'release-id',
  })
  const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
  expect(url).toBe('https://stage.example.test/v1/clients/client-id/training-summaries/diagnostic')
  expect(JSON.parse(String(init.body))).toEqual({
    client_id: 'client-id',
    period_start: '2026-08-16',
    period_end: '2026-09-15',
    force: true,
    trigger_reason: 'manual_refresh',
  })
  expect(new Headers(init.headers).get('x-fit-request-id')).toBe('18940d82-9075-48d2-a847-8feee301b4d7')
  expect(new Headers(init.headers).get('x-fit-session')).toBe('session-token')
})

it('reports a server status, safe error code, release and trace ID', async () => {
  vi.stubGlobal('crypto', { randomUUID: () => '18940d82-9075-48d2-a847-8feee301b4d7' })
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'service_unavailable' }), {
    status: 503,
    headers: {
      'x-fit-error-code': 'service_unavailable',
      'x-fit-request-id': '18940d82-9075-48d2-a847-8feee301b4d7',
      'x-fit-release-id': 'release-id',
    },
  })))

  await expect(summaryDiagnosticQuery('https://stage.example.test', 'session-token', 'client-id', '2026-08-16', '2026-09-15')).rejects.toThrow(
    'Этап API · HTTP 503 · service_unavailable · release release-id · ID 18940d82-9075-48d2-a847-8feee301b4d7',
  )
})
