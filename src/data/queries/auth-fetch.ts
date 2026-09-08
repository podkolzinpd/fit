import { fetchWithTimeout } from './request-timeout'

export const AUTH_PASSWORD_REQUEST_TIMEOUT_MS = 8_000
export const LIVE_WORKOUT_REQUEST_TIMEOUT_MS = 12_000

const LIVE_WORKOUT_RPCS = new Set([
  'append_live_exercise',
  'append_live_set',
  'confirm_live_set',
  'finish_workout',
  'remove_live_exercise',
  'remove_live_set',
  'reorder_live_block',
  'replace_live_exercise',
  'save_live_set_draft',
  'set_exercise_comment',
])

function requestUrl(input: RequestInfo | URL): URL | null {
  const rawUrl = typeof Request !== 'undefined' && input instanceof Request
    ? input.url
    : String(input)
  try { return new URL(rawUrl, 'http://localhost') } catch { return null }
}

function isPasswordSignInRequest(input: RequestInfo | URL): boolean {
  const url = requestUrl(input)
  return Boolean(url?.pathname.endsWith('/auth/v1/token')
    && url.searchParams.get('grant_type') === 'password')
}

function isLiveWorkoutRequest(input: RequestInfo | URL): boolean {
  const rpc = requestUrl(input)?.pathname.match(/\/rest\/v1\/rpc\/([^/]+)$/)?.[1]
  return Boolean(rpc && LIVE_WORKOUT_RPCS.has(rpc))
}

export function createAuthFetch(fetchImplementation: typeof fetch = globalThis.fetch): typeof fetch {
  return async (input, init) => {
    if (isPasswordSignInRequest(input)) return fetchWithTimeout(
      fetchImplementation, input, init, AUTH_PASSWORD_REQUEST_TIMEOUT_MS, 'Auth sign-in request timed out',
    )
    if (isLiveWorkoutRequest(input)) return fetchWithTimeout(
      fetchImplementation, input, init, LIVE_WORKOUT_REQUEST_TIMEOUT_MS, 'Live workout request timed out',
    )
    return fetchImplementation(input, init)
  }
}
