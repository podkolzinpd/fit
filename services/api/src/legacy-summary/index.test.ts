import { afterEach, describe, expect, it, vi } from 'vitest'

import { requestYandexSummary, summarizeClientTraining } from './index.js'

const validSummary = {
  trainer: {
    headline: 'За период завершено 2 тренировки.',
    progress: ['Подтверждены результаты двух тренировок.'],
    consistency: 'За период завершено 2 тренировки.',
    attention: [],
  },
  client: {
    headline: 'За период завершено 2 тренировки.',
    achievements: ['Подтверждены результаты двух тренировок.'],
    consistency: 'За период завершено 2 тренировки.',
    encouragement: 'Результаты сохранены.',
    goalAlignment: '',
    nextSteps: ['Сохранить текущий ритм.'],
  },
}

function completionResponse(status = 200): Response {
  if (status !== 200) return new Response('temporary upstream detail', { status })
  return Response.json({
    result: {
      alternatives: [{ message: { text: JSON.stringify(validSummary) } }],
      usage: { totalTokens: '100' },
      modelVersion: 'test',
    },
  })
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe('summarizeClientTraining cloud handler', () => {
  it('runs in Node and retains the Edge Function request contract before contacting Supabase', async () => {
    const response = await summarizeClientTraining(new Request('https://api.example.test/v1/legacy/summarize-client-training', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    }))

    expect(response.status).toBe(400)
    expect(response.headers.get('x-fit-error-code')).toBe('invalid_client_id')
    await expect(response.json()).resolves.toEqual({ error: 'invalid_client_id' })
  })

  it('retains the method guard', async () => {
    const response = await summarizeClientTraining(new Request('https://api.example.test/v1/legacy/summarize-client-training'))

    expect(response.status).toBe(405)
    expect(response.headers.get('allow')).toBe('POST')
  })

  it('retries a temporary rate limit and returns the next valid analysis', async () => {
    vi.stubEnv('YANDEX_CLOUD_API_KEY', 'test-key')
    vi.stubEnv('YANDEX_CLOUD_FOLDER_ID', 'test-folder')
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(completionResponse(429))
      .mockResolvedValueOnce(completionResponse())
    const sleep = vi.fn(() => Promise.resolve())

    const result = await requestYandexSummary({}, '2026-08-01', '2026-08-25', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      requestId: 'request-1',
      sleep,
    })

    expect(result.summary.client.headline).toBe(validSummary.client.headline)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(sleep).toHaveBeenCalledOnce()
  })

  it('uses an injected runtime IAM token without requiring a static API key', async () => {
    vi.stubEnv('YANDEX_CLOUD_FOLDER_ID', 'test-folder')
    const fetchImpl = vi.fn((input: URL | RequestInfo, init?: RequestInit) => {
      void input
      void init
      return Promise.resolve(completionResponse())
    })
    const authorizationHeader = vi.fn(() => Promise.resolve('Bearer metadata-token'))

    await requestYandexSummary({}, '2026-08-01', '2026-08-25', {
      authorization: { authorizationHeader },
      fetchImpl,
    })

    expect(authorizationHeader).toHaveBeenCalledOnce()
    const requestInit = fetchImpl.mock.calls[0]?.[1]
    expect(new Headers(requestInit?.headers).get('Authorization')).toBe('Bearer metadata-token')
  })

  it('stops after three temporary service failures', async () => {
    vi.stubEnv('YANDEX_CLOUD_API_KEY', 'test-key')
    vi.stubEnv('YANDEX_CLOUD_FOLDER_ID', 'test-folder')
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const fetchImpl = vi.fn().mockImplementation(() =>
      Promise.resolve(completionResponse(503)))

    await expect(requestYandexSummary({}, '2026-08-01', '2026-08-25', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      requestId: 'request-2',
      sleep: () => Promise.resolve(),
    })).rejects.toThrow('yandex_cloud_unavailable')
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })

  it('recovers from a temporary network failure', async () => {
    vi.stubEnv('YANDEX_CLOUD_API_KEY', 'test-key')
    vi.stubEnv('YANDEX_CLOUD_FOLDER_ID', 'test-folder')
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const fetchImpl = vi.fn()
      .mockRejectedValueOnce(new Error('socket closed'))
      .mockResolvedValueOnce(completionResponse())

    await expect(requestYandexSummary({}, '2026-08-01', '2026-08-25', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      requestId: 'request-network',
      sleep: () => Promise.resolve(),
    })).resolves.toMatchObject({ modelVersion: 'test' })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('does not repeat a rejected request that cannot recover by retrying', async () => {
    vi.stubEnv('YANDEX_CLOUD_API_KEY', 'test-key')
    vi.stubEnv('YANDEX_CLOUD_FOLDER_ID', 'test-folder')
    const fetchImpl = vi.fn().mockResolvedValue(completionResponse(400))

    await expect(requestYandexSummary({}, '2026-08-01', '2026-08-25', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      requestId: 'request-3',
      sleep: () => Promise.resolve(),
    })).rejects.toThrow('yandex_cloud_request_rejected')
    expect(fetchImpl).toHaveBeenCalledOnce()
  })
})
