/** Validate metadata without accepting a workout aggregate or actor identity. */
export function readWorkoutTitleRequest(body: unknown): { title: string; expectedVersion: number } | undefined {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return undefined
  const input = body as Record<string, unknown>
  const title = typeof input.title === 'string' ? input.title.trim() : ''
  if (!title || [...title].length > 120 || typeof input.expectedVersion !== 'number'
    || !Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1) return undefined
  return { title, expectedVersion: input.expectedVersion }
}
