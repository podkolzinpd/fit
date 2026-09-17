/** Dedupes and caches in-flight/recent signed-URL lookups for a private storage path, keyed by the path itself. */
export function createSignedUrlCache(ttlMs: number) {
  const cache = new Map<string, { expiresAt: number; promise: Promise<string> }>()
  return {
    resolve(key: string, sign: () => Promise<string>): Promise<string> {
      const cached = cache.get(key)
      if (cached && cached.expiresAt > Date.now()) return cached.promise
      const promise = sign().catch((error: unknown) => {
        cache.delete(key)
        throw error
      })
      cache.set(key, { expiresAt: Date.now() + ttlMs, promise })
      return promise
    },
  }
}
