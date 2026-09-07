export interface AssistantActionRequest {
  expectedVersion: number
  input: Record<string, unknown>
}

export interface AssistantTurnRequest {
  conversationId: string
  message: string
  turnId?: string
}

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

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

export function readAssistantTurnRequest(
  value: unknown,
): AssistantTurnRequest | undefined {
  const input = record(value)
  if (
    input === undefined
    || typeof input.conversation_id !== 'string'
    || typeof input.message !== 'string'
  ) {
    return undefined
  }
  const message = input.message.trim()
  if (
    !uuidPattern.test(input.conversation_id)
    || message.length === 0
    || message.length > 4_000
  ) {
    return undefined
  }
  const turnId = input.turn_id === undefined
    ? undefined
    : typeof input.turn_id === 'string' && uuidPattern.test(input.turn_id)
      ? input.turn_id
      : undefined
  if (input.turn_id !== undefined && turnId === undefined) return undefined
  return {
    conversationId: input.conversation_id,
    ...(turnId === undefined ? {} : { turnId }),
    message,
  }
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
