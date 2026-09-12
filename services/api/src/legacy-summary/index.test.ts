import { afterEach, describe, expect, it, vi } from 'vitest'

import { buildProgressData, requestYandexSummary, requestYandexSummaryDeduplicated, summarizeClientTraining } from './index.js'
import { buildSummaryModelInput } from './summary-model-input.js'

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
    analysisVersion: 'trainer-summary-v3',
  },
}

function completionResponse(
  status = 200,
  value: unknown = validSummary,
  alternativeStatus = 'ALTERNATIVE_STATUS_FINAL',
): Response {
  if (status !== 200) return new Response('temporary upstream detail', { status })
  return Response.json({
    result: {
      alternatives: [{ message: { text: typeof value === 'string' ? value : JSON.stringify(value) }, status: alternativeStatus }],
      usage: { completionTokens: '80', totalTokens: '100' },
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
  it('blocks accidental live AI calls from automated tests', async () => {
    vi.stubEnv('NODE_ENV', 'test')
    vi.stubEnv('YANDEX_CLOUD_API_KEY', 'must-not-be-used')
    vi.stubEnv('YANDEX_CLOUD_FOLDER_ID', 'must-not-be-used')

    await expect(requestYandexSummary({}, '2026-08-01', '2026-08-25'))
      .rejects.toThrow('live_ai_disabled_in_tests')
  })

  it('shares one model call between concurrent requests with the same fingerprint', async () => {
    vi.stubEnv('YANDEX_CLOUD_API_KEY', 'test-key')
    vi.stubEnv('YANDEX_CLOUD_FOLDER_ID', 'test-folder')
    const fetchImpl = vi.fn(() => Promise.resolve(completionResponse()))

    const [first, second] = await Promise.all([
      requestYandexSummaryDeduplicated('same-input', {}, '2026-08-01', '2026-08-25', { fetchImpl }),
      requestYandexSummaryDeduplicated('same-input', {}, '2026-08-01', '2026-08-25', { fetchImpl }),
    ])

    expect(fetchImpl).toHaveBeenCalledOnce()
    expect([first.shared, second.shared].sort()).toEqual([false, true])
    expect(first.result.summary).toEqual(second.result.summary)
  })

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

  it('never turns one browser action into a second paid call after a rate limit', async () => {
    vi.stubEnv('YANDEX_CLOUD_API_KEY', 'test-key')
    vi.stubEnv('YANDEX_CLOUD_FOLDER_ID', 'test-folder')
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(completionResponse(429))
      .mockResolvedValueOnce(completionResponse())
    const sleep = vi.fn(() => Promise.resolve())

    await expect(requestYandexSummary({}, '2026-08-01', '2026-08-25', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      requestId: 'request-1',
      sleep,
    })).rejects.toThrow('yandex_cloud_rate_limited')

    expect(fetchImpl).toHaveBeenCalledOnce()
    expect(sleep).not.toHaveBeenCalled()
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

  it('stops after one temporary service failure', async () => {
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
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it('does not repeat a temporary network failure', async () => {
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
    })).rejects.toThrow('yandex_cloud_unavailable')
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it('rejects a truncated model answer without a paid repair call', async () => {
    vi.stubEnv('YANDEX_CLOUD_API_KEY', 'test-key')
    vi.stubEnv('YANDEX_CLOUD_FOLDER_ID', 'test-folder')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(completionResponse(200, '{"trainer":', 'ALTERNATIVE_STATUS_TRUNCATED_FINAL'))
      .mockResolvedValueOnce(completionResponse())

    await expect(requestYandexSummary({}, '2026-08-01', '2026-08-25', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      requestId: 'request-truncated',
      sleep: () => Promise.resolve(),
    })).rejects.toMatchObject({
      message: 'yandex_cloud_truncated_response',
      tokenUsage: { completionTokens: '80', totalTokens: '100' },
    })

    expect(fetchImpl).toHaveBeenCalledOnce()
    expect(warn).not.toHaveBeenCalled()
  })

  it('rejects a partial model answer without a paid repair call', async () => {
    vi.stubEnv('YANDEX_CLOUD_API_KEY', 'test-key')
    vi.stubEnv('YANDEX_CLOUD_FOLDER_ID', 'test-folder')
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(completionResponse(200, '{"trainer":', 'ALTERNATIVE_STATUS_PARTIAL'))
      .mockResolvedValueOnce(completionResponse())

    await expect(requestYandexSummary({}, '2026-08-01', '2026-08-25', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      requestId: 'request-partial',
      sleep: () => Promise.resolve(),
    })).rejects.toThrow('yandex_cloud_truncated_response')
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it('rejects malformed model JSON without retrying or logging its contents', async () => {
    vi.stubEnv('YANDEX_CLOUD_API_KEY', 'test-key')
    vi.stubEnv('YANDEX_CLOUD_FOLDER_ID', 'test-folder')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(completionResponse(200, 'private malformed response'))
      .mockResolvedValueOnce(completionResponse())

    await expect(requestYandexSummary({}, '2026-08-01', '2026-08-25', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      requestId: 'request-invalid-json',
      sleep: () => Promise.resolve(),
    })).rejects.toThrow('yandex_cloud_invalid_model_json')

    expect(fetchImpl).toHaveBeenCalledOnce()
    expect(JSON.stringify(warn.mock.calls)).not.toContain('private malformed response')
  })

  it('rejects an invalid upstream response envelope without retrying', async () => {
    vi.stubEnv('YANDEX_CLOUD_API_KEY', 'test-key')
    vi.stubEnv('YANDEX_CLOUD_FOLDER_ID', 'test-folder')
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response('{', { status: 200, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(completionResponse())

    await expect(requestYandexSummary({}, '2026-08-01', '2026-08-25', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      requestId: 'request-invalid-envelope',
      sleep: () => Promise.resolve(),
    })).rejects.toThrow('yandex_cloud_invalid_upstream_json')
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it('rejects a schema-invalid model answer without retrying', async () => {
    vi.stubEnv('YANDEX_CLOUD_API_KEY', 'test-key')
    vi.stubEnv('YANDEX_CLOUD_FOLDER_ID', 'test-folder')
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(completionResponse(200, { trainer: {}, client: {} }))
      .mockResolvedValueOnce(completionResponse())

    await expect(requestYandexSummary({}, '2026-08-01', '2026-08-25', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      requestId: 'request-invalid-structure',
      sleep: () => Promise.resolve(),
    })).rejects.toThrow('yandex_cloud_invalid_summary')
    expect(fetchImpl).toHaveBeenCalledOnce()
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

  it('accepts a safe stylistic advisory without a paid repair call', async () => {
    vi.stubEnv('YANDEX_CLOUD_API_KEY', 'test-key')
    vi.stubEnv('YANDEX_CLOUD_FOLDER_ID', 'test-folder')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const rejected = { ...validSummary, client: { ...validSummary.client, headline: 'Вес вырос на 25%.' } }
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(completionResponse(200, rejected))
      .mockResolvedValueOnce(completionResponse())

    await expect(requestYandexSummary({ change_percent: 25 }, '2026-08-01', '2026-08-25', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      requestId: 'quality-repair',
      sleep: () => Promise.resolve(),
    })).resolves.toMatchObject({ modelVersion: 'test' })

    expect(fetchImpl).toHaveBeenCalledOnce()
    expect(JSON.stringify(warn.mock.calls)).not.toContain(rejected.client.headline)
  })

  it('accepts a factually safe answer after one unsuccessful style repair', async () => {
    vi.stubEnv('YANDEX_CLOUD_API_KEY', 'test-key')
    vi.stubEnv('YANDEX_CLOUD_FOLDER_ID', 'test-folder')
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const safeButGeneric = {
      ...validSummary,
      client: { ...validSummary.client, encouragement: 'Продолжай в том же духе.' },
    }
    const fetchImpl = vi.fn().mockImplementation(() => Promise.resolve(completionResponse(200, safeButGeneric)))

    await expect(requestYandexSummary({}, '2026-08-01', '2026-08-25', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      requestId: 'style-advisory',
      sleep: () => Promise.resolve(),
    })).resolves.toMatchObject({ summary: safeButGeneric })

    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it('does not publish an unsafe answer and does not spend on a repair', async () => {
    vi.stubEnv('YANDEX_CLOUD_API_KEY', 'test-key')
    vi.stubEnv('YANDEX_CLOUD_FOLDER_ID', 'test-folder')
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const unsafeSummary = {
      ...validSummary,
      client: {
        ...validSummary.client,
        headline: 'В жиме лёжа улучшилась техника выполнения движения.',
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
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it('rejects oversized model input before any paid call', async () => {
    vi.stubEnv('YANDEX_CLOUD_API_KEY', 'test-key')
    vi.stubEnv('YANDEX_CLOUD_FOLDER_ID', 'test-folder')
    const fetchImpl = vi.fn(() => Promise.resolve(completionResponse()))
    const largeInput = {
      input_coverage: { current: { exercises: 5 }, previous: { exercises: 0 }, complete: true },
      goal: null,
      exercises: Array.from({ length: 5 }, (_, index) => ({
        name: `Упражнение ${index + 1}`,
        sessions: [{ evidence: 'x'.repeat(30_000) }],
      })),
      previous_period: null,
    }

    await expect(requestYandexSummary(largeInput, '2026-08-01', '2026-08-31', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      requestId: 'request-large',
    })).rejects.toThrow('summary_model_input_too_large')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('keeps a production-sized monthly history complete within one-call budget', async () => {
    vi.stubEnv('YANDEX_CLOUD_API_KEY', 'test-key')
    vi.stubEnv('YANDEX_CLOUD_FOLDER_ID', 'test-folder')
    const buildExercises = (count: number, setCount: number) => Array.from({ length: count }, (_, exerciseIndex) => ({
      ref: `exercise-${exerciseIndex + 1}`,
      name: `Упражнение ${exerciseIndex + 1}`,
      kind: 'strength',
      session_count: 1,
      sessions: [{
        date: '2026-09-01',
        set_count: setCount,
        planned_set_count: setCount,
        set_completion_percent: 100,
        planned_max_weight_kg: 40,
        max_weight_kg: 40,
        total_reps: setCount * 10,
        volume_kg: setCount * 400,
        sets: Array.from({ length: setCount }, (_, setIndex) => ({
          exercise_position: exerciseIndex,
          set_position: setIndex,
          planned: { weight_kg: 40, reps: 10 },
          performed: { weight_kg: 40, reps: 10 },
        })),
      }],
    }))
    const currentExercises = buildExercises(28, 10)
    const previousExercises = buildExercises(14, 5)
    const input = buildSummaryModelInput({
      period: { start: '2026-08-11', end: '2026-09-10' },
      consistency: { completed_workouts: 13, workouts_per_week: 2.9 },
      goal: null,
      feedback_signals: [],
      measurements: [],
      exercises: currentExercises,
      previous_period: {
        period: { start: '2026-07-11', end: '2026-08-10' },
        consistency: { completed_workouts: 3, workouts_per_week: 0.7 },
        feedback_signals: [],
        measurements: [],
        exercises: previousExercises,
      },
    })
    let requestBody = ''
    const fetchImpl: typeof fetch = vi.fn((_input: URL | RequestInfo, init?: RequestInit) => {
      requestBody = typeof init?.body === 'string' ? init.body : ''
      return Promise.resolve(completionResponse())
    })

    await requestYandexSummary(input, '2026-08-11', '2026-09-10', { fetchImpl })

    expect(input.input_coverage).toMatchObject({
      current: { exercises: 28, sessions: 28, sets: 280 },
      previous: { exercises: 14, sessions: 14, sets: 70 },
      complete: true,
    })
    expect(input.exercises).toHaveLength(28)
    expect(input.evidence_exercise_count).toBeGreaterThan(0)
    expect(input.exercises.some((exercise) => exercise.current?.control_points?.[0]?.sets === 10)).toBe(true)
    expect(input.exercises.flatMap((exercise) => exercise.current?.control_points ?? [])
      .every((point) => !Array.isArray(point?.sets))).toBe(true)
    expect(input.exercises[0]?.previous).not.toBeNull()
    expect(JSON.stringify(input).length).toBeLessThanOrEqual(20_000)
    expect(fetchImpl).toHaveBeenCalledOnce()
    if (!requestBody) throw new Error('Expected a JSON request body')
    const modelRequest = JSON.parse(requestBody) as { completionOptions: { maxTokens: string } }
    expect(modelRequest.completionOptions.maxTokens).toBe('1000')
  })
})
