import { readYandexActorSession, type YandexActorSession } from './yandex-actor-session.js'

export function actorSession(headers: Record<string, string | undefined>): YandexActorSession | undefined {
  return readYandexActorSession(headers)
}
