export async function fetchWithTimeout(
  fetchImplementation: typeof fetch,
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<Response> {
  const controller = new AbortController()
  const requestSignal = init?.signal
    ?? (typeof Request !== 'undefined' && input instanceof Request ? input.signal : undefined)
  const abortFromRequest = () => controller.abort(requestSignal?.reason)
  let timedOut = false
  const timeoutId = globalThis.setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)

  if (requestSignal?.aborted) abortFromRequest()
  else requestSignal?.addEventListener('abort', abortFromRequest, { once: true })

  try {
    return await fetchImplementation(input, { ...init, signal: controller.signal })
  } catch (cause) {
    if (timedOut) throw new TypeError(timeoutMessage, { cause })
    throw cause
  } finally {
    globalThis.clearTimeout(timeoutId)
    requestSignal?.removeEventListener('abort', abortFromRequest)
  }
}
