import { describe, expect, it, vi } from 'vitest'

import { SupabaseWorkoutParser, YandexWorkoutParser } from './legacy-workout-parser.js'
import { SupabaseBridge } from './supabase-bridge.js'

function response(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
}

describe('SupabaseWorkoutParser', () => {
  it('keeps Supabase auth and RLS-scoped custom catalog while executing YandexGPT in the API', async () => {
    const supabaseFetch = vi.fn((input: URL | RequestInfo, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : input instanceof URL ? input.toString() : input
      if (url.endsWith('/auth/v1/user')) {
        expect(init?.headers).toMatchObject({ apikey: 'public-key', authorization: 'Bearer access-token' })
        return Promise.resolve(response({ id: '0ae2d7c4-af24-4d47-9847-851712dc3085' }))
      }
      expect(url).toContain('/rest/v1/custom_exercises?')
      expect(init?.headers).toMatchObject({ apikey: 'public-key', authorization: 'Bearer access-token' })
      return Promise.resolve(response([{ id: '1574a433-8a2a-4cd4-8d8f-57a8ebd6aa77', name: 'Тяга блока', input_kind: 'strength' }]))
    })
    const yandexFetch = vi.fn(() => Promise.resolve(response({ result: { alternatives: [{ message: { text: JSON.stringify({
      items: [{ sourceText: 'тяга блока 3 по 10', exerciseRef: '1574a433-8a2a-4cd4-8d8f-57a8ebd6aa77', confidence: 1.5, sets: [{ weightKg: 40, reps: 10, ignored: 'value' }] }],
      unmatched: [],
    }) } }] } })))
    const parser = new SupabaseWorkoutParser(
      new SupabaseBridge({ url: 'https://supabase.example.test', publishableKey: 'public-key', serviceRoleKey: 'service-key' }, supabaseFetch),
      'yandex-key', 'folder-id', 'yandexgpt', yandexFetch,
    )

    await expect(parser.parse('access-token', {
      text: 'тяга блока 3 по 10',
      systemCatalog: [{ source: 'system', ref: 'squat', name: 'Присед', inputKind: 'strength' }],
    })).resolves.toEqual({
      items: [{ sourceText: 'тяга блока 3 по 10', exerciseRef: '1574a433-8a2a-4cd4-8d8f-57a8ebd6aa77', confidence: 1, sets: [{ weightKg: 40, reps: 10 }] }],
      unmatched: [],
    })
    expect(yandexFetch).toHaveBeenCalledOnce()
  })

  it('does not invoke the model for an invalid Supabase access token', async () => {
    const supabaseFetch = vi.fn((input: URL | RequestInfo) => {
      void input
      return Promise.resolve(response({ message: 'invalid jwt' }, 401))
    })
    const yandexFetch = vi.fn()
    const parser = new SupabaseWorkoutParser(
      new SupabaseBridge({ url: 'https://supabase.example.test', publishableKey: 'public-key', serviceRoleKey: 'service-key' }, supabaseFetch),
      'yandex-key', 'folder-id', 'yandexgpt', yandexFetch,
    )

    await expect(parser.parse('invalid', { text: 'присед', systemCatalog: [] })).rejects.toMatchObject({ status: 401, code: 'unauthorized' })
    expect(yandexFetch).not.toHaveBeenCalled()
  })
})

describe('YandexWorkoutParser runtime authorization', () => {
  it('uses an injected IAM token for the native stage parser', async () => {
    const request = vi.fn((input: URL | RequestInfo, init?: RequestInit) => {
      void input
      void init
      return Promise.resolve(response({ result: { alternatives: [{ message: { text: JSON.stringify({
        items: [{ sourceText: 'присед 10 раз', exerciseRef: 'squat', confidence: 1, sets: [{ reps: 10 }] }],
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

    await parser.parse({
      text: 'присед 10 раз',
      systemCatalog: [{ source: 'system', ref: 'squat', name: 'Присед', inputKind: 'strength' }],
    })

    expect(authorizationHeader).toHaveBeenCalledOnce()
    const requestInit = request.mock.calls[0]?.[1]
    expect(new Headers(requestInit?.headers).get('authorization')).toBe('Bearer metadata-token')
  })
})
