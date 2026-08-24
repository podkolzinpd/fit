import { supabase } from './client'

type LegacyFunctionResult<T> = {
  data: T | null
  error: Error | { context: Response } | null
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
): Promise<LegacyFunctionResult<T> | undefined> {
  const baseUrl = legacyCloudApiBaseUrl()
  if (baseUrl === undefined) return undefined
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) return { data: null, error: new Error('authentication_required') }
  let response: Response
  try {
    response = await fetch(`${baseUrl}/v1/legacy/${name}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-supabase-authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify(body),
    })
  } catch (error) {
    return { data: null, error: error instanceof Error ? error : new Error('legacy_cloud_request_failed') }
  }
  if (!response.ok) return { data: null, error: { context: response } }
  try {
    return { data: await response.json() as T, error: null }
  } catch {
    return { data: null, error: new Error('invalid_json') }
  }
}
