import { afterEach, describe, expect, it, vi } from 'vitest'

import { buildProgressData, requestYandexSummary, summarizeClientTraining } from './index.js'
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
    analysisVersion: 'trainer-summary-v2',
  },
}

const validChunkAnalysis = {
  observations: ['Плечи: рабочий вес вырос с 12 до 16 кг при сопоставимых повторениях.'],
  goal_evidence: [],
  recovery_signals: [],
  data_gaps: [],
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

  it('retries a truncated model answer before parsing it', async () => {
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
    })).resolves.toMatchObject({ modelVersion: 'test' })

    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(warn).toHaveBeenCalledWith('summary structured response retry', expect.objectContaining({
      request_id: 'request-truncated',
      stage: 'direct',
      attempt: 1,
      code: 'yandex_cloud_truncated_response',
      alternative_status: 'ALTERNATIVE_STATUS_TRUNCATED_FINAL',
      output_chars: 11,
      completion_tokens: '80',
    }))
  })

  it('retries a partial model answer before parsing it', async () => {
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
    })).resolves.toMatchObject({ modelVersion: 'test' })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('retries malformed model JSON without logging its contents', async () => {
    vi.stubEnv('YANDEX_CLOUD_API_KEY', 'test-key')
    vi.stubEnv('YANDEX_CLOUD_FOLDER_ID', 'test-folder')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(completionResponse(200, 'private malformed response'))
      .mockResolvedValueOnce(completionResponse())

    await requestYandexSummary({}, '2026-08-01', '2026-08-25', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      requestId: 'request-invalid-json',
      sleep: () => Promise.resolve(),
    })

    expect(fetchImpl).toHaveBeenCalledTimes(2)
    const metadata = warn.mock.calls[0]?.[1] as unknown
    expect(metadata).toEqual(expect.objectContaining({
      code: 'yandex_cloud_invalid_model_json',
      output_chars: 26,
    }))
    expect(JSON.stringify(metadata)).not.toContain('private malformed response')
  })

  it('retries an invalid upstream response envelope', async () => {
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
    })).resolves.toMatchObject({ modelVersion: 'test' })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('retries a schema-invalid model answer', async () => {
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

  it('requests one repair for a stylistic issue and logs only the rule', async () => {
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

    const init = fetchImpl.mock.calls[1]?.[1] as RequestInit
    if (typeof init.body !== 'string') throw new Error('Expected a JSON request body')
    const request = JSON.parse(init.body) as { messages: { role: string; text: string }[] }
    expect(request.messages.at(-2)).toEqual({ role: 'assistant', text: JSON.stringify(rejected) })
    expect(request.messages.at(-1)?.text).toContain('client.headline должен интерпретировать')
    expect(warn).toHaveBeenCalledWith('summary style check requested one repair', expect.objectContaining({
      request_id: 'quality-repair', attempt: 1,
      issues: [expect.stringContaining('client.headline должен интерпретировать')],
    }))
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

    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('does not publish a schema-valid answer with invented technique claims after three attempts', async () => {
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
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })

  it('analyzes a large complete input in non-overlapping chunks before final synthesis', async () => {
    vi.stubEnv('YANDEX_CLOUD_API_KEY', 'test-key')
    vi.stubEnv('YANDEX_CLOUD_FOLDER_ID', 'test-folder')
    const requestBodies: string[] = []
    const fetchImpl = vi.fn((_input: URL | RequestInfo, init?: RequestInit) => {
      if (typeof init?.body !== 'string') throw new Error('Expected a JSON request body')
      requestBodies.push(init.body)
      const request = JSON.parse(init.body) as {
        jsonSchema: { schema: { properties?: Record<string, unknown> } }
      }
      const isChunk = request.jsonSchema.schema.properties?.observations !== undefined
      return Promise.resolve(completionResponse(200, isChunk ? validChunkAnalysis : validSummary))
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

    expect(fetchImpl).toHaveBeenCalledTimes(5)
    const sentInputs = requestBodies.map((requestBody) => {
      const body = JSON.parse(requestBody) as { messages: Array<{ text: string }> }
      return JSON.parse(body.messages[1]!.text) as { completed_workouts: Record<string, unknown> }
    })
    expect(sentInputs.slice(0, 3).every((item) =>
      (item.completed_workouts.input_coverage as { complete: boolean }).complete === false)).toBe(true)
    const chunkAnalyses = sentInputs[3]!.completed_workouts.chunk_analyses as Array<Record<string, unknown>>
    expect(chunkAnalyses).toHaveLength(3)
    expect(chunkAnalyses[0]).toEqual(validChunkAnalysis)
    expect(chunkAnalyses[0]).not.toHaveProperty('client')
    const modelRequests = requestBodies.map((requestBody) => JSON.parse(requestBody) as {
      completionOptions: { maxTokens: string }
    })
    expect(modelRequests.slice(0, 3).map((request) => request.completionOptions.maxTokens)).toEqual(['900', '900', '900'])
    expect(modelRequests.slice(3).map((request) => request.completionOptions.maxTokens)).toEqual(['2000', '2000'])
  })

  it('handles an anonymized 45-workout and 710-set history with one final style repair', async () => {
    vi.stubEnv('YANDEX_CLOUD_API_KEY', 'test-key')
    vi.stubEnv('YANDEX_CLOUD_FOLDER_ID', 'test-folder')
    const sentInputs: Array<{ completed_workouts: Record<string, unknown> }> = []
    let finalRequests = 0
    const volumeSummary = {
      trainer: {
        headline: 'Рабочие показатели дают достаточно материала для следующего решения.',
        progress: ['Основные движения повторялись достаточно регулярно для сопоставления.'],
        consistency: 'Ритм тренировок позволяет сравнивать результаты.',
        attention: [],
      },
      client: {
        headline: 'Основные движения дают достаточно материала для следующего решения.',
        achievements: ['Нагрузка: рабочие подходы повторялись достаточно регулярно для сопоставления.'],
        consistency: 'Ритм тренировок позволяет сравнивать результаты.',
        encouragement: 'Сейчас важнее сохранить сопоставимость основных упражнений.',
        goalAlignment: '',
        nextSteps: ['Сохранить основные движения для следующей контрольной точки.'],
        missingContext: [],
        analysisVersion: 'trainer-summary-v2',
      },
    }
    const fetchImpl = vi.fn((_input: URL | RequestInfo, init?: RequestInit) => {
      if (typeof init?.body !== 'string') throw new Error('Expected a JSON request body')
      const request = JSON.parse(init.body) as {
        jsonSchema: { schema: { properties?: Record<string, unknown> } }
        messages: Array<{ text: string }>
      }
      sentInputs.push(JSON.parse(request.messages[1]!.text) as { completed_workouts: Record<string, unknown> })
      const isChunk = request.jsonSchema.schema.properties?.observations !== undefined
      if (!isChunk) finalRequests += 1
      return Promise.resolve(completionResponse(200, isChunk ? validChunkAnalysis : volumeSummary))
    })
    const exercises = Array.from({ length: 45 }, (_, exerciseIndex) => {
      const setCount = exerciseIndex < 35 ? 16 : 15
      return {
        name: `Упражнение ${exerciseIndex + 1}`,
        sessions: [{
          workout_id: `workout-${exerciseIndex + 1}`,
          evidence: 'обезличенная проверка объёма '.repeat(45),
          sets: Array.from({ length: setCount }, (_, setIndex) => ({
            set_position: setIndex,
            planned: { weight_kg: 40, reps: 10 },
            performed: { weight_kg: 40, reps: 10 },
          })),
        }],
      }
    })
    const largeInput = {
      input_coverage: { current: { workouts: 45, exercises: 45, sets: 710 }, complete: true },
      goal: null,
      exercises,
      previous_period: null,
    }

    await requestYandexSummary(largeInput, '2026-08-01', '2026-08-31', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      requestId: 'request-production-volume',
    })

    const chunkInputs = sentInputs
      .filter((item) => item.completed_workouts.chunk_scope !== undefined)
      .map((item) => item.completed_workouts as { exercises: typeof exercises })
    expect(chunkInputs.length).toBeGreaterThan(1)
    expect(finalRequests).toBe(2)
    expect(chunkInputs.flatMap((item) => item.exercises)).toHaveLength(45)
    expect(chunkInputs.flatMap((item) => item.exercises)
      .reduce((total, exercise) => total + exercise.sessions[0]!.sets.length, 0)).toBe(710)
    expect(sentInputs.at(-1)?.completed_workouts.chunk_analyses).toHaveLength(chunkInputs.length)
  })

  it('keeps a production-sized monthly history complete and uses one bounded style repair', async () => {
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
    const fetchImpl = vi.fn(() => Promise.resolve(completionResponse()))

    await requestYandexSummary(input, '2026-08-11', '2026-09-10', { fetchImpl })

    expect(input.input_coverage).toMatchObject({
      current: { exercises: 28, sessions: 28, sets: 280 },
      previous: { exercises: 14, sessions: 14, sets: 70 },
      complete: true,
    })
    expect(input.exercises).toHaveLength(28)
    expect(input.previous_period?.exercises).toHaveLength(14)
    expect(input.exercises[0]?.sessions[0]).not.toHaveProperty('sets')
    expect(JSON.stringify(input).length).toBeLessThan(80_000)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })
})
