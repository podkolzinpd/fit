import { afterEach, describe, expect, it, vi } from 'vitest'
import { recognizeInBody } from './inbody-recognition'

const image = { dataUrl: 'data:image/jpeg;base64,AQID', mimeType: 'image/jpeg' as const, width: 10, height: 20, sizeBytes: 3 }

describe('recognizeInBody', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

  it('forwards the Yandex app session and parses a structured draft', async () => {
    vi.stubEnv('VITE_INBODY_RECOGNITION_URL', 'https://functions.example/inbody')
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      recordedOn: '2026-10-02', weightKg: 59.1, inBody: { schemaVersion: 1, bodyFatPercent: 21 }, recognizedFieldCount: 2, warnings: [],
    }), { status: 200 }))
    vi.stubGlobal('fetch', request)
    await expect(recognizeInBody('session', 'client', image)).resolves.toMatchObject({ weightKg: 59.1, inBody: { bodyFatPercent: 21 } })
    expect(new Headers(request.mock.calls[0]?.[1]?.headers).get('x-fit-session')).toBe('session')
  })

  it('maps an unreadable report to a retryable product error', async () => {
    vi.stubEnv('VITE_INBODY_RECOGNITION_URL', 'https://functions.example/inbody')
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 422 })))
    await expect(recognizeInBody('session', 'client', image)).rejects.toThrow('Сфотографируйте весь лист')
  })
})
