type SupabasePublicKeySources = {
  publishableKey?: string | null
  publishableKeys?: string | null
  anonKey?: string | null
}

function nonBlank(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

/**
 * Hosted Edge Functions expose publishable keys as a JSON dictionary and keep
 * the legacy anon key during migration. The singular variable was a custom
 * project convention, so it must not be the only supported source.
 */
export function resolveSupabasePublicKey(
  sources: SupabasePublicKeySources,
): string | null {
  const direct = nonBlank(sources.publishableKey)
  if (direct) return direct

  if (sources.publishableKeys) {
    try {
      const parsed = JSON.parse(sources.publishableKeys) as unknown
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const defaultKey = nonBlank(
          (parsed as Record<string, unknown>).default,
        )
        if (defaultKey) return defaultKey
      }
    } catch {
      // A malformed new-style variable must not disable the legacy fallback.
    }
  }

  return nonBlank(sources.anonKey)
}
