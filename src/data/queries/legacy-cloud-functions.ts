import { getSupabaseClient } from './client'
import { refreshSupabaseAccessToken, verifiedSupabaseAccessToken } from './verified-supabase-session'

type LegacyFunctionResult<T> = {
  data: T | null
  error: Error | { context: Response } | null
  response?: Response
}

export function legacyCloudApiBaseUrl(): string | undefined {
  const value = String((import.meta.env as { VITE_YANDEX_LEGACY_FUNCTIONS_API_BASE_URL?: unknown }).VITE_YANDEX_LEGACY_FUNCTIONS_API_BASE_URL ?? '').trim().replace(/\/$/, '')
  if (value.length === 0) return undefined
  try {
    const url = new URL(value)
    const localHttp = url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]')
    return url.origin === value && (url.protocol === 'https:' || localHttp) ? value : undefined
  } catch {
    return undefined
  }
}

export async function invokeLegacyCloudFunction<T>(
  name: 'parse-workout' | 'summarize-client-training',
  body: unknown,
  options: { includeResponse?: boolean } = {},
): Promise<LegacyFunctionResult<T> | undefined> {
  const baseUrl = legacyCloudApiBaseUrl()
  if (baseUrl === undefined) return undefined
  let accessToken: string
  try {
    accessToken = name === 'summarize-client-training'
      ? await verifiedSupabaseAccessToken()
      : (await getSupabaseClient().auth.getSession()).data.session?.access_token ?? ''
  } catch (error) {
    return { data: null, error: error instanceof Error ? error : new Error('authentication_required') }
  }
  if (!accessToken) return { data: null, error: new Error('authentication_required') }
  const request = (token: string) => fetch(`${baseUrl}/v1/legacy/${name}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-supabase-authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  })
  let response: Response
  try {
    response = await request(accessToken)
  } catch (error) {
    return { data: null, error: error instanceof Error ? error : new Error('legacy_cloud_request_failed') }
  }

  if (name === 'summarize-client-training' && await isAuthenticationRejection(response)) {
    try {
      accessToken = await refreshSupabaseAccessToken()
      response = await request(accessToken)
    } catch (error) {
      return { data: null, error: error instanceof Error ? error : new Error('authentication_required') }
    }
  }
  if (!response.ok) return { data: null, error: { context: response } }
  try {
    return {
      data: await response.json() as T,
      error: null,
      ...(options.includeResponse ? { response } : {}),
    }
  } catch {
    return { data: null, error: new Error('invalid_json') }
  }
}

async function isAuthenticationRejection(response: Response): Promise<boolean> {
  if (response.status !== 401) return false
  const headerCode = response.headers.get('x-fit-error-code')
  if (headerCode === 'authentication_required' || headerCode === 'unauthorized') return true
  try {
    const payload = await response.clone().json() as { error?: unknown; code?: unknown }
    return payload.error === 'authentication_required' || payload.error === 'unauthorized'
      || payload.code === 'authentication_required' || payload.code === 'unauthorized'
  } catch {
    return false
  }
}
