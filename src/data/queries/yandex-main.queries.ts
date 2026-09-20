import { LIVE_WORKOUT_REQUEST_TIMEOUT_MS } from './auth-fetch'
import { fetchWithRequestDiagnostics } from './request-diagnostics'
import { fetchWithTimeout } from './request-timeout'

export type YandexMainHttpMethod = 'DELETE' | 'PATCH' | 'POST' | 'PUT'

export interface YandexMainQueries {
  read(path: string): Promise<Response>
  write(path: string, method: YandexMainHttpMethod, body?: object): Promise<Response>
}

function endpoint(apiBaseUrl: string, path: string): string {
  if (!path.startsWith('/v1/')) throw new Error('Некорректный путь Yandex API')
  return `${apiBaseUrl}${path}`
}

function isLiveWorkoutWrite(path: string): boolean {
  return /^\/v1\/(?:workouts\/[^/]+\/(?:start|finish|exercises|blocks)|workout-(?:sets|exercises)\/)/.test(path)
}

export function createYandexMainQueries(
  apiBaseUrl: string,
  sessionToken: string,
): YandexMainQueries {
  const sessionHeaders = { 'x-fit-session': sessionToken }
  const request = (path: string, init?: RequestInit) => fetchWithRequestDiagnostics(
    globalThis.fetch,
    endpoint(apiBaseUrl, path),
    init,
  )
  return {
    read: (path) => request(path, {
      cache: 'no-store',
      headers: sessionHeaders,
    }),
    write: (path, method, body) => {
      const init: RequestInit = {
        method,
        cache: 'no-store',
        headers: body === undefined
          ? sessionHeaders
          : { ...sessionHeaders, 'content-type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }
      if (!isLiveWorkoutWrite(path)) return request(path, init)
      const timedFetch: typeof fetch = (input, requestInit) => fetchWithTimeout(
        globalThis.fetch,
        input,
        requestInit,
        LIVE_WORKOUT_REQUEST_TIMEOUT_MS,
        'Live workout request timed out',
      )
      return fetchWithRequestDiagnostics(timedFetch, endpoint(apiBaseUrl, path), init)
    },
  }
}
