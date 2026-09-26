/** Dedupes and caches in-flight/recent signed-URL lookups for a private storage path, keyed by the path itself. */
export type SignedMediaUrl = { url: string; expiresAt: number }

export function createSignedUrlCache(ttlMs: number) {
  type Entry = { expiresAt: number; promise: Promise<SignedMediaUrl>; url?: string }
  const cache = new Map<string, Entry>()
  function resolveWithExpiry(key: string, sign: () => Promise<string>): Promise<SignedMediaUrl> {
    const cached = cache.get(key)
    if (cached && cached.expiresAt > Date.now()) return cached.promise
    const expiresAt = Date.now() + ttlMs
    const promise = Promise.resolve().then(sign).then((url) => {
      entry.url = url
      return { url, expiresAt }
    }).catch((error: unknown) => {
      // An older failed request must not evict a newer refresh for the path.
      if (cache.get(key) === entry) cache.delete(key)
      throw error
    })
    const entry: Entry = { expiresAt, promise }
    cache.set(key, entry)
    return promise
  }
  return {
    resolve(key: string, sign: () => Promise<string>): Promise<string> {
      return resolveWithExpiry(key, sign).then(({ url }) => url)
    },
    resolveWithExpiry,
    invalidate(key: string, failedUrl: string) {
      // Other mounted cards may already be refreshing this same failed URL.
      if (cache.get(key)?.url === failedUrl) cache.delete(key)
    },
  }
}
