type ProxyEvent = {
  body?: unknown
  headers?: Record<string, string | undefined>
  httpMethod?: string
  isBase64Encoded?: boolean
}

type ProxyResponse = {
  statusCode: number
  headers: Record<string, string>
  body: string
}

function bodyText(event: ProxyEvent): string {
  if (typeof event.body === 'string') {
    return event.isBase64Encoded
      ? Buffer.from(event.body, 'base64').toString('utf8')
      : event.body
  }
  return JSON.stringify(event.body ?? {})
}

function cors(event: ProxyEvent): Record<string, string> {
  const origin = event.headers?.origin ?? event.headers?.Origin
  return {
    'access-control-allow-origin': origin ?? '*',
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type,x-fit-session,x-fit-pilot-session',
    'access-control-max-age': '86400',
    vary: 'Origin',
  }
}

export async function proxyToYandexApi(
  event: ProxyEvent,
  path: string,
): Promise<ProxyResponse> {
  const headers = cors(event)
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: { ...headers, allow: 'POST' }, body: JSON.stringify({ error: 'method_not_allowed' }) }
  }

  const baseUrl = process.env.FIT_API_BASE_URL?.trim().replace(/\/+$/, '')
  if (!baseUrl) return { statusCode: 503, headers, body: JSON.stringify({ error: 'service_unavailable' }) }

  const requestHeaders: Record<string, string> = { 'content-type': 'application/json' }
  for (const name of ['x-fit-session', 'x-fit-pilot-session']) {
    const value = event.headers?.[name] ?? event.headers?.[name.replace('x-', 'X-')]
    if (typeof value === 'string' && value.length > 0) requestHeaders[name] = value
  }

  try {
    const response = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: requestHeaders,
      body: bodyText(event),
      signal: AbortSignal.timeout(115_000),
    })
    const responseHeaders: Record<string, string> = { ...headers }
    for (const name of ['content-type', 'cache-control', 'x-fit-error-code', 'x-fit-request-id']) {
      const value = response.headers.get(name)
      if (value !== null) responseHeaders[name] = value
    }
    return { statusCode: response.status, headers: responseHeaders, body: await response.text() }
  } catch (error) {
    console.error('yandex_api_proxy_failed', error instanceof Error ? error.message : 'unknown_error')
    return { statusCode: 503, headers, body: JSON.stringify({ error: 'service_unavailable' }) }
  }
}
