export const AUTH_PASSWORD_REQUEST_TIMEOUT_MS = 8_000

function isPasswordSignInRequest(input: RequestInfo | URL): boolean {
  const rawUrl = typeof Request !== 'undefined' && input instanceof Request
    ? input.url
    : String(input)
  try {
    const requestUrl = new URL(rawUrl, 'http://localhost')
    return requestUrl.pathname.endsWith('/auth/v1/token')
      && requestUrl.searchParams.get('grant_type') === 'password'
  } catch {
    return false
  }
}

export function createAuthFetch(fetchImplementation: typeof fetch = globalThis.fetch): typeof fetch {
  return async (input, init) => {
    if (!isPasswordSignInRequest(input)) return fetchImplementation(input, init)

    const controller = new AbortController()
    const requestSignal = init?.signal
      ?? (typeof Request !== 'undefined' && input instanceof Request ? input.signal : undefined)
    const abortFromRequest = () => controller.abort(requestSignal?.reason)
    let timedOut = false
    const timeoutId = globalThis.setTimeout(() => {
      timedOut = true
      controller.abort()
    }, AUTH_PASSWORD_REQUEST_TIMEOUT_MS)

    if (requestSignal?.aborted) abortFromRequest()
    else requestSignal?.addEventListener('abort', abortFromRequest, { once: true })

    try {
      return await fetchImplementation(input, { ...init, signal: controller.signal })
    } catch (cause) {
      if (timedOut) throw new TypeError('Auth sign-in request timed out', { cause })
      throw cause
    } finally {
      globalThis.clearTimeout(timeoutId)
      requestSignal?.removeEventListener('abort', abortFromRequest)
    }
  }
}
