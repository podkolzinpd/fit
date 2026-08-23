import { describe, expect, it } from 'vitest'

import { summarizeClientTraining } from './index.js'

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
})
