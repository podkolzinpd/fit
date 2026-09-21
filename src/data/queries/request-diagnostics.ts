import {
  attachRequestDiagnostics,
  type RequestDiagnostics,
  type RequestDiagnosticStage,
} from '../../shared/request-diagnostics'

const responseDiagnostics = new WeakMap<Response, RequestDiagnostics>()
const uuidSegment = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const platformRecoveryDelaysMs = [250, 750, 1_500, 3_000] as const
const platformProbeTimeoutMs = 1_000
const mutationPreflightFreshnessMs = 45_000
const platformRecoveries = new Map<string, Promise<boolean>>()
const mutationPreflights = new Map<string, Promise<boolean>>()
const runtimeReachedAt = new Map<string, number>()

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

function healthEndpoint(input: RequestInfo | URL): string | undefined {
  try {
    const value = typeof Request !== 'undefined' && input instanceof Request ? input.url : String(input)
    const url = new URL(value, globalThis.location?.origin ?? 'http://localhost')
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined
    url.pathname = '/health'
    url.search = ''
    url.hash = ''
    return url.toString()
  } catch {
    return undefined
  }
}

function wait(delayMs: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, delayMs))
}

async function probeHealth(fetchImplementation: typeof fetch, endpoint: string): Promise<boolean> {
  const controller = new AbortController()
  const timeoutId = globalThis.setTimeout(() => controller.abort(), platformProbeTimeoutMs)
  try {
    const response = await fetchImplementation(endpoint, {
      cache: 'no-store',
      signal: controller.signal,
    })
    const reachedRuntime = response.ok && response.headers.has('x-fit-request-id')
    if (reachedRuntime) runtimeReachedAt.set(endpoint, Date.now())
    return reachedRuntime
  } catch {
    return false
  } finally {
    globalThis.clearTimeout(timeoutId)
  }
}

function startMutationPreflight(
  fetchImplementation: typeof fetch,
  endpoint: string,
): Promise<boolean> {
  const activePreflight = mutationPreflights.get(endpoint)
  if (activePreflight !== undefined) return activePreflight

  const preflight = (async () => {
    if (await probeHealth(fetchImplementation, endpoint)) return true
    return startPlatformRecovery(fetchImplementation, endpoint)
  })()
  mutationPreflights.set(endpoint, preflight)
  void preflight.finally(() => {
    if (mutationPreflights.get(endpoint) === preflight) mutationPreflights.delete(endpoint)
  })
  return preflight
}

function startPlatformRecovery(
  fetchImplementation: typeof fetch,
  endpoint: string,
): Promise<boolean> {
  const activeRecovery = platformRecoveries.get(endpoint)
  if (activeRecovery !== undefined) return activeRecovery

  const recovery = (async () => {
    for (const delayMs of platformRecoveryDelaysMs) {
      await wait(delayMs)
      if (await probeHealth(fetchImplementation, endpoint)) return true
    }
    return false
  })()
  platformRecoveries.set(endpoint, recovery)
  void recovery.finally(() => {
    if (platformRecoveries.get(endpoint) === recovery) platformRecoveries.delete(endpoint)
  })
  return recovery
}

async function waitForRecovery(
  recovery: Promise<boolean>,
  signal: AbortSignal | null | undefined,
): Promise<boolean> {
  if (signal === null || signal === undefined) return recovery
  const abortReason = (): Error => {
    const reason: unknown = signal.reason
    return reason instanceof Error ? reason : new DOMException('Aborted', 'AbortError')
  }
  if (signal.aborted) throw abortReason()

  return new Promise<boolean>((resolve, reject) => {
    const abort = () => reject(abortReason())
    signal.addEventListener('abort', abort, { once: true })
    void recovery.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  })
}

function canAttemptPlatformRecovery(input: RequestInfo | URL): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return false
  return healthEndpoint(input) !== undefined
}

async function recoverPlatformRead(
  fetchImplementation: typeof fetch,
  input: RequestInfo | URL,
  init: RequestInit | undefined,
): Promise<boolean> {
  if (!canAttemptPlatformRecovery(input)) return false
  const endpoint = healthEndpoint(input)
  if (endpoint === undefined) return false
  const requestSignal = init?.signal
    ?? (typeof Request !== 'undefined' && input instanceof Request ? input.signal : undefined)
  return waitForRecovery(startPlatformRecovery(fetchImplementation, endpoint), requestSignal)
}

function isSafeMethod(method: string): boolean {
  return ['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase())
}

async function preflightPlatformMutation(
  fetchImplementation: typeof fetch,
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  diagnostics: RequestDiagnostics,
): Promise<void> {
  const endpoint = healthEndpoint(input)
  if (endpoint === undefined) return
  const reachedAt = runtimeReachedAt.get(endpoint)
  if (reachedAt !== undefined && Date.now() - reachedAt < mutationPreflightFreshnessMs) return

  const requestSignal = init?.signal
    ?? (typeof Request !== 'undefined' && input instanceof Request ? input.signal : undefined)
  let ready = false
  try {
    ready = await waitForRecovery(
      startMutationPreflight(fetchImplementation, endpoint),
      requestSignal,
    )
  } catch (cause) {
    if (requestSignal?.aborted) throw cause
  }
  if (ready) return

  throw new RequestNetworkError(
    'Не удалось подготовить соединение с Yandex Cloud.',
    diagnostics,
    new Error('Yandex Serverless Container did not pass the mutation preflight'),
  )
}

export function resetYandexPlatformRequestStateForTests(): void {
  platformRecoveries.clear()
  mutationPreflights.clear()
  runtimeReachedAt.clear()
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
  const diagnostics: RequestDiagnostics = {
    requestId,
    occurredAt,
    backend: 'yandex',
    operation,
    stage: 'network',
  }
  try {
    if (!isSafeMethod(method)) {
      await preflightPlatformMutation(fetchImplementation, input, init, diagnostics)
    }
    const response = await fetchImplementation(input, { ...init, headers: requestHeaders })
    const endpoint = healthEndpoint(input)
    if (endpoint !== undefined && response.headers.has('x-fit-request-id')) {
      runtimeReachedAt.set(endpoint, Date.now())
    }
    const responseDiagnostic: RequestDiagnostics = {
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
    responseDiagnostics.set(response, responseDiagnostic)
    return response
  } catch (cause) {
    if (cause instanceof RequestNetworkError) throw cause
    const message = cause instanceof Error && cause.message.length > 0
      ? cause.message
      : 'Не удалось подключиться к Yandex Cloud.'
    throw new RequestNetworkError(message, diagnostics, cause)
  }
}

export async function fetchWithYandexPlatformReadRetry(
  fetchImplementation: typeof fetch,
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const method = init?.method
    ?? (typeof Request !== 'undefined' && input instanceof Request ? input.method : 'GET')
  let response: Response
  try {
    response = await fetchWithRequestDiagnostics(fetchImplementation, input, init)
  } catch (error) {
    // A platform-level 502 does not include our CORS headers because Fastify
    // never starts. Browsers expose that response as a network failure rather
    // than a readable 502, so cover both representations of the same incident.
    // Reads are idempotent; writes and caller cancellations are never repeated.
    const requestSignal = init?.signal
      ?? (typeof Request !== 'undefined' && input instanceof Request ? input.signal : undefined)
    if (method.toUpperCase() !== 'GET'
      || !(error instanceof RequestNetworkError)
      || requestSignal?.aborted) {
      throw error
    }
    if (!await recoverPlatformRead(fetchImplementation, input, init)) throw error
    return fetchWithRequestDiagnostics(fetchImplementation, input, init)
  }

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

  if (!await recoverPlatformRead(fetchImplementation, input, init)) return response
  return fetchWithRequestDiagnostics(fetchImplementation, input, init)
}
