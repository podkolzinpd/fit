import { createClient } from '@supabase/supabase-js'

const completionUrl = 'https://llm.api.cloud.yandex.net/foundationModels/v1/completion'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const tools = ['record_workout', 'create_client_draft', 'create_program_draft', 'schedule_program', 'summarize_progress'] as const
type Tool = typeof tools[number]

export type AssistantTurnRequest = { conversationId: string; message: string }
export type AssistantAction = { tool: Tool; status: 'needs_input' | 'proposed'; title: string; description: string; payload: Record<string, unknown> }
export type AssistantTurnResponse = { reply: string; action: AssistantAction | null }

type AssistantCapability = { title: string; description: string }
type SummaryCandidate = { id: string; fullName: string }
type SummaryPeriod = { periodStart: string; periodEnd: string; label: string }
type ClientDraft = { fullName: string; gender?: 'male' | 'female' | undefined; ageYears?: number | undefined; heightCm?: number | undefined }

// Add a capability here only together with its implemented confirmation handler.
// This list is the sole source for answers about what the assistant can do.
const executableCapabilities: readonly AssistantCapability[] = [
  { title: 'Сформировать сводку прогресса', description: 'по завершённым тренировкам выбранного клиента за период' },
]

class HttpError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code) }
}

const schema = {
  type: 'object', additionalProperties: false, required: ['reply', 'action'], properties: {
    reply: { type: 'string' },
    action: {
      anyOf: [
        { type: 'null' },
        { type: 'object', additionalProperties: false, required: ['tool', 'status', 'title', 'description', 'payload'], properties: {
          tool: { type: 'string', enum: tools }, status: { type: 'string', enum: ['needs_input', 'proposed'] },
          title: { type: 'string' }, description: { type: 'string' }, payload: { type: 'object' },
        } },
      ],
    },
  },
}

function required(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new HttpError(503, 'service_unavailable')
  return value
}

async function yandexIamToken(): Promise<string> {
  let response: Response
  try {
    response = await fetch('http://169.254.169.254/computeMetadata/v1/instance/service-accounts/default/token', {
      headers: { 'Metadata-Flavor': 'Google' },
    })
  } catch {
    throw new HttpError(503, 'orchestrator_auth_unavailable')
  }
  if (!response.ok) throw new HttpError(503, 'orchestrator_auth_unavailable')
  const body = await response.json() as { access_token?: unknown }
  if (typeof body.access_token !== 'string' || !body.access_token) throw new HttpError(503, 'orchestrator_auth_unavailable')
  return body.access_token
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

type ClientContextRow = {
  id: string
  fullName: string
  goal: string | null
  ageYears: number | null
  heightCm: number | string | null
  gender: string | null
}

type ProgressContextRow = {
  clientId: string
  periodStart: string
  periodEnd: string
  summary: string
}

function clientContextRows(value: unknown): ClientContextRow[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((row): ClientContextRow[] => {
    if (!record(row) || typeof row.id !== 'string' || typeof row.full_name !== 'string') return []
    return [{
      id: row.id,
      fullName: row.full_name,
      goal: typeof row.goal === 'string' ? row.goal : null,
      ageYears: typeof row.age_years === 'number' ? row.age_years : null,
      heightCm: typeof row.height_cm === 'number' || typeof row.height_cm === 'string' ? row.height_cm : null,
      gender: typeof row.gender === 'string' ? row.gender : null,
    }]
  })
}

function progressContextRows(value: unknown): ProgressContextRow[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((row): ProgressContextRow[] => {
    if (
      !record(row)
      || typeof row.client_id !== 'string'
      || typeof row.period_start !== 'string'
      || typeof row.period_end !== 'string'
      || typeof row.summary !== 'string'
    ) return []
    return [{
      clientId: row.client_id,
      periodStart: row.period_start,
      periodEnd: row.period_end,
      summary: row.summary,
    }]
  })
}

function actionRecord(value: unknown): Record<string, unknown> | undefined {
  return record(value) ? value : undefined
}

function summaryCandidatesFromAction(value: unknown): SummaryCandidate[] {
  const candidates = actionRecord(value)?.candidates
  if (!Array.isArray(candidates)) return []
  return candidates.flatMap((candidate): SummaryCandidate[] =>
    record(candidate) && typeof candidate.id === 'string' && typeof candidate.fullName === 'string'
      ? [{ id: candidate.id, fullName: candidate.fullName }]
      : [])
}

function summaryClientFromAction(value: unknown, clients: readonly ClientContextRow[]): ClientContextRow | undefined {
  const clientId = actionRecord(value)?.clientId
  return typeof clientId === 'string' ? clients.find((client) => client.id === clientId) : undefined
}

function matchingSummaryClients(message: string, clients: readonly ClientContextRow[]): ClientContextRow[] {
  const ignored = new Set(['сводка', 'прогресс', 'динамика', 'сделай', 'сделать', 'покажи', 'показать', 'за', 'для', 'клиента'])
  const words = normalizeAssistantMessage(message).split(' ').filter((word) => word.length >= 3 && !ignored.has(word))
  if (words.length === 0) return []
  return clients.filter((client) => {
    const clientWords = normalizeAssistantMessage(client.fullName).split(' ').filter((word) => word.length >= 3)
    return clientWords.some((clientWord) => words.some((word) => word.startsWith(clientWord) || clientWord.startsWith(word)))
  })
}

function summaryAction(title: string, description: string, status: AssistantAction['status'], payload: Record<string, unknown>): AssistantTurnResponse {
  return { reply: description, action: { tool: 'summarize_progress', status, title, description, payload } }
}

export function isSummaryCancellation(message: string): boolean {
  const normalized = normalizeAssistantMessage(message)
  return ['отмена', 'отменить', 'не надо', 'стоп', 'закрыть', 'выход'].some((value) => normalized === value || normalized.startsWith(`${value} `))
}

export function summaryTurn(
  message: string,
  clients: readonly ClientContextRow[],
  latestAction: unknown,
  now: Date,
): AssistantTurnResponse | undefined {
  const previousAction = actionRecord(latestAction)
  if (previousAction?.tool === 'summarize_progress' && isSummaryCancellation(message)) {
    return { reply: 'Хорошо, сценарий формирования сводки отменён.', action: null }
  }

  const previousPayload = actionRecord(previousAction?.payload)
  const previousStep = previousPayload?.step
  const period = summaryPeriodFromMessage(message, now)

  const previousCandidates = summaryCandidatesFromAction(latestAction)
  const selectedByNumber = normalizeAssistantMessage(message).match(/^(?:выбрать )?(\d{1,2})$/u)
  const numberedClient = selectedByNumber === null ? undefined : previousCandidates[Number(selectedByNumber[1]) - 1]
  const matches = numberedClient === undefined
    ? matchingSummaryClients(message, clients)
    : clients.filter((client) => client.id === numberedClient.id)
  const continuation = previousAction?.tool === 'summarize_progress' && (
    (previousStep === 'client' && matches.length > 0)
    || (previousStep === 'period' && period !== undefined)
  )
  if (!isSummaryRequest(message) && !continuation) return undefined
  const selectedClient = matches.length === 1
    ? matches[0]
    : continuation ? summaryClientFromAction(latestAction, clients) : undefined

  if (matches.length > 1) {
    const candidates = matches.map(({ id, fullName }) => ({ id, fullName }))
    return summaryAction('Выберите клиента', 'Нашла несколько клиентов с таким именем. Выберите одного из списка.', 'needs_input', { step: 'client', candidates })
  }
  if (!selectedClient) {
    return summaryAction('Уточните клиента', 'Для кого сформировать сводку прогресса? Напишите имя или фамилию клиента.', 'needs_input', { step: 'client' })
  }

  if (!period) {
    return summaryAction('Выберите период', `Клиент: ${selectedClient.fullName}. За какой период сформировать сводку?`, 'needs_input', {
      step: 'period', clientId: selectedClient.id, clientName: selectedClient.fullName,
      options: ['последние 7 дней', 'последние 30 дней', 'последние 90 дней'],
    })
  }
  return summaryAction('Сводка прогресса готова к запуску', `Сформирую сводку для ${selectedClient.fullName} за ${period.label}.`, 'proposed', {
    step: 'confirm', clientId: selectedClient.id, clientName: selectedClient.fullName,
    periodStart: period.periodStart, periodEnd: period.periodEnd, periodLabel: period.label, force: false,
  })
}

export function readAssistantTurnRequest(value: unknown): AssistantTurnRequest | undefined {
  if (!record(value) || typeof value.conversation_id !== 'string' || typeof value.message !== 'string') return undefined
  const message = value.message.trim()
  if (!UUID.test(value.conversation_id) || message.length === 0 || message.length > 4_000) return undefined
  return { conversationId: value.conversation_id, message }
}

export function validateAssistantTurnResponse(value: unknown): AssistantTurnResponse | undefined {
  if (!record(value) || typeof value.reply !== 'string' || value.reply.trim().length === 0 || value.reply.length > 4_000) return undefined
  if (value.action === null) return { reply: value.reply.trim(), action: null }
  if (!record(value.action)) return undefined
  const { tool, status, title, description, payload } = value.action
  if (!tools.includes(tool as Tool) || (status !== 'needs_input' && status !== 'proposed') || typeof title !== 'string' || typeof description !== 'string' || !record(payload)) return undefined
  if (!title.trim() || !description.trim() || title.length > 200 || description.length > 1_000) return undefined
  return { reply: value.reply.trim(), action: { tool: tool as Tool, status, title: title.trim(), description: description.trim(), payload } }
}

export function allowsAssistantAction(message: string): boolean {
  const normalized = normalizeAssistantMessage(message)
  const words = normalized.split(' ')
  const command = words.some((word) => [
    'добавь', 'добавить', 'создай', 'создать', 'заведи', 'завести', 'составь', 'составить',
    'запиши', 'записать', 'зафиксируй', 'зафиксировать', 'назначь', 'назначить',
    'запланируй', 'запланировать', 'покажи', 'сформируй', 'сформировать', 'подготовь', 'подготовить',
  ].includes(word))
  const applicationObject = words.some((word) => [
    'клиент', 'тренировк', 'программ', 'план', 'расписани', 'прогресс', 'сводк', 'подход', 'упражнен',
  ].some((stem) => word.startsWith(stem)))
  return command && applicationObject
}

function normalizeAssistantMessage(message: string): string {
  return message
    .toLocaleLowerCase('ru-RU')
    .replaceAll('ё', 'е')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

export function isAssistantCapabilityQuestion(message: string): boolean {
  const normalized = normalizeAssistantMessage(message)
  const asksQuestion = normalized.includes('что') || normalized.includes('какие') || normalized.includes('чем') || normalized.includes('как')
  const asksAboutCapabilities = ['уме', 'мож', 'функц', 'возможност', 'помощ'].some((stem) => normalized.includes(stem))
  return asksQuestion && asksAboutCapabilities
}

export function isSummaryRequest(message: string): boolean {
  const normalized = normalizeAssistantMessage(message)
  return ['сводк', 'прогресс', 'динамик'].some((stem) => normalized.includes(stem))
}

function isCreateClientRequest(message: string): boolean {
  const normalized = normalizeAssistantMessage(message)
  return /(?:добав|созда|завед|нов).{0,24}клиент/u.test(normalized)
}

function clientDraftFromAction(value: unknown): ClientDraft | undefined {
  const payload = actionRecord(value)
  if (!payload || typeof payload.fullName !== 'string') return undefined
  return {
    fullName: payload.fullName,
    gender: payload.gender === 'male' || payload.gender === 'female' ? payload.gender : undefined,
    ageYears: typeof payload.ageYears === 'number' ? payload.ageYears : undefined,
    heightCm: typeof payload.heightCm === 'number' ? payload.heightCm : undefined,
  }
}

function clientDraftFromMessage(message: string, previous: ClientDraft): ClientDraft {
  const normalized = normalizeAssistantMessage(message)
  const age = normalized.match(/(?:^|\s)(\d{1,3})\s*(?:лет|год|года)(?:\s|$)/u)
  const height = normalized.match(/(?:рост\s*)?(\d{2,3})\s*(?:см|сантиметр)/u)
  return {
    ...previous,
    gender: normalized.includes('жен') || /(?:^|\s)ж(?:\s|$)/u.test(normalized) ? 'female' : normalized.includes('муж') || /(?:^|\s)м(?:\s|$)/u.test(normalized) ? 'male' : previous.gender,
    ageYears: age === null ? previous.ageYears : Number(age[1]),
    heightCm: height === null ? previous.heightCm : Number(height[1]),
  }
}

function clientAction(title: string, description: string, status: AssistantAction['status'], payload: Record<string, unknown>): AssistantTurnResponse {
  return { reply: description, action: { tool: 'create_client_draft', status, title, description, payload } }
}

export function createClientTurn(message: string, latestAction: unknown): AssistantTurnResponse | undefined {
  const previousAction = actionRecord(latestAction)
  const continuation = previousAction?.tool === 'create_client_draft'
  if (!isCreateClientRequest(message) && !continuation) return undefined
  if (continuation && isSummaryCancellation(message)) return { reply: 'Хорошо, создание карточки клиента отменено.', action: null }
  if (!continuation) return clientAction('Новый клиент', 'Как зовут клиента?', 'needs_input', { step: 'name' })

  const previousPayload = actionRecord(previousAction?.payload)
  const previousStep = previousPayload?.step
  if (previousStep === 'name') {
    const fullName = message.trim()
    if (fullName.length < 2) return clientAction('Уточните имя', 'Напишите имя клиента, чтобы подготовить карточку.', 'needs_input', { step: 'name' })
    return clientAction('Данные клиента', `Укажите пол, возраст и рост для ${fullName}. Например: «женщина, 32 года, 168 см».`, 'needs_input', { step: 'profile', fullName })
  }

  const previousDraft = clientDraftFromAction(previousAction?.payload)
  if (!previousDraft) return clientAction('Новый клиент', 'Как зовут клиента?', 'needs_input', { step: 'name' })
  const draft = clientDraftFromMessage(message, previousDraft)
  const missing = [draft.gender === undefined ? 'пол' : undefined, draft.ageYears === undefined ? 'возраст' : undefined, draft.heightCm === undefined ? 'рост' : undefined].filter((value): value is string => value !== undefined)
  if (missing.length > 0) return clientAction('Данные клиента', `Для ${draft.fullName} осталось уточнить: ${missing.join(', ')}.`, 'needs_input', { step: 'profile', ...draft, missing })
  return clientAction('Карточка клиента готова', `Проверьте данные ${draft.fullName} и подтвердите создание карточки.`, 'proposed', { step: 'confirm', ...draft })
}

export function usesInformalAddress(message: string): boolean {
  const words = normalizeAssistantMessage(message).split(' ')
  return words.some((word) => ['ты', 'тебя', 'тебе', 'тебя', 'твой', 'твоя', 'твое', 'твои'].includes(word))
}

export function summaryPeriodFromMessage(message: string, now = new Date()): SummaryPeriod | undefined {
  const normalized = normalizeAssistantMessage(message)
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const range = (days: number, label: string): SummaryPeriod => {
    const start = new Date(end)
    start.setUTCDate(start.getUTCDate() - (days - 1))
    const date = (value: Date) => value.toISOString().slice(0, 10)
    return { periodStart: date(start), periodEnd: date(end), label }
  }
  const exact = normalized.match(/с (\d{4} \d{2} \d{2}) по (\d{4} \d{2} \d{2})/u)
  const [periodStartText, periodEndText] = exact?.slice(1) ?? []
  if (periodStartText !== undefined && periodEndText !== undefined) return { periodStart: periodStartText.replaceAll(' ', '-'), periodEnd: periodEndText.replaceAll(' ', '-'), label: `${periodStartText.replaceAll(' ', '.')}—${periodEndText.replaceAll(' ', '.')}` }
  if (normalized.includes('7 дней') || normalized.includes('недел')) return range(7, 'последние 7 дней')
  if (normalized.includes('90 дней') || normalized.includes('квартал')) return range(90, 'последние 90 дней')
  if (normalized.includes('30 дней') || normalized.includes('месяц')) return range(30, 'последние 30 дней')
  return undefined
}

export function assistantCapabilitiesReply(): string {
  if (executableCapabilities.length === 0) return 'Пока я не выполняю действий в приложении. Могу только коротко пообщаться.'
  return `Сейчас я могу:\n${executableCapabilities.map((capability) => `• ${capability.title} — ${capability.description}`).join('\n')}`
}

function modelPrompt(history: readonly { author: string; content: string }[], clientContext: string, progressContext: string, shortChat: boolean, informal: boolean): string {
  if (shortChat) return [
    'Ты дружелюбная, но очень краткая болталка фитнес-приложения. Отвечай по-русски не более чем двумя короткими предложениями.',
    `Обращайся к пользователю на ${informal ? 'ты' : 'вы'}.`,
    'Всегда возвращай action=null. Не перечисляй функции приложения и не обещай выполнить действие.',
    `Недавняя история:\n${history.slice(-6).map((entry) => `${entry.author === 'user' ? 'Пользователь' : 'Ассистент'}: ${entry.content}`).join('\n')}`,
  ].join('\n\n')
  return [
    'Ты ассистент фитнес-приложения. Отвечай по-русски, кратко и доброжелательно.',
    `Обращайся к пользователю на ${informal ? 'ты' : 'вы'}.`,
    'Возвращай action=null по умолчанию: для приветствий, разговорных реплик, вопросов о твоих возможностях и любых общих вопросов. Карточка действия допустима только когда пользователь явно просит выполнить или подготовить конкретную функцию приложения.',
    'Ты можешь только уточнить запрос или предложить одно типизированное действие из schema. Никогда не утверждай, что запись уже создана, тренировка сохранена или расписание изменено.',
    'Для программы сначала собери цель, опыт, ограничения и доступные дни. Не давай медицинских диагнозов; при рисках направляй к специалисту.',
    'Для write-действия верни status=needs_input или proposed. Сводка прогресса — read-only. Не выдумывай факты о клиенте.',
    `Доступные клиенты тренера (используй только эти факты):\n${clientContext || 'Нет доступных клиентов.'}`,
    `Последние готовые сводки прогресса (если их нет — предложи сформировать сводку, не выдумывай выводы):\n${progressContext || 'Нет готовых сводок.'}`,
    `История:\n${history.map((entry) => `${entry.author === 'user' ? 'Пользователь' : 'Ассистент'}: ${entry.content}`).join('\n')}`,
  ].join('\n\n')
}

export async function runAssistantTurn(authorization: string, command: AssistantTurnRequest): Promise<AssistantTurnResponse> {
  const actorClient = createClient(required('SUPABASE_URL'), required('SUPABASE_PUBLISHABLE_KEY'), { global: { headers: { Authorization: authorization } } })
  const { data: { user } } = await actorClient.auth.getUser()
  if (!user) throw new HttpError(401, 'authentication_required')
  const service = createClient(required('SUPABASE_URL'), required('SUPABASE_SERVICE_ROLE_KEY'))
  const { data: conversation, error: conversationError } = await service.from('assistant_conversations')
    .select('id,owner_id').eq('id', command.conversationId).maybeSingle()
  if (conversationError) throw new HttpError(503, 'history_unavailable')
  if (!conversation || conversation.owner_id !== user.id) throw new HttpError(404, 'conversation_not_found')

  const userInsert = await service.from('assistant_messages').insert({ conversation_id: command.conversationId, author: 'user', content: command.message })
  if (userInsert.error) throw new HttpError(503, 'history_unavailable')
  if (isAssistantCapabilityQuestion(command.message)) {
    const result: AssistantTurnResponse = { reply: assistantCapabilitiesReply(), action: null }
    const { data: assistantMessage, error: assistantInsertError } = await service.from('assistant_messages').insert({
      conversation_id: command.conversationId, author: 'assistant', content: result.reply, action: null,
    }).select('id').single()
    if (assistantInsertError || !assistantMessage?.id) throw new HttpError(503, 'history_unavailable')
    console.info('assistant_capabilities_reply_persisted')
    return result
  }

  const { data: clients, error: clientsError } = await service.from('clients')
    .select('id,full_name,goal,age_years,height_cm,gender').eq('trainer_id', user.id).is('archived_at', null).order('full_name').limit(50)
  if (clientsError) throw new HttpError(503, 'context_unavailable')
  const clientRows = clientContextRows(clients)
  const clientContext = clientRows.map((client) =>
    `${client.fullName} (id: ${client.id}; цель: ${client.goal ?? 'не указана'}; возраст: ${client.ageYears ?? 'не указан'}; рост: ${client.heightCm ?? 'не указан'}; пол: ${client.gender ?? 'не указан'})`,
  ).join('\n')
  const clientIds = clientRows.map((client) => client.id)
  const { data: summaries, error: summariesError } = clientIds.length === 0
    ? { data: [], error: null }
    : await service.from('client_training_summaries')
      .select('client_id,period_start,period_end,summary,generated_at')
      .eq('trainer_id', user.id).in('client_id', clientIds)
      .order('generated_at', { ascending: false }).limit(20)
  if (summariesError) throw new HttpError(503, 'context_unavailable')
  const namesById = new Map(clientRows.map((client) => [client.id, client.fullName]))
  const progressContext = progressContextRows(summaries).map((summary) =>
    `${namesById.get(summary.clientId) ?? summary.clientId}; ${summary.periodStart}—${summary.periodEnd}: ${summary.summary.slice(0, 1_500)}`,
  ).join('\n')

  const { data: rows, error: historyError } = await service.from('assistant_messages')
    .select('author,content,action').eq('conversation_id', command.conversationId).order('created_at', { ascending: false }).order('id', { ascending: false }).limit(20)
  if (historyError) throw new HttpError(503, 'history_unavailable')
  const latestAssistantAction: unknown = (rows ?? []).find((row) => row.author === 'assistant')?.action
  const clientDraft = createClientTurn(command.message, latestAssistantAction)
  if (clientDraft !== undefined) {
    const { data: assistantMessage, error: assistantInsertError } = await service.from('assistant_messages').insert({
      conversation_id: command.conversationId, author: 'assistant', content: clientDraft.reply, action: clientDraft.action,
    }).select('id').single()
    if (assistantInsertError || !assistantMessage?.id) throw new HttpError(503, 'history_unavailable')
    console.info('assistant_client_draft_reply_persisted', { status: clientDraft.action?.status })
    return clientDraft
  }
  const summary = summaryTurn(command.message, clientRows, latestAssistantAction, new Date())
  if (summary !== undefined) {
    const { data: assistantMessage, error: assistantInsertError } = await service.from('assistant_messages').insert({
      conversation_id: command.conversationId, author: 'assistant', content: summary.reply, action: summary.action,
    }).select('id').single()
    if (assistantInsertError || !assistantMessage?.id) throw new HttpError(503, 'history_unavailable')
    console.info('assistant_summary_flow_reply_persisted', { status: summary.action?.status })
    return summary
  }
  const history = [...(rows ?? [])].reverse().flatMap((row): { author: string; content: string }[] =>
    typeof row.author === 'string' && typeof row.content === 'string' ? [{ author: row.author, content: row.content.slice(0, 4_000) }] : [])

  let response: Response
  try {
    const iamToken = await yandexIamToken()
    response = await fetch(completionUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${iamToken}` },
      body: JSON.stringify({
        modelUri: `gpt://${required('YANDEX_CLOUD_FOLDER_ID')}/${process.env.YANDEX_CLOUD_MODEL_ID ?? 'yandexgpt'}/latest`,
        completionOptions: { stream: false, temperature: 0.2, maxTokens: allowsAssistantAction(command.message) ? '1200' : '120' }, jsonSchema: { schema },
        messages: [{ role: 'user', text: modelPrompt(history, clientContext, progressContext, !allowsAssistantAction(command.message), usesInformalAddress(command.message)) }],
      }),
    })
  } catch (error) {
    if (error instanceof HttpError) throw error
    throw new HttpError(502, 'orchestrator_unavailable')
  }
  if (!response.ok) {
    console.warn('assistant_model_response_failed', { status: response.status })
    throw new HttpError(502, 'orchestrator_unavailable')
  }
  let raw: unknown
  try {
    const payload = await response.json() as { result?: { alternatives?: Array<{ message?: { text?: string } }> } }
    raw = JSON.parse(payload.result?.alternatives?.[0]?.message?.text ?? '')
  } catch {
    throw new HttpError(502, 'orchestrator_invalid_response')
  }
  const modelResult = validateAssistantTurnResponse(raw)
  if (!modelResult) throw new HttpError(502, 'orchestrator_invalid_response')
  const result = allowsAssistantAction(command.message)
    ? modelResult
    : { ...modelResult, action: null }
  if (modelResult.action !== null && result.action === null) console.info('assistant_action_suppressed_for_small_talk')
  const { data: assistantMessage, error: assistantInsertError } = await service.from('assistant_messages').insert({
    conversation_id: command.conversationId, author: 'assistant', content: result.reply, action: result.action,
  }).select('id').single()
  if (assistantInsertError || !assistantMessage?.id) throw new HttpError(503, 'history_unavailable')
  console.info('assistant_turn_persisted', { hasAction: result.action !== null })
  return result
}

export async function assistantOrchestrator(request: Request): Promise<Response> {
  try {
    const authorization = request.headers.get('authorization')
    if (!authorization?.startsWith('Bearer ')) throw new HttpError(401, 'authentication_required')
    const command = readAssistantTurnRequest(await request.json())
    if (!command) throw new HttpError(400, 'invalid_assistant_request')
    const result = await runAssistantTurn(authorization, command)
    console.info('assistant_orchestrator_succeeded', { hasAction: result.action !== null })
    return Response.json(result)
  } catch (error) {
    const known = error instanceof HttpError ? error : new HttpError(502, 'orchestrator_failed')
    console.warn('assistant_orchestrator_failed', { status: known.status, code: known.code })
    return Response.json({ error: known.code }, { status: known.status })
  }
}
