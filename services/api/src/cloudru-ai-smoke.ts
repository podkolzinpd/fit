import { programModelJson } from './assistant-orchestrator/program/model.js'
import { pathToFileURL } from 'node:url'

export async function smokeCloudruAi(): Promise<void> {
  if (process.env.FIT_MEDIA_STORAGE_PROVIDER !== 'cloudru' || process.env.FIT_AI_FUNCTIONS_ENABLED !== 'true'
    || !process.env.YANDEX_CLOUD_API_KEY || !process.env.YANDEX_CLOUD_FOLDER_ID) throw new Error('cloudru_ai_smoke_rejected')
  const result: unknown = await programModelJson({ instruction: 'Return the JSON object {"ok":true}.', data: {},
    schema: { type: 'object', additionalProperties: false, required: ['ok'], properties: { ok: { type: 'boolean' } } },
    functionName: 'fit-cloudru-synthetic-smoke', operationId: 'synthetic-smoke', maxTokens: 20, timeoutMs: 20_000 })
  if (typeof result !== 'object' || result === null || !('ok' in result) || result.ok !== true) throw new Error('cloudru_ai_smoke_failed')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  smokeCloudruAi().then(() => { console.log('{"event":"cloudru_external_ai_smoke_passed"}') })
    .catch(() => { console.error('cloudru_external_ai_smoke_failed'); process.exitCode = 1 })
}
