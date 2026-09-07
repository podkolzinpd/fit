import type { QueryResultRow } from 'pg'

import type { DatabaseClient } from './db/types.js'

export type AssistantTool =
  | 'record_workout'
  | 'create_client_draft'
  | 'create_program_draft'
  | 'schedule_program'
  | 'summarize_progress'

export type AssistantActionStatus =
  | 'proposed'
  | 'applying'
  | 'applied'
  | 'failed'
  | 'cancelled'

export interface AssistantConversation {
  id: string
  title: string | null
  createdAt: string
}

export interface AssistantMessage {
  id: string
  conversationId: string
  turnId: string | null
  author: 'user' | 'assistant'
  content: string
  action: Record<string, unknown> | null
  createdAt: string
}

export interface AssistantStoredAction {
  id: string
  conversationId: string
  assistantMessageId: string
  tool: AssistantTool
  status: AssistantActionStatus
  payload: Record<string, unknown>
  result: Record<string, unknown> | null
  errorCode: string | null
  version: number
  createdAt: string
  updatedAt: string
  appliedAt: string | null
}

interface ConversationRow extends QueryResultRow {
  id: string
  title: string | null
  created_at: Date
}

interface CreatedConversationRow extends QueryResultRow {
  conversation_id: string
  title: string | null
  created_at: Date
}

interface MessageRow extends QueryResultRow {
  id: string
  conversation_id: string
  turn_id: string | null
  author: 'user' | 'assistant'
  content: string
  action: Record<string, unknown> | null
  created_at: Date
}

interface ActionRow extends QueryResultRow {
  id: string
  conversation_id: string
  assistant_message_id: string
  tool: AssistantTool
  status: AssistantActionStatus
  payload: Record<string, unknown>
  result: Record<string, unknown> | null
  error_code: string | null
  version: string
  created_at: Date
  updated_at: Date
  applied_at: Date | null
}

interface JsonResultRow extends QueryResultRow {
  result: Record<string, unknown>
}

export type AssistantStateFailure =
  | 'conflict'
  | 'forbidden'
  | 'invalid'
  | 'not_found'

export class AssistantStateError extends Error {
  constructor(readonly failure: AssistantStateFailure) {
    super(`Assistant state operation failed: ${failure}`)
    this.name = 'AssistantStateError'
  }
}

function mappedError(error: unknown): AssistantStateError | undefined {
  if (typeof error !== 'object' || error === null || !('message' in error)) {
    return undefined
  }
  const message = error.message
  if (message === 'assistant_trainer_required') {
    return new AssistantStateError('forbidden')
  }
  if (
    message === 'assistant_conversation_not_found'
    || message === 'assistant_action_not_found'
    || message === 'assistant_summary_not_found'
  ) {
    return new AssistantStateError('not_found')
  }
  if (
    message === 'assistant_turn_reused'
    || message === 'assistant_action_conflict'
    || message === 'assistant_action_id_collision'
  ) {
    return new AssistantStateError('conflict')
  }
  if (typeof message === 'string' && message.startsWith('assistant_')) {
    return new AssistantStateError('invalid')
  }
  return undefined
}

async function run<Result>(work: () => Promise<Result>): Promise<Result> {
  try {
    return await work()
  } catch (error) {
    throw mappedError(error) ?? error
  }
}

function safeVersion(value: string): number {
  const version = Number(value)
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new Error('Assistant state returned an invalid version')
  }
  return version
}

function conversation(row: ConversationRow): AssistantConversation {
  return {
    id: row.id,
    title: row.title,
    createdAt: row.created_at.toISOString(),
  }
}

function message(row: MessageRow): AssistantMessage {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    turnId: row.turn_id,
    author: row.author,
    content: row.content,
    action: row.action,
    createdAt: row.created_at.toISOString(),
  }
}

function action(row: ActionRow): AssistantStoredAction {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    assistantMessageId: row.assistant_message_id,
    tool: row.tool,
    status: row.status,
    payload: row.payload,
    result: row.result,
    errorCode: row.error_code,
    version: safeVersion(row.version),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    appliedAt: row.applied_at?.toISOString() ?? null,
  }
}

export function listAssistantConversations(
  client: DatabaseClient,
): Promise<AssistantConversation[]> {
  return run(async () => {
    const rows = await client.query<ConversationRow>(`
      select id, title, created_at
      from public.assistant_conversations
      order by created_at desc, id desc
    `)
    return rows.map(conversation)
  })
}

export function createAssistantConversation(
  client: DatabaseClient,
  title: string | null,
): Promise<AssistantConversation> {
  return run(async () => {
    const rows = await client.query<CreatedConversationRow>(`
      select conversation_id, title, created_at
      from public.create_assistant_conversation($1)
    `, [title])
    const created = rows[0]
    if (created === undefined) throw new Error('Assistant conversation was not created')
    return conversation({
      id: created.conversation_id,
      title: created.title,
      created_at: created.created_at,
    })
  })
}

export function listAssistantMessages(
  client: DatabaseClient,
  conversationId: string,
): Promise<AssistantMessage[]> {
  return run(async () => {
    const rows = await client.query<MessageRow>(`
      select id, conversation_id, turn_id, author, content, action, created_at
      from public.assistant_messages
      where conversation_id = $1
      order by created_at, id
    `, [conversationId])
    return rows.map(message)
  })
}

export function listAssistantActions(
  client: DatabaseClient,
  conversationId: string | null,
): Promise<AssistantStoredAction[]> {
  return run(async () => {
    const rows = await client.query<ActionRow>(`
      select id, conversation_id, assistant_message_id, tool, status,
        payload, result, error_code, version, created_at, updated_at, applied_at
      from public.assistant_actions
      where ($1::uuid is null or conversation_id = $1)
      order by created_at, id
    `, [conversationId])
    return rows.map(action)
  })
}

export function appendAssistantUserMessage(
  client: DatabaseClient,
  conversationId: string,
  turnId: string,
  content: string,
): Promise<void> {
  return run(async () => {
    await client.query(
      'select * from public.append_assistant_user_message($1, $2, $3)',
      [conversationId, turnId, content],
    )
  })
}

export function persistAssistantResponse(
  client: DatabaseClient,
  conversationId: string,
  turnId: string,
  content: string,
  responseAction: Record<string, unknown> | null,
): Promise<Record<string, unknown>> {
  return run(async () => {
    const rows = await client.query<JsonResultRow>(`
      select public.persist_assistant_response($1, $2, $3, $4::jsonb) result
    `, [
      conversationId,
      turnId,
      content,
      responseAction === null ? null : JSON.stringify(responseAction),
    ])
    const result = rows[0]?.result
    if (result === undefined) throw new Error('Assistant response was not persisted')
    return result
  })
}

function runAction(
  client: DatabaseClient,
  query: string,
  values: readonly unknown[],
): Promise<Record<string, unknown>> {
  return run(async () => {
    const rows = await client.query<JsonResultRow>(query, values)
    const result = rows[0]?.result
    if (result === undefined) throw new Error('Assistant action returned no result')
    return result
  })
}

export function applyAssistantAction(
  client: DatabaseClient,
  actionId: string,
  input: Record<string, unknown>,
  expectedVersion: number,
) {
  return runAction(
    client,
    'select public.apply_assistant_action($1, $2::jsonb, $3) result',
    [actionId, JSON.stringify(input), expectedVersion],
  )
}

export function completeAssistantSummary(
  client: DatabaseClient,
  actionId: string,
  expectedVersion: number,
) {
  return runAction(
    client,
    'select public.complete_assistant_summary($1, $2) result',
    [actionId, expectedVersion],
  )
}

export function cancelAssistantAction(
  client: DatabaseClient,
  actionId: string,
  expectedVersion: number,
) {
  return runAction(
    client,
    'select public.cancel_assistant_action($1, $2) result',
    [actionId, expectedVersion],
  )
}
