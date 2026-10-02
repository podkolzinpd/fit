import { afterEach, describe, expect, it, vi } from 'vitest'
import { handler } from './yandex-inbody-recognition-function.js'

const clientId = '00000000-0000-4000-8000-000000000001'
const event = {
  httpMethod: 'POST',
  headers: { 'x-fit-session': 'session' },
  body: JSON.stringify({ clientId, image: { dataUrl: 'data:image/jpeg;base64,AQID', sizeBytes: 3 } }),
}

describe('Yandex InBody recognition function', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

  it('authorizes through Fit API and returns a structured OCR result', async () => {
    vi.stubEnv('FIT_API_BASE_URL', 'https://fit-api.example')
    vi.stubEnv('YANDEX_CLOUD_FOLDER_ID', 'folder')
    vi.stubEnv('YANDEX_CLOUD_API_KEY', 'key')
    const request = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ textAnnotation: { fullText: 'InBody 770\n2026.10.01\nWeight 59.1\nSkeletal Muscle Mass 19.7\nPercent Body Fat 36.8\nBMI 24.0' } }), { status: 200 }))
    vi.stubGlobal('fetch', request)

    const response = await handler(event)
    expect(response.statusCode).toBe(200)
    expect(JSON.parse(response.body)).toMatchObject({ recordedOn: '2026-10-01', weightKg: 59.1, inBody: { skeletalMuscleMassKg: 19.7, bodyFatPercent: 36.8 } })
    expect(request.mock.calls[0]?.[0]).toBe(`https://fit-api.example/v1/clients/${clientId}/progress`)
    expect(new Headers(request.mock.calls[1]?.[1]?.headers).get('x-data-logging-enabled')).toBe('false')
  })

  it('does not call OCR when the actor cannot access the client', async () => {
    vi.stubEnv('FIT_API_BASE_URL', 'https://fit-api.example')
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 403 }))
    vi.stubGlobal('fetch', request)
    const response = await handler(event)
    expect(response.statusCode).toBe(403)
    expect(request).toHaveBeenCalledOnce()
  })

  it('rejects oversized or inconsistent image payloads', async () => {
    const response = await handler({ ...event, body: JSON.stringify({ clientId, image: { dataUrl: 'data:image/jpeg;base64,AQID', sizeBytes: 4 } }) })
    expect(response.statusCode).toBe(400)
  })
})
