import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { readAssistantTurnRequest, type AssistantTurnRequest } from '../assistant-state-request.js'
import {
  HttpError,
  assistantCapabilitiesReply,
  clientContextRows,
  completeAssistantSmallTalk,
  isAssistantCapabilityQuestion,
  isTurnIdReuse,
  matchingSummaryClients,
  record,
  recordWorkoutTurn,
  releaseSha,
  required,
  validateAssistantTurnResponse,
  type AssistantTurnResponse,
  type ClientContextRow,
} from './core.js'
import { generateProgramOnce, programGenerationKey, supabaseProgramGenerationJobs } from './program/job.js'
import { isProgramEnabled } from './program/model.js'
import { loadProgramContext } from './program/source.js'
import {
  extractProgramBrief,
  invokeProgramGenerator,
  programPilotTurn,
  reusableProgramContinuation,
} from './program/turn.js'
import {
  assistantToolStateFilter,
  isAssistantChatPrompt,
  latestActiveAssistantTool,
  routedAssistantTurn,
} from './router.js'
export {
  allowsAssistantAction,
  assistantCapabilitiesReply,
  assistantModelMessages,
  assistantSmallTalkFallback,
  assistantSmallTalkPrompt,
  completeAssistantSmallTalk,
  createClientTurn,
  createProgramTurn,
  extractWorkoutTranscript,
  isAssistantCapabilityQuestion,
  isSummaryCancellation,
  isSummaryRequest,
  isTurnIdReuse,
  matchingSummaryClients,
  readAssistantTurnRequest,
  recordWorkoutTurn,
  summaryPeriodFromMessage,
  summaryTurn,
  usesInformalAddress,
  validateAssistantTurnResponse,
  validateEnabledAssistantTurnResponse,
  type AssistantAction,
  type AssistantTurnResponse,
  type ClientDraft,
} from './core.js'


export async function loadAssistantClientContext(actorClient: SupabaseClient): Promise<ClientContextRow[]> {
  const result: unknown = await actorClient.rpc('list_clients', { p_include_archived: false })
  if (!record(result) || result.error) throw new HttpError(503, 'context_unavailable')
  return clientContextRows(result.data)
}

export async function loadAssistantSelfClientContext(actorClient: SupabaseClient): Promise<ClientContextRow[]> {
  const result: unknown = await actorClient.rpc('get_my_client')
  if (!record(result) || result.error) throw new HttpError(503, 'context_unavailable')
  return clientContextRows(result.data)
}

type AssistantService = SupabaseClient

function responseFromStoredMessage(value: unknown): AssistantTurnResponse | undefined {
  if (!record(value) || typeof value.content !== 'string') return undefined
  const parsed = value.action === null || value.action === undefined
    ? null
    : validateAssistantTurnResponse({ reply: value.content, action: value.action })?.action ?? null
  return { reply: value.content, action: parsed }
}

async function persistAssistantResponse(
  service: AssistantService,
  conversationId: string,
  turnId: string,
  result: AssistantTurnResponse,
): Promise<AssistantTurnResponse> {
  const action = result.action === null || result.action.status === 'needs_input'
    ? result.action
    : { ...result.action, id: crypto.randomUUID() }
  const response: AssistantTurnResponse = { reply: result.reply, action }
  const persisted = await service.rpc('persist_assistant_response', {
    p_conversation_id: conversationId,
    p_turn_id: turnId,
    p_content: response.reply,
    p_action: response.action,
  })
  if (persisted.error) throw new HttpError(503, 'history_unavailable')
  const persistedData = persisted.data as unknown
  if (record(persistedData) && persistedData.deduplicated === true) {
    const stored = responseFromStoredMessage(persistedData)
    if (stored === undefined) throw new HttpError(503, 'history_unavailable')
    return stored
  }
  return response
}

export async function runAssistantTurn(
  authorization: string,
  command: AssistantTurnRequest,
  invocationId: string | null = null,
): Promise<AssistantTurnResponse> {
  const actorClient = createClient(required('SUPABASE_URL'), required('SUPABASE_PUBLISHABLE_KEY'), { global: { headers: { Authorization: authorization } } })
  const { data: { user } } = await actorClient.auth.getUser()
  if (!user) throw new HttpError(401, 'authentication_required')
  const service = createClient(required('SUPABASE_URL'), required('SUPABASE_SERVICE_ROLE_KEY'))
  const turnId = command.turnId ?? crypto.randomUUID()
  console.info('assistant_turn_started', { operationId: turnId, releaseSha })
  const { data: conversation, error: conversationError } = await service.from('assistant_conversations')
    .select('id,owner_id').eq('id', command.conversationId).maybeSingle()
  if (conversationError) throw new HttpError(503, 'history_unavailable')
  if (!conversation || conversation.owner_id !== user.id) throw new HttpError(404, 'conversation_not_found')

  const { data: profile, error: profileError } = await service.from('profiles')
    .select('account_role,timezone').eq('id', user.id).maybeSingle()
  if (profileError) throw new HttpError(503, 'context_unavailable')
  const profileRecord = record(profile) ? profile : null
  const accountRole: unknown = profileRecord?.account_role
  if (accountRole !== 'trainer' && accountRole !== 'client') throw new HttpError(403, 'assistant_role_required')

  const { data: storedAssistant, error: storedAssistantError } = await service.from('assistant_messages')
    .select('content,action').eq('conversation_id', command.conversationId).eq('turn_id', turnId).eq('author', 'assistant').maybeSingle()
  if (storedAssistantError) throw new HttpError(503, 'history_unavailable')
  const storedResponse = responseFromStoredMessage(storedAssistant)
  if (storedResponse !== undefined) {
    const { data: existingUser, error: existingUserError } = await service.from('assistant_messages')
      .select('content').eq('conversation_id', command.conversationId).eq('turn_id', turnId).eq('author', 'user').maybeSingle()
    if (existingUserError) throw new HttpError(503, 'history_unavailable')
    if (!existingUser || typeof existingUser.content !== 'string') throw new HttpError(503, 'history_unavailable')
    if (isTurnIdReuse(existingUser.content, command.message)) throw new HttpError(409, 'turn_id_reused')
    return storedResponse
  }

  const userInsert = await service.from('assistant_messages').insert({ conversation_id: command.conversationId, turn_id: turnId, author: 'user', content: command.message })
  if (userInsert.error) {
    // A retry after a crash between the user insert and response persistence
    // reuses the existing user turn. The persistence RPC deduplicates the
    // assistant row, so concurrent retries cannot create duplicate messages.
    if (userInsert.error.code !== '23505') throw new HttpError(503, 'history_unavailable')
    const { data: existingUser, error: existingUserError } = await service.from('assistant_messages')
      .select('content').eq('conversation_id', command.conversationId).eq('turn_id', turnId).eq('author', 'user').maybeSingle()
    if (existingUserError) throw new HttpError(503, 'history_unavailable')
    if (isTurnIdReuse(existingUser?.content, command.message)) throw new HttpError(409, 'turn_id_reused')
  }
  if (isAssistantCapabilityQuestion(command.message)) {
    const result: AssistantTurnResponse = { reply: assistantCapabilitiesReply({ programEnabled: isProgramEnabled(user.id) }), action: null }
    console.info('assistant_capabilities_reply_persisted', { operationId: turnId, releaseSha })
    return persistAssistantResponse(service, command.conversationId, turnId, result)
  }

  // Use the same actor-scoped source as the Clients screen. A direct
  // clients.trainer_id filter misses clients connected through
  // client_trainers and also loses the trainer-specific alias.
  const clientRows = accountRole === 'client'
    ? await loadAssistantSelfClientContext(actorClient)
    : await loadAssistantClientContext(actorClient)
  const { data: rows, error: historyError } = await service.from('assistant_messages')
    .select('author,content,action').eq('conversation_id', command.conversationId).order('created_at', { ascending: false }).order('id', { ascending: false }).limit(20)
  if (historyError) throw new HttpError(503, 'history_unavailable')
  const latestAssistantAction: unknown = (rows ?? []).find((row) => row.author === 'assistant')?.action
  const reusableProgram = reusableProgramContinuation(command.message, rows ?? [])
  const history = [...(rows ?? [])].reverse().flatMap((row): { author: string; content: string }[] =>
    typeof row.author === 'string' && typeof row.content === 'string' ? [{ author: row.author, content: row.content.slice(0, 1_000) }] : [])
  if (isProgramEnabled(user.id)) {
    // Ordinary conversation must not evict an unfinished tool from the short
    // model-history window. Read only its latest state or cancellation boundary.
    const state = await service.from('assistant_messages').select('author,content,action')
      .eq('conversation_id', command.conversationId).eq('author', 'assistant').or(assistantToolStateFilter)
      .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(1).maybeSingle()
    if (state.error) throw new HttpError(503, 'history_unavailable')
    let active = latestActiveAssistantTool(state.data ? [state.data] : [])
    if (active?.id) {
      const lifecycle = await service.from('assistant_actions').select('status,version').eq('id', active.id).eq('owner_id', user.id).maybeSingle()
      if (lifecycle.error) throw new HttpError(503, 'history_unavailable')
      if (!lifecycle.data) throw new HttpError(503, 'history_unavailable')
      if (lifecycle.data.status === 'applied' || lifecycle.data.status === 'cancelled') active = null
    }
    const today = new Date().toLocaleDateString('en-CA', { timeZone: typeof profileRecord?.timezone === 'string' ? profileRecord.timezone : 'Europe/Moscow' })
    // An explicit "continue unchanged" selection deliberately replaces a
    // newer partial questionnaire with the last confirmed course.
    const activeTool = reusableProgram ?? active
    if (!isAssistantChatPrompt(command.message, activeTool)) {
      const routed = await routedAssistantTurn({ message: command.message, history, active: activeTool, operationId: turnId }, {
        record: (previous) => recordWorkoutTurn(command.message, clientRows, previous, true, accountRole === 'client'),
        cancel: async (action) => {
          if (!action.id) return
          const lifecycle = await service.from('assistant_actions').select('status,version').eq('id', action.id).eq('owner_id', user.id).maybeSingle()
          if (lifecycle.error) throw new HttpError(503, 'history_unavailable')
          const version: unknown = lifecycle.data?.version
          if (typeof version !== 'number' || !['proposed', 'failed'].includes(String(lifecycle.data?.status))) throw new HttpError(409, 'assistant_action_conflict')
          const cancelled = await actorClient.rpc('cancel_assistant_action', { p_action_id: action.id, p_expected_version: version })
          if (cancelled.error) throw new HttpError(409, 'assistant_action_conflict')
        },
        program: (previous) => accountRole === 'client' && clientRows.length === 0
          ? Promise.resolve({ reply: 'Сначала заполните свою карточку в разделе «Кабинет», затем вернитесь к составлению программы.', action: null })
          : programPilotTurn(command.message, clientRows, previous ?? reusableProgram, {
            actorId: user.id, turnId, today, duplicateTurn: userInsert.error?.code === '23505',
            matchClients: (message) => {
              const matches = matchingSummaryClients(message, clientRows)
              return accountRole === 'client' && matches.length === 0 && clientRows.length === 1 ? clientRows : matches
            },
            loadContext: (client) => loadProgramContext(actorClient, client, today),
            extract: (brief, message, answerContext) => extractProgramBrief(brief, message, today, turnId, answerContext),
            generate: (brief, context, clientId) => {
              const key = programGenerationKey(user.id, clientId, brief, context.fingerprint)
              return generateProgramOnce(supabaseProgramGenerationJobs(service, user.id), key, clientId,
                () => invokeProgramGenerator(user.id, key, today, brief, context))
            },
          }, true),
      })
      return persistAssistantResponse(service, command.conversationId, turnId, routed)
    }
  }
  const workoutDraft = recordWorkoutTurn(
    command.message,
    clientRows,
    latestAssistantAction,
    false,
    accountRole === 'client',
  )
  if (workoutDraft !== undefined) {
    const clientCardMissing = accountRole === 'client'
      && clientRows.length === 0
      && workoutDraft.action?.tool === 'record_workout'
    const response = clientCardMissing
      ? { reply: 'Сначала заполните свою карточку в разделе «Кабинет», затем вернитесь к записи тренировки.', action: null }
      : workoutDraft
    console.info('assistant_workout_draft_reply_persisted', { operationId: turnId, releaseSha, status: workoutDraft.action?.status })
    return persistAssistantResponse(service, command.conversationId, turnId, response)
  }
  const result = await completeAssistantSmallTalk(command.message, history, {
    invocationId: invocationId ?? turnId,
  })
  console.info('assistant_small_talk_reply_persisted', { operationId: turnId, releaseSha })
  return persistAssistantResponse(service, command.conversationId, turnId, result)
}

export async function assistantOrchestrator(request: Request): Promise<Response> {
  let operationId = 'unknown'
  try {
    const authorization = request.headers.get('authorization')
    if (!authorization?.startsWith('Bearer ')) throw new HttpError(401, 'authentication_required')
    const command = readAssistantTurnRequest(await request.json())
    if (!command) throw new HttpError(400, 'invalid_assistant_request')
    operationId = command.turnId ?? 'generated'
    const result = await runAssistantTurn(
      authorization,
      command,
      request.headers.get('x-yc-request-id'),
    )
    console.info('assistant_orchestrator_succeeded', { operationId: command.turnId ?? 'generated', releaseSha, hasAction: result.action !== null })
    return Response.json(result)
  } catch (error) {
    const known = error instanceof HttpError ? error : new HttpError(502, 'orchestrator_failed')
    console.warn('assistant_orchestrator_failed', { operationId, releaseSha, status: known.status, code: known.code })
    return Response.json({ error: known.code }, { status: known.status })
  }
}
