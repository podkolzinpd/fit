export const LIVE_RECOVERY_REQUEST_TIMEOUT_MS = 8_000

export async function liveOperationWithTimeout<T>(promise: Promise<T>): Promise<T> {
  let timeoutId: ReturnType<typeof globalThis.setTimeout> | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutId = globalThis.setTimeout(
      () => reject(new TypeError('Live recovery request timed out')),
      LIVE_RECOVERY_REQUEST_TIMEOUT_MS,
    )
  })

  try {
    return await Promise.race([promise, timeout])
  } finally {
    if (timeoutId !== undefined) globalThis.clearTimeout(timeoutId)
  }
}
