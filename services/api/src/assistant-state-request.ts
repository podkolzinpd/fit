export interface AssistantActionRequest {
  expectedVersion: number
  input: Record<string, unknown>
}

function record(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined
  }
  return value as Record<string, unknown>
}

function expectedVersion(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && (value as number) >= 1
    ? value as number
    : undefined
}

export function readAssistantConversationRequest(
  value: unknown,
): { title: string | null } | undefined {
  const input = record(value)
  if (input === undefined) return undefined
  if (input.title === undefined || input.title === null) return { title: null }
  if (typeof input.title !== 'string') return undefined
  const title = input.title.trim()
  return title.length >= 1 && title.length <= 200 ? { title } : undefined
}

export function readAssistantActionRequest(
  value: unknown,
): AssistantActionRequest | undefined {
  const body = record(value)
  if (body === undefined) return undefined
  const version = expectedVersion(body.expectedVersion)
  const input = body.input === undefined ? {} : record(body.input)
  return version === undefined || input === undefined
    ? undefined
    : { expectedVersion: version, input }
}

export function readAssistantVersionRequest(
  value: unknown,
): { expectedVersion: number } | undefined {
  const body = record(value)
  if (body === undefined) return undefined
  const version = expectedVersion(body.expectedVersion)
  return version === undefined ? undefined : { expectedVersion: version }
}
