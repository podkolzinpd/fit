import { readYandexActorSession, type YandexActorSession } from './yandex-actor-session.js'
import { buildYandexAiAuthorization } from './yandex-ai-authorization.js'
import type { YandexAiAuthorization } from './yandex-ai-authorization.js'

export function yandexAiAuthorization(): YandexAiAuthorization | undefined {
  return buildYandexAiAuthorization()
}

export function actorSession(headers: Record<string, string | undefined>): YandexActorSession | undefined {
  return readYandexActorSession(headers)
}
