import { randomUUID } from 'node:crypto'
import type { QueryResultRow } from 'pg'

import {
  assistantCapabilitiesReply,
  assistantSmallTalkFallback,
  isAssistantCapabilityQuestion,
  isTurnIdReuse,
  matchingSummaryClients,
  recordWorkoutTurn,
  validateAssistantTurnResponse,
  type AssistantTurnResponse,
} from './assistant-orchestrator/index.js'
import {
  AssistantStateError,
  appendAssistantUserMessage,
  cancelAssistantAction,
  persistAssistantResponse,
} from './assistant-state.js'
import { generateProgramOnce, programGenerationKey, type ProgramGenerationJobState, type ProgramGenerationJobStore } from './assistant-orchestrator/program/job.js'
import { isProgramEnabled } from './assistant-orchestrator/program/model.js'
import { loadDatabaseProgramContext } from './assistant-orchestrator/program/source.js'
import { extractProgramBrief, invokeProgramGenerator, programPilotTurn } from './assistant-orchestrator/program/turn.js'
import { latestActiveAssistantTool, routedAssistantTurn } from './assistant-orchestrator/router.js'
import {
  type AssistantTurnRequest,
} from './assistant-state-request.js'
import type { DatabaseClient, DatabasePool } from './db/types.js'
import {
  withYandexActorSession,
  type YandexActorSessionInput,
} from './yandex-actor-session.js'

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

interface ActorRoleRow extends QueryResultRow {
  id: string
  account_role: 'trainer' | 'client'
  timezone: string
}

interface ActionLifecycleRow extends QueryResultRow {
  status: string
  version: string
}

interface JsonValueRow extends QueryResultRow {
  result: unknown
}

export interface PilotAssistantTurnRunner {
  runTurn(
    session: YandexActorSessionInput,
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

async function readActor(client: DatabaseClient): Promise<ActorRoleRow> {
  const rows = await client.query<ActorRoleRow>(`
    select id, account_role, timezone
    from public.profiles
    where id = auth.uid()
  `)
  const actor = rows[0]
  if (actor === undefined || (actor.account_role !== 'trainer' && actor.account_role !== 'client')) {
    throw new AssistantStateError('forbidden')
  }
  return actor
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

  const role = (await readActor(client)).account_role
  const clients = await readClients(client)
  const history = await readRecentHistory(client, command.conversationId)
  const latestAssistantAction = history.find((row) => row.author === 'assistant')?.action
  const workoutDraft = recordWorkoutTurn(
    command.message,
    clients,
    latestAssistantAction,
    false,
    role === 'client',
  )
  if (workoutDraft !== undefined) {
    const response: AssistantTurnResponse = role === 'client' && clients.length === 0
      ? { reply: 'Сначала заполните свою карточку в разделе «Кабинет», затем вернитесь к записи тренировки.', action: null }
      : workoutDraft
    return persistTurnResponse(client, command, turnId, response, createId)
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

  async runTurn(
    session: YandexActorSessionInput,
    command: AssistantTurnRequest,
  ): Promise<AssistantTurnResponse> {
    const turnId = command.turnId ?? randomUUID()
    const prepared = await withYandexActorSession(this.pool, session, async (client) => {
      const stored = await readStoredAssistantResponse(client, command, turnId)
      if (stored !== undefined) return { stored } as const
      await appendAssistantUserMessage(client, command.conversationId, turnId, command.message)
      const actor = await readActor(client)
      const clients = await readClients(client)
      const history = await readRecentHistory(client, command.conversationId)
      let active = latestActiveAssistantTool(history)
      if (active?.id) {
        const lifecycle = await client.query<ActionLifecycleRow>(`
          select status, version
          from public.assistant_actions
          where id = $1
        `, [active.id])
        if (lifecycle[0] === undefined) throw new AssistantStateError('not_found')
        if (lifecycle[0].status === 'applied' || lifecycle[0].status === 'cancelled') active = null
      }
      return { actor, clients, history, active } as const
    })
    if ('stored' in prepared) return prepared.stored

    const { actor, clients, history, active } = prepared
    const today = new Date().toLocaleDateString('en-CA', {
      timeZone: actor.timezone || 'Europe/Moscow',
    })
    const programEnabled = isProgramEnabled(actor.id)
    let response: AssistantTurnResponse
    if (isAssistantCapabilityQuestion(command.message)) {
      response = {
        reply: assistantCapabilitiesReply() + (programEnabled
          ? '\nТакже могу составить рекомендованный черновик программы на четыре недели: уточню цель и условия, учту доступную историю и покажу результат перед добавлением в расписание.'
          : ''),
        action: null,
      }
    } else if (programEnabled) {
      response = await routedAssistantTurn({
        message: command.message,
        history: [...history].reverse().map(({ author, content }) => ({ author, content })),
        active,
        operationId: turnId,
      }, {
        record: (previous) => recordWorkoutTurn(
          command.message,
          clients,
          previous,
          true,
          actor.account_role === 'client',
        ),
        cancel: async (action) => {
          const actionId = action.id
          if (!actionId) return
          await withYandexActorSession(this.pool, session, async (client) => {
            const lifecycle = await client.query<ActionLifecycleRow>(`
              select status, version
              from public.assistant_actions
              where id = $1
            `, [actionId])
            const current = lifecycle[0]
            if (current === undefined || !['proposed', 'failed'].includes(current.status)) {
              throw new AssistantStateError('conflict')
            }
            await cancelAssistantAction(client, actionId, Number(current.version))
          })
        },
        program: (previous) => actor.account_role === 'client' && clients.length === 0
          ? Promise.resolve({ reply: 'Сначала заполните свою карточку в разделе «Кабинет», затем вернитесь к составлению программы.', action: null })
          : programPilotTurn(command.message, clients, previous, {
            actorId: actor.id,
            turnId,
            today,
            duplicateTurn: false,
            matchClients: (message) => {
              const matches = matchingSummaryClients(message, clients)
              return actor.account_role === 'client' && matches.length === 0 && clients.length === 1
                ? clients
                : matches
            },
            loadContext: (selected) => withYandexActorSession(this.pool, session, (client) =>
              loadDatabaseProgramContext(client, selected, today)),
            extract: (brief, message, answerContext) =>
              extractProgramBrief(brief, message, today, turnId, answerContext),
            generate: (brief, context, clientId) => {
              const key = programGenerationKey(actor.id, clientId, brief, context.fingerprint)
              return generateProgramOnce(
                databaseProgramGenerationJobs(this.pool, session),
                key,
                clientId,
                () => invokeProgramGenerator(actor.id, key, today, brief, context),
              )
            },
          }, true),
      })
    } else {
      const workoutDraft = recordWorkoutTurn(
        command.message,
        clients,
        history.find((row) => row.author === 'assistant')?.action,
        false,
        actor.account_role === 'client',
      )
      response = workoutDraft ?? {
        reply: assistantSmallTalkFallback(command.message),
        action: null,
      }
    }

    return withYandexActorSession(this.pool, session, (client) =>
      persistTurnResponse(client, command, turnId, response, randomUUID))
  }
}

function databaseProgramGenerationJobs(
  pool: DatabasePool,
  session: YandexActorSessionInput,
): ProgramGenerationJobStore {
  return {
    run: (args) => withYandexActorSession(pool, session, async (client) => {
      const rows = await client.query<JsonValueRow>(`
        select public.assistant_program_generation_job($1, $2, $3, $4::jsonb) result
      `, [args.id, args.clientId, args.leaseId,
        args.result === undefined ? null : JSON.stringify(args.result)])
      const value = rows[0]?.result
      if (typeof value !== 'object' || value === null || !('status' in value)
        || !['claimed', 'busy', 'complete'].includes(String(value.status))) {
        throw new Error('program_job_unavailable')
      }
      return value as ProgramGenerationJobState
    }),
    release: (args) => withYandexActorSession(pool, session, async (client) => {
      await client.query(
        'select public.release_assistant_program_generation_job($1, $2, $3)',
        [args.id, args.clientId, args.leaseId],
      )
    }),
  }
}
