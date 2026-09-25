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
  let rejectDeadline: ((reason: Error) => void) | null = null
  const deadline = new Promise<never>((_resolve, reject) => {
    rejectDeadline = reject
  })
  const timeoutId = globalThis.setTimeout(() => {
    rejectDeadline?.(new TypeError(timeoutMessage))
    controller.abort()
  }, timeoutMs)

  if (requestSignal?.aborted) abortFromRequest()
  else requestSignal?.addEventListener('abort', abortFromRequest, { once: true })

  try {
    const response = await Promise.race([
      fetchImplementation(input, { ...init, signal: controller.signal }),
      deadline,
    ])
    // Fetch resolves as soon as the response headers arrive. Buffer the body
    // inside the same deadline so a stalled JSON stream cannot leave the app
    // on an endless loading screen after the headers were received.
    if (response.body !== null) {
      await Promise.race([response.clone().arrayBuffer(), deadline])
    }
    return response
  } finally {
    globalThis.clearTimeout(timeoutId)
    requestSignal?.removeEventListener('abort', abortFromRequest)
  }
}
