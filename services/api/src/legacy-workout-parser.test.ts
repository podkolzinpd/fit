import { describe, expect, it, vi } from 'vitest'

import { YandexWorkoutParser } from './legacy-workout-parser.js'

function response(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
}

describe('YandexWorkoutParser runtime authorization', () => {
  it('uses an injected IAM token for the native stage parser', async () => {
    const request = vi.fn((input: URL | RequestInfo, init?: RequestInit) => {
      void input
      void init
      return Promise.resolve(response({ result: { alternatives: [{ message: { text: JSON.stringify({
        items: [{ sourceText: 'присед 10 раз', exerciseName: 'Присед', equipment: null, muscle: null, position: 0, sets: [{ reps: 10 }] }],
        unmatched: [],
      }) } }] } }))
    })
    const authorizationHeader = vi.fn(() => Promise.resolve('Bearer metadata-token'))
    const parser = new YandexWorkoutParser(
      { authorizationHeader },
      'folder-id',
      'yandexgpt',
      request,
    )

    await expect(parser.parse({
      text: 'присед 10 раз',
      systemCatalog: [{ source: 'system', ref: 'squat', name: 'Присед', inputKind: 'strength' }],
    })).resolves.toMatchObject({ items: [{ exerciseRef: 'squat', sets: [{ reps: 10 }] }], unmatched: [] })

    expect(authorizationHeader).toHaveBeenCalledOnce()
    const requestInit = request.mock.calls[0]?.[1]
    expect(new Headers(requestInit?.headers).get('authorization')).toBe('Bearer metadata-token')
    const rawBody = requestInit?.body
    expect(typeof rawBody).toBe('string')
    const requestBody = JSON.parse(typeof rawBody === 'string' ? rawBody : '') as { completionOptions: { maxTokens: string }; messages: Array<{ text: string }> }
    expect(requestBody.completionOptions.maxTokens).toBe('1200')
    expect(requestBody.messages[0]?.text).not.toContain('Каталог:')
  })

  it('distinguishes an unavailable model from an invalid model response', async () => {
    const unavailableRequest = vi.fn(() => Promise.resolve(response({}, 503)))
    const unavailable = new YandexWorkoutParser('key', 'folder-id', 'yandexgpt', unavailableRequest)
    await expect(unavailable.parse({ text: 'присед', systemCatalog: [
      { source: 'system', ref: 'squat', name: 'Присед', inputKind: 'strength' },
    ] })).rejects.toMatchObject({ status: 502, code: 'llm_unavailable' })
    expect(unavailableRequest).toHaveBeenCalledOnce()

    const invalidRequest = vi.fn(() => Promise.resolve(response({ result: { alternatives: [{ message: { text: '{}' } }] } })))
    const invalid = new YandexWorkoutParser('key', 'folder-id', 'yandexgpt', invalidRequest)
    await expect(invalid.parse({ text: 'присед', systemCatalog: [
      { source: 'system', ref: 'squat', name: 'Присед', inputKind: 'strength' },
    ] })).rejects.toMatchObject({ status: 502, code: 'parse_failed' })
    expect(invalidRequest).toHaveBeenCalledOnce()
  })

  it('rejects an invented source returned by the model', async () => {
    const request = vi.fn((input: URL | RequestInfo, init?: RequestInit) => {
      void input
      void init
      return Promise.resolve(response({ result: { alternatives: [{ message: { text: JSON.stringify({
      criteria: [{ metric: 'exercise_reps', operation: 'increase_to', targetValue: 10, rangeMin: null, rangeMax: null,
        unit: 'повт.', secondaryTargetValue: null, secondaryUnit: null, exerciseRef: 'invented', customMetricId: null,
        regularityPeriod: null, regularityMode: null }], needsInput: [], unsupportedReason: null,
    }) } }] } }))
    })
    const parser = new YandexWorkoutParser('key', 'folder-id', 'yandexgpt', request)
    await expect(parser.suggest({ text: '10 приседаний', systemCatalog: [
      { source: 'system', ref: 'squat', name: 'Присед', inputKind: 'strength' },
    ] })).rejects.toMatchObject({ status: 502, code: 'parse_failed' })
    expect(request).toHaveBeenCalledTimes(2)
    const rawBody = request.mock.calls[0]?.[1]?.body
    expect(typeof rawBody).toBe('string')
    const requestBody = JSON.parse(typeof rawBody === 'string' ? rawBody : '') as { messages: Array<{ text: string }> }
    expect(requestBody.messages[0]?.text).toContain('не вычисляй прогресс, статус или направление')
  })
})
