import { describe, expect, it } from 'vitest'

import { handler } from './yandex-workout-parser-function.js'

describe('production Yandex workout parser adapter', () => {
  it('answers CORS preflight without touching Supabase', async () => {
    const result = await handler({ httpMethod: 'OPTIONS', headers: { origin: 'https://fit.example.test' } })

    expect(result.statusCode).toBe(204)
    expect(result.headers).toMatchObject({ 'access-control-allow-origin': 'https://fit.example.test' })
    expect(result.body).toBe('')
  })

  it('requires the Supabase user JWT in the dedicated browser header', async () => {
    const result = await handler({ httpMethod: 'POST', body: '{}' })

    expect(result.statusCode).toBe(401)
    expect(result.body).toBe('{"error":"unauthorized"}')
  })
})
