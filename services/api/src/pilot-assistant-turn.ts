import { randomUUID } from 'node:crypto'
import type { QueryResultRow } from 'pg'

import {
  assistantCapabilitiesReply,
  assistantSmallTalkFallback,
  isAssistantCapabilityQuestion,
  isTurnIdReuse,
  recordWorkoutTurn,
  validateAssistantTurnResponse,
  type AssistantTurnResponse,
} from './assistant-orchestrator/index.js'
import {
  AssistantStateError,
  appendAssistantUserMessage,
  persistAssistantResponse,
} from './assistant-state.js'
import {
  type AssistantTurnRequest,
} from './assistant-state-request.js'
import { hashPilotSessionToken } from './auth/pilot-session-token.js'
import type { DatabaseClient, DatabasePool } from './db/types.js'
import {
  PilotSessionInvalidError,
  withYandexPilotSessionTransaction,
} from './db/yandex-pilot-transaction.js'

interface StoredAssistantMessageRow extends QueryResultRow {
  content: string
  action: Record<string, unknown> | null
}

interface StoredUserMessageRow extends QueryResultRow {
  content: string
}

interface ClientContextRow extends QueryResultRow {
  id: string
  full_name: string
  goal: string | null
  age_years: number | null
  height_cm: string | number | null
  gender: string | null
}

interface HistoryRow extends QueryResultRow {
  author: string
  content: string
  action: Record<string, unknown> | null
}

export interface PilotAssistantTurnRunner {
  runTurn(
    sessionToken: string,
    command: AssistantTurnRequest,
  ): Promise<AssistantTurnResponse>
}

interface NativeAssistantTurnOptions {
  createId?: () => string
}

function responseFromStoredMessage(
  value: StoredAssistantMessageRow | undefined,
): AssistantTurnResponse | undefined {
  if (value === undefined) return undefined
  const parsed = validateAssistantTurnResponse({
    reply: value.content,
    action: value.action,
  })
  return parsed ?? { reply: value.content, action: null }
}

function clientContext(row: ClientContextRow) {
  return {
    id: row.id,
    fullName: row.full_name,
    goal: row.goal,
    ageYears: row.age_years,
    heightCm: row.height_cm,
    gender: row.gender,
  }
}

function responseWithPersistentActionId(
  response: AssistantTurnResponse,
  createId: () => string,
): AssistantTurnResponse {
  if (response.action === null || response.action.status === 'needs_input') {
    return response
  }
  return {
    ...response,
    action: { ...response.action, id: createId() },
  }
}

async function persistTurnResponse(
  client: DatabaseClient,
  command: AssistantTurnRequest,
  turnId: string,
  response: AssistantTurnResponse,
  createId: () => string,
): Promise<AssistantTurnResponse> {
  const next = responseWithPersistentActionId(response, createId)
  await persistAssistantResponse(
    client,
    command.conversationId,
    turnId,
    next.reply,
    next.action,
  )
  return next
}

async function readStoredAssistantResponse(
  client: DatabaseClient,
  command: AssistantTurnRequest,
  turnId: string,
): Promise<AssistantTurnResponse | undefined> {
  const rows = await client.query<StoredAssistantMessageRow>(`
    select content, action
    from public.assistant_messages
    where conversation_id = $1 and turn_id = $2 and author = 'assistant'
  `, [command.conversationId, turnId])
  const stored = responseFromStoredMessage(rows[0])
  if (stored === undefined) return undefined

  const userRows = await client.query<StoredUserMessageRow>(`
    select content
    from public.assistant_messages
    where conversation_id = $1 and turn_id = $2 and author = 'user'
  `, [command.conversationId, turnId])
  if (isTurnIdReuse(userRows[0]?.content, command.message)) {
    throw new AssistantStateError('conflict')
  }
  return stored
}

async function readClients(client: DatabaseClient) {
  const rows = await client.query<ClientContextRow>(`
    select id, full_name, goal, age_years, height_cm, gender
    from public.list_client_overviews(false)
    order by full_name, id
    limit 50
  `)
  return rows.map(clientContext)
}

async function readRecentHistory(
  client: DatabaseClient,
  conversationId: string,
): Promise<HistoryRow[]> {
  const rows = await client.query<HistoryRow>(`
    select author, content, action
    from public.assistant_messages
    where conversation_id = $1
    order by created_at desc, id desc
    limit 20
  `, [conversationId])
  return [...rows]
}

export async function runNativePilotAssistantTurn(
  client: DatabaseClient,
  command: AssistantTurnRequest,
  options: NativeAssistantTurnOptions = {},
): Promise<AssistantTurnResponse> {
  const turnId = command.turnId ?? randomUUID()
  const createId = options.createId ?? randomUUID
  const stored = await readStoredAssistantResponse(client, command, turnId)
  if (stored !== undefined) return stored

  await appendAssistantUserMessage(
    client,
    command.conversationId,
    turnId,
    command.message,
  )

  if (isAssistantCapabilityQuestion(command.message)) {
    return persistTurnResponse(
      client,
      command,
      turnId,
      { reply: assistantCapabilitiesReply(), action: null },
      createId,
    )
  }

  const clients = await readClients(client)
  const history = await readRecentHistory(client, command.conversationId)
  const latestAssistantAction = history.find((row) => row.author === 'assistant')?.action
  const workoutDraft = recordWorkoutTurn(
    command.message,
    clients,
    latestAssistantAction,
  )
  if (workoutDraft !== undefined) {
    return persistTurnResponse(client, command, turnId, workoutDraft, createId)
  }

  return persistTurnResponse(
    client,
    command,
    turnId,
    { reply: assistantSmallTalkFallback(command.message), action: null },
    createId,
  )
}

export class DatabasePilotAssistantTurnRunner implements PilotAssistantTurnRunner {
  constructor(private readonly pool: DatabasePool) {}

  runTurn(
    sessionToken: string,
    command: AssistantTurnRequest,
  ): Promise<AssistantTurnResponse> {
    const tokenHash = hashPilotSessionToken(sessionToken)
    if (tokenHash === undefined) throw new PilotSessionInvalidError()
    return withYandexPilotSessionTransaction(this.pool, tokenHash, (client) =>
      runNativePilotAssistantTurn(client, command))
  }
}
