import { afterEach, describe, expect, it, vi } from 'vitest'
import { programModelAuthorization, programModelJson } from './assistant-orchestrator/program/model.js'

describe('Assistant model authorization from Cloud.ru', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

  function cloudru() {
    vi.stubEnv('FIT_MEDIA_STORAGE_PROVIDER', 'cloudru')
    vi.stubEnv('YANDEX_CLOUD_API_KEY', 'synthetic-model-key')
    vi.stubEnv('YANDEX_CLOUD_USE_METADATA_IAM_TOKEN', 'false')
    vi.stubEnv('YANDEX_CLOUD_FOLDER_ID', 'synthetic-folder')
    vi.stubEnv('YANDEX_CLOUD_MODEL_ID', 'yandexgpt')
    vi.stubEnv('YANDEX_LLM_FUNCTION_URL', '')
  }

  it('calls the existing external model with an API key and no VM metadata dependency', async () => {
    cloudru()
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ result: {
      alternatives: [{ message: { text: '{"ok":true}' }, status: 'ALTERNATIVE_STATUS_FINAL' }],
      usage: { inputTextTokens: '1', completionTokens: '1' },
    } }), { status: 200 }))
    vi.stubGlobal('fetch', request)
    expect(await programModelJson({ instruction: 'Synthetic test', data: { synthetic: true },
      schema: { type: 'object' }, maxTokens: 10, functionName: 'test', operationId: 'test' })).toEqual({ ok: true })
    expect(request).toHaveBeenCalledTimes(1)
    expect(request.mock.calls[0]?.[0]).toBe('https://llm.api.cloud.yandex.net/foundationModels/v1/completion')
    expect(new Headers(request.mock.calls[0]?.[1]?.headers).get('authorization')).toBe('Api-Key synthetic-model-key')
    const rawBody = request.mock.calls[0]?.[1]?.body
    if (typeof rawBody !== 'string') throw new Error('Expected JSON request body')
    const body: unknown = JSON.parse(rawBody)
    expect(body).toMatchObject({ modelUri: 'gpt://synthetic-folder/yandexgpt/latest',
      completionOptions: { temperature: 0.1, stream: false, maxTokens: '10' } })
  })

  it('rejects missing Cloud.ru credentials before attempting VM metadata or a model request', async () => {
    cloudru()
    vi.stubEnv('YANDEX_CLOUD_API_KEY', '')
    const request = vi.fn()
    vi.stubGlobal('fetch', request)
    await expect(programModelAuthorization()).rejects.toThrow('program_auth_unavailable')
    expect(request).not.toHaveBeenCalled()
  })

  it('preserves IAM authorization in the original Yandex runtime', async () => {
    vi.stubEnv('FIT_MEDIA_STORAGE_PROVIDER', 'yandex')
    vi.stubEnv('YANDEX_CLOUD_USE_METADATA_IAM_TOKEN', 'true')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ access_token: 'synthetic-iam', expires_in: 3600 }), { status: 200 })))
    expect(await programModelAuthorization()).toEqual({ header: 'Bearer synthetic-iam', iamToken: 'synthetic-iam' })
  })
})
