import { z } from 'zod'
import type { InBodyRecognitionImage, InBodyRecognitionResult } from '../../shared/domain'
import { fetchWithTimeout } from './request-timeout'

const TIMEOUT_MS = 65_000
const PRODUCTION_ENDPOINT = 'https://functions.yandexcloud.net/d4eerma5vk3fqtahbbea'

function endpoint(): string {
  const configured = String((import.meta.env as { VITE_INBODY_RECOGNITION_URL?: unknown }).VITE_INBODY_RECOGNITION_URL ?? '').trim()
  const value = configured || PRODUCTION_ENDPOINT
  if (!value || (!value.startsWith('https://') && !value.startsWith('http://localhost'))) {
    throw new Error('Распознавание InBody пока недоступно')
  }
  return value
}

const resultSchema = z.object({
  recordedOn: z.iso.date().optional(),
  weightKg: z.number().optional(), waistCm: z.number().optional(), hipCm: z.number().optional(), chestCm: z.number().optional(),
  inBody: z.object({ schemaVersion: z.literal(1) }).catchall(z.unknown()),
  recognizedFieldCount: z.number().int().nonnegative(),
  warnings: z.array(z.string()),
})

export async function recognizeInBody(sessionToken: string, clientId: string, image: InBodyRecognitionImage): Promise<InBodyRecognitionResult> {
  const response = await fetchWithTimeout(globalThis.fetch, endpoint(), {
    method: 'POST', cache: 'no-store',
    headers: { 'content-type': 'application/json', 'x-fit-session': sessionToken },
    body: JSON.stringify({ clientId, image }),
  }, TIMEOUT_MS, 'Распознавание заняло слишком много времени')
  if (!response.ok) {
    if (response.status === 422) throw new Error('Не удалось найти показатели InBody. Сфотографируйте весь лист при хорошем освещении.')
    if (response.status === 429) throw new Error('Сервис занят. Попробуйте ещё раз через минуту.')
    throw new Error('Не удалось распознать отчёт. Попробуйте ещё раз.')
  }
  return resultSchema.parse(await response.json()) as InBodyRecognitionResult
}
