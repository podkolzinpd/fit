import { describe, expect, it } from 'vitest'

import { handler } from './yandex-summary-function.js'

describe('production Yandex summary function adapter', () => {
  it('answers CORS preflight without touching Supabase', async () => {
    await expect(handler({ httpMethod: 'OPTIONS', headers: { origin: 'https://fit.example.test' } })).resolves.toEqual({
      statusCode: 204,
      headers: expect.objectContaining({ 'access-control-allow-origin': 'https://fit.example.test' }),
      body: '',
    })
  })

  it('requires the Supabase user JWT in the dedicated browser header', async () => {
    const result = await handler({ httpMethod: 'POST', body: '{}' })
    expect(result.statusCode).toBe(401)
    expect(result.body).toBe('{"error":"authentication_required"}')
  })
})
