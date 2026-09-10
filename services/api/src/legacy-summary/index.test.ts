import { afterEach, describe, expect, it, vi } from 'vitest'

import { buildProgressData, requestYandexSummary, summarizeClientTraining } from './index.js'

const validSummary = {
  trainer: {
    headline: 'За период завершено 2 тренировки.',
    progress: ['Подтверждены результаты двух тренировок.'],
    consistency: 'За период завершено 2 тренировки.',
    attention: [],
  },
  client: {
    headline: 'За период завершено 2 тренировки.',
    achievements: ['Стабильность: подтверждены результаты двух тренировок.'],
    consistency: 'За период завершено 2 тренировки.',
    encouragement: 'Результаты сохранены.',
    goalAlignment: '',
    nextSteps: ['Сохранить текущий ритм.'],
    missingContext: [],
    analysisVersion: 'trainer-summary-v2',
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

describe('summary training picture', () => {
  it('keeps confirmed facts separate from the plan and includes structured client feedback', () => {
    const workouts = [{
      id: 'workout-1', workout_date: '2026-08-20', status: 'done', deleted_at: null,
      session_rpe: 9, wellbeing: 'hard', discomfort: false, client_comment: 'Тренировка далась тяжело',
    }]
    const exercises = [{
      id: 'exercise-1', workout_id: 'workout-1', exercise_ref: 'squat',
      exercise_name: 'Приседания со штангой', input_kind: 'strength', position: 0,
    }]
    const baseSet = {
      workout_exercise_id: 'exercise-1', plan_weight_kg: 80, plan_reps: 8,
      plan_duration_min: null, plan_duration_sec: null, plan_distance_km: null, plan_rpe: 8,
      fact_duration_min: null, fact_duration_sec: null, fact_distance_km: null, fact_rpe: 9,
    }
    const sets = [
      { ...baseSet, position: 0, fact_weight_kg: 80, fact_reps: 8, confirmed_at: '2026-08-20T10:00:00Z' },
      { ...baseSet, position: 1, fact_weight_kg: null, fact_reps: null, confirmed_at: null },
    ]

    const result = buildProgressData(workouts, exercises, sets, '2026-08-01', '2026-08-31', '2026-08-20')

    expect(result.feedback_signals).toEqual([expect.objectContaining({ session_rpe: 9, wellbeing: 'hard' })])
    expect(result.exercises[0]?.sessions[0]).toMatchObject({
      set_count: 1,
      planned_set_count: 2,
      set_completion_percent: 50,
      max_weight_kg: 80,
      planned_max_weight_kg: 80,
      average_rpe: 9,
      sets: [
        { set_position: 0, planned: { weight_kg: 80, reps: 8, rpe: 8 }, performed: { weight_kg: 80, reps: 8, rpe: 9 } },
        { set_position: 1, planned: { weight_kg: 80, reps: 8, rpe: 8 }, performed: null },
      ],
    })
  })
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

  it('does not publish a schema-valid answer that fails the coaching quality gate three times', async () => {
    vi.stubEnv('YANDEX_CLOUD_API_KEY', 'test-key')
    vi.stubEnv('YANDEX_CLOUD_FOLDER_ID', 'test-folder')
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const unsafeSummary = {
      ...validSummary,
      client: {
        ...validSummary.client,
        headline: 'Вес вырос на 25%.',
      },
    }
    const fetchImpl = vi.fn().mockImplementation(() => Promise.resolve(Response.json({
      result: {
        alternatives: [{ message: { text: JSON.stringify(unsafeSummary) } }],
        usage: { totalTokens: '100' },
        modelVersion: 'test',
      },
    })))

    await expect(requestYandexSummary({ change_percent: 25 }, '2026-08-01', '2026-08-25', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      requestId: 'request-quality',
      sleep: () => Promise.resolve(),
    })).rejects.toThrow('yandex_cloud_quality_check_failed')
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })

  it('analyzes a large complete input in non-overlapping chunks before final synthesis', async () => {
    vi.stubEnv('YANDEX_CLOUD_API_KEY', 'test-key')
    vi.stubEnv('YANDEX_CLOUD_FOLDER_ID', 'test-folder')
    const requestBodies: string[] = []
    const fetchImpl = vi.fn((_input: URL | RequestInfo, init?: RequestInit) => {
      if (typeof init?.body !== 'string') throw new Error('Expected a JSON request body')
      requestBodies.push(init.body)
      return Promise.resolve(completionResponse())
    })
    const largeInput = {
      input_coverage: { current: { exercises: 5 }, previous: { exercises: 0 }, complete: true },
      goal: null,
      exercises: Array.from({ length: 5 }, (_, index) => ({
        name: `Упражнение ${index + 1}`,
        sessions: [{ evidence: 'x'.repeat(30_000) }],
      })),
      previous_period: null,
    }

    await requestYandexSummary(largeInput, '2026-08-01', '2026-08-31', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      requestId: 'request-large',
    })

    expect(fetchImpl).toHaveBeenCalledTimes(4)
    const sentInputs = requestBodies.map((requestBody) => {
      const body = JSON.parse(requestBody) as { messages: Array<{ text: string }> }
      return JSON.parse(body.messages[1]!.text) as { completed_workouts: Record<string, unknown> }
    })
    expect(sentInputs.slice(0, 3).every((item) =>
      (item.completed_workouts.input_coverage as { complete: boolean }).complete === false)).toBe(true)
    expect((sentInputs[3]!.completed_workouts.chunk_analyses as unknown[])).toHaveLength(3)
  })
})
