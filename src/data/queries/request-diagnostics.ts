import {
  attachRequestDiagnostics,
  type RequestDiagnostics,
  type RequestDiagnosticStage,
} from '../../shared/request-diagnostics'

const responseDiagnostics = new WeakMap<Response, RequestDiagnostics>()
const uuidSegment = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function operationName(input: RequestInfo | URL, method: string): string {
  let pathname = '/v1'
  try {
    const value = typeof Request !== 'undefined' && input instanceof Request ? input.url : String(input)
    pathname = new URL(value, 'http://localhost').pathname
  } catch {
    // The diagnostic remains useful through its request ID even without a route label.
  }
  const safePath = pathname.split('/').map((segment) => {
    if (uuidSegment.test(segment) || /^\d+$/.test(segment) || segment.length > 64) return ':id'
    return segment
  }).join('/')
  return `${method.toUpperCase()} ${safePath}`
}

function header(headers: Headers, name: string): string | undefined {
  const value = headers.get(name)
  return value === null || value.length === 0 ? undefined : value
}

export class RequestNetworkError extends Error {
  constructor(message: string, diagnostics: RequestDiagnostics, cause: unknown) {
    super(message, { cause })
    this.name = 'RequestNetworkError'
    attachRequestDiagnostics(this, diagnostics)
  }
}

export function getResponseDiagnostics(response: Response): RequestDiagnostics | undefined {
  return responseDiagnostics.get(response)
}

export function diagnosticsForResponse(
  response: Response,
  stage: RequestDiagnosticStage = 'api',
  errorCode?: string,
): RequestDiagnostics | undefined {
  const base = responseDiagnostics.get(response)
  if (base === undefined) return undefined
  return {
    ...base,
    stage,
    status: response.status,
    ...(errorCode === undefined ? {} : { errorCode }),
  }
}

export async function fetchWithRequestDiagnostics(
  fetchImplementation: typeof fetch,
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const requestId = crypto.randomUUID()
  const occurredAt = new Date().toISOString()
  const method = init?.method ?? (typeof Request !== 'undefined' && input instanceof Request ? input.method : 'GET')
  const operation = operationName(input, method)
  const headers = new Headers(init?.headers)
  headers.set('x-fit-request-id', requestId)
  const requestHeaders: Record<string, string> = {}
  headers.forEach((value, name) => { requestHeaders[name] = value })
  try {
    const response = await fetchImplementation(input, { ...init, headers: requestHeaders })
    const diagnostics: RequestDiagnostics = {
      requestId: header(response.headers, 'x-fit-request-id') ?? requestId,
      occurredAt,
      backend: 'yandex',
      operation,
      stage: 'api',
      status: response.status,
      ...(header(response.headers, 'x-fit-error-code') ? { errorCode: header(response.headers, 'x-fit-error-code') } : {}),
      ...(header(response.headers, 'x-fit-error-category') ? { errorCategory: header(response.headers, 'x-fit-error-category') } : {}),
      ...(header(response.headers, 'x-fit-release-id') ? { releaseId: header(response.headers, 'x-fit-release-id') } : {}),
    }
    responseDiagnostics.set(response, diagnostics)
    return response
  } catch (cause) {
    const message = cause instanceof Error && cause.message.length > 0
      ? cause.message
      : 'Не удалось подключиться к Yandex Cloud.'
    throw new RequestNetworkError(message, {
      requestId,
      occurredAt,
      backend: 'yandex',
      operation,
      stage: 'network',
    }, cause)
  }
}

export async function fetchWithYandexPlatformReadRetry(
  fetchImplementation: typeof fetch,
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const response = await fetchWithRequestDiagnostics(fetchImplementation, input, init)
  const method = init?.method
    ?? (typeof Request !== 'undefined' && input instanceof Request ? input.method : 'GET')

  // A Yandex Serverless Containers invocation failure returns 502 before
  // Fastify starts, so it cannot contain the request ID added by our
  // onRequest hook. A second GET is safe and recovers when the next request
  // reaches a healthy instance. Application 502 responses and every write
  // remain visible and are never repeated here.
  if (method.toUpperCase() !== 'GET'
    || response.status !== 502
    || response.headers.has('x-fit-request-id')) {
    return response
  }

  return fetchWithRequestDiagnostics(fetchImplementation, input, init)
}
