import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const completionUrl = 'https://llm.api.cloud.yandex.net/foundationModels/v1/completion'
const releaseSha = process.env.RELEASE_SHA?.trim() || 'unknown'
const assistantSystemPrompt = 'Ты безопасный ассистент фитнес-приложения. Не ставь диагнозов и не давай опасных рекомендаций. Любое write-действие только как предложенная карточка с подтверждением; никогда не утверждай, что данные уже сохранены.'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const tools = ['record_workout', 'create_client_draft', 'create_program_draft', 'schedule_program', 'summarize_progress'] as const
type Tool = typeof tools[number]

export type AssistantTurnRequest = { conversationId: string; message: string; turnId?: string }
export type AssistantAction = { id?: string; tool: Tool; status: 'needs_input' | 'proposed'; title: string; description: string; payload: Record<string, unknown> }
export type AssistantTurnResponse = { reply: string; action: AssistantAction | null }

type AssistantCapability = { title: string; description: string }
type SummaryCandidate = { id: string; fullName: string }
type SummaryPeriod = { periodStart: string; periodEnd: string; label: string }
type ClientDraft = { fullName: string; gender?: 'male' | 'female' | undefined; ageYears?: number | undefined; heightCm?: number | undefined }

// Add a capability here only together with its implemented confirmation handler.
// This list is the sole source for answers about what the assistant can do.
const executableCapabilities: readonly AssistantCapability[] = [
  { title: 'Сформировать сводку прогресса', description: 'по завершённым тренировкам выбранного клиента за период' },
  { title: 'Создать карточку клиента', description: 'после уточнения данных и вашего подтверждения' },
  { title: 'Подготовить запись тренировки', description: 'для выбранного клиента и открыть её в существующем разборе упражнений' },
  { title: 'Подготовить программу тренировок', description: 'после анкеты и вашего подтверждения' },
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
  const clientId = actionRecord(actionRecord(value)?.payload)?.clientId
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
  const turnId = value.turn_id === undefined ? undefined : typeof value.turn_id === 'string' && UUID.test(value.turn_id) ? value.turn_id : undefined
  if (value.turn_id !== undefined && turnId === undefined) return undefined
  return { conversationId: value.conversation_id, ...(turnId === undefined ? {} : { turnId }), message }
}

export function isTurnIdReuse(existingContent: unknown, requestedContent: string): boolean {
  return typeof existingContent === 'string' && existingContent !== requestedContent
}

export function validateAssistantTurnResponse(value: unknown): AssistantTurnResponse | undefined {
  if (!record(value) || typeof value.reply !== 'string' || value.reply.trim().length === 0 || value.reply.length > 4_000) return undefined
  if (value.action === null) return { reply: value.reply.trim(), action: null }
  if (!record(value.action)) return undefined
  const { id, tool, status, title, description, payload } = value.action
  if (!tools.includes(tool as Tool) || (status !== 'needs_input' && status !== 'proposed') || typeof title !== 'string' || typeof description !== 'string' || !record(payload)) return undefined
  if (!title.trim() || !description.trim() || title.length > 200 || description.length > 1_000) return undefined
  if (status === 'proposed' && !validProposedPayload(tool as Tool, payload)) return undefined
  if (id !== undefined && (typeof id !== 'string' || !UUID.test(id))) return undefined
  return { reply: value.reply.trim(), action: { ...(id === undefined ? {} : { id }), tool: tool as Tool, status, title: title.trim(), description: description.trim(), payload } }
}

function validProposedPayload(tool: Tool, payload: Record<string, unknown>): boolean {
  if (tool === 'create_program_draft' || tool === 'schedule_program') return validProgramPayload(payload)
  if (tool === 'record_workout') return payload.step === 'confirm'
    && typeof payload.clientId === 'string' && UUID.test(payload.clientId)
    && typeof payload.clientName === 'string' && typeof payload.transcript === 'string'
    && payload.transcript.trim().length > 0 && payload.transcript.length <= 4_000
  if (tool === 'create_client_draft') return payload.step === 'confirm'
    && typeof payload.fullName === 'string' && payload.fullName.trim().length >= 2
    && (payload.gender === 'male' || payload.gender === 'female')
    && typeof payload.ageYears === 'number' && Number.isInteger(payload.ageYears) && payload.ageYears > 0 && payload.ageYears < 120
    && typeof payload.heightCm === 'number' && Number.isFinite(payload.heightCm) && payload.heightCm > 0 && payload.heightCm < 260
  if (tool === 'summarize_progress') return payload.step === 'confirm'
    && typeof payload.clientId === 'string' && UUID.test(payload.clientId)
    && typeof payload.periodStart === 'string' && typeof payload.periodEnd === 'string'
  return false
}

function validProgramPayload(payload: Record<string, unknown>): boolean {
  if (payload.step !== 'confirm' || typeof payload.clientId !== 'string' || !UUID.test(payload.clientId) || typeof payload.clientName !== 'string' || typeof payload.brief !== 'string' || !Array.isArray(payload.sessions)) return false
  return payload.sessions.length > 0 && payload.sessions.length <= 4 && payload.sessions.every((session) => {
    if (!record(session) || typeof session.title !== 'string' || typeof session.day !== 'string' || !Array.isArray(session.exercises)) return false
    return session.exercises.length > 0 && session.exercises.length <= 12 && session.exercises.every((exercise) => {
      if (!record(exercise) || typeof exercise.name !== 'string' || !exercise.name.trim() || (exercise.exerciseRef !== undefined && (typeof exercise.exerciseRef !== 'string' || !exercise.exerciseRef.trim())) || typeof exercise.sets !== 'number' || !Number.isInteger(exercise.sets) || exercise.sets < 1 || exercise.sets > 8) return false
      return ['reps', 'weightKg', 'durationMin', 'distanceKm'].every((field) => exercise[field] === undefined || (typeof exercise[field] === 'number' && Number.isFinite(exercise[field]) && exercise[field] > 0))
    })
  })
}

function isGeneratedProgramForSelectedClient(result: AssistantTurnResponse, generatedDraft: AssistantTurnResponse | undefined): boolean {
  const expected = actionRecord(generatedDraft?.action?.payload)
  const actual = actionRecord(result.action?.payload)
  return result.action?.tool === 'create_program_draft'
    && result.action.status === 'proposed'
    && expected?.step === 'generate'
    && actual?.step === 'confirm'
    && actual.clientId === expected.clientId
    && actual.clientName === expected.clientName
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

function workoutAction(title: string, description: string, status: AssistantAction['status'], payload: Record<string, unknown>): AssistantTurnResponse {
  return { reply: description, action: { tool: 'record_workout', status, title, description, payload } }
}

function programAction(title: string, description: string, status: AssistantAction['status'], payload: Record<string, unknown>): AssistantTurnResponse {
  return { reply: description, action: { tool: 'create_program_draft', status, title, description, payload } }
}

function isProgramRequest(message: string): boolean {
  const normalized = normalizeAssistantMessage(message)
  return ['состав', 'созда', 'подготов', 'сдела'].some((verb) => normalized.includes(verb))
    && ['программ', 'план трениров'].some((stem) => normalized.includes(stem))
}

/** Первые шаги программы намеренно детерминированы: модель получает только полный brief. */
export function createProgramTurn(message: string, clients: readonly ClientContextRow[], latestAction: unknown): AssistantTurnResponse | undefined {
  const previousAction = actionRecord(latestAction)
  const continuation = previousAction?.tool === 'create_program_draft'
  if (!isProgramRequest(message) && !continuation) return undefined
  if (continuation && isSummaryCancellation(message)) return { reply: 'Хорошо, создание программы отменено.', action: null }
  const payload = actionRecord(previousAction?.payload)
  const candidates = summaryCandidatesFromAction(latestAction)
  const selectedByNumber = normalizeAssistantMessage(message).match(/^(?:выбрать )?(\d{1,2})$/u)
  const numbered = selectedByNumber === null ? undefined : candidates[Number(selectedByNumber[1]) - 1]
  const matches = numbered === undefined ? matchingSummaryClients(message, clients) : clients.filter((client) => client.id === numbered.id)
  if (matches.length > 1) return programAction('Выберите клиента', 'Нашла несколько клиентов с таким именем. Выберите одного из списка.', 'needs_input', { step: 'client', candidates: matches.map(({ id, fullName }) => ({ id, fullName })) })
  const client = matches.length === 1 ? matches[0] : summaryClientFromAction(latestAction, clients)
  if (!client) return programAction('Уточните клиента', 'Для кого составить программу тренировок? Напишите имя или фамилию клиента.', 'needs_input', { step: 'client' })
  if (payload?.step !== 'brief') return programAction('Данные для программы', `Клиент: ${client.fullName}. Укажите опыт, ограничения и доступные дни. Цель из карточки: ${client.goal ?? 'не указана'}.`, 'needs_input', { step: 'brief', clientId: client.id, clientName: client.fullName, goal: client.goal })
  return programAction('Черновик программы', `Собрала данные для ${client.fullName}. Следующим шагом подготовлю программу на основе анкеты для проверки.`, 'proposed', { step: 'generate', clientId: client.id, clientName: client.fullName, goal: client.goal, brief: message.trim() })
}

function workoutCandidatesFromAction(value: unknown): SummaryCandidate[] {
  return summaryCandidatesFromAction(value)
}

function workoutTextProvided(message: string): boolean {
  const normalized = normalizeAssistantMessage(message)
  return /\d/u.test(normalized) || ['подход', 'жим', 'тяга', 'присед', 'выпад', 'планка', 'бег', 'тяг', 'разведен'].some((stem) => normalized.includes(stem))
}

function isWorkoutRecordRequest(message: string): boolean {
  const normalized = normalizeAssistantMessage(message)
  // «Подготовить запись тренировки» — такой же явный вход в существующий
  // разбор тренировки, как «записать» или «разобрать». Не отправляем его в
  // свободный LLM-диалог: сначала детерминированно уточняем клиента и текст.
  const asksToRecord = ['запиши', 'записать', 'зафиксируй', 'зафиксировать', 'разбери', 'разобрать', 'продиктуй', 'продиктовать'].some((verb) => normalized.includes(verb))
    || normalized.includes('подготов')
  return asksToRecord && ['тренировк', 'упражнен', 'подход', 'жим', 'тяга', 'присед', 'бег'].some((stem) => normalized.includes(stem))
}

/**
 * The assistant owns dialog and client selection; the existing Today flow owns
 * parsing, editing and saving the workout. This keeps the write path single.
 */
export function recordWorkoutTurn(
  message: string,
  clients: readonly ClientContextRow[],
  latestAction: unknown,
): AssistantTurnResponse | undefined {
  const previousAction = actionRecord(latestAction)
  const continuation = previousAction?.tool === 'record_workout'
  if (!isWorkoutRecordRequest(message) && !continuation) return undefined
  if (continuation && isSummaryCancellation(message)) return { reply: 'Хорошо, запись тренировки отменена.', action: null }

  const previousPayload = actionRecord(previousAction?.payload)
  const previousStep = previousPayload?.step
  const candidates = workoutCandidatesFromAction(latestAction)
  const selectedByNumber = normalizeAssistantMessage(message).match(/^(?:выбрать )?(\d{1,2})$/u)
  const numberedClient = selectedByNumber === null ? undefined : candidates[Number(selectedByNumber[1]) - 1]
  const matches = numberedClient === undefined
    ? matchingSummaryClients(message, clients)
    : clients.filter((client) => client.id === numberedClient.id)
  const selectedClient = matches.length === 1
    ? matches[0]
    : previousStep === 'workout' ? summaryClientFromAction(latestAction, clients) : undefined

  if (matches.length > 1) {
    return workoutAction('Выберите клиента', 'Нашла несколько клиентов с таким именем. Выберите одного из списка.', 'needs_input', {
      step: 'client', candidates: matches.map(({ id, fullName }) => ({ id, fullName })),
    })
  }
  if (!selectedClient) {
    return workoutAction('Уточните клиента', 'Для кого записать тренировку? Напишите имя или фамилию клиента.', 'needs_input', { step: 'client' })
  }
  if (!workoutTextProvided(message) || (previousStep === 'client' && !workoutTextProvided(message))) {
    return workoutAction('Продиктуйте тренировку', `Клиент: ${selectedClient.fullName}. Напишите или продиктуйте упражнения, подходы и значения.`, 'needs_input', {
      step: 'workout', clientId: selectedClient.id, clientName: selectedClient.fullName,
    })
  }
  return workoutAction('Тренировка готова к разбору', `Открою разбор тренировки для ${selectedClient.fullName}. Перед сохранением вы сможете проверить упражнения и значения.`, 'proposed', {
    step: 'confirm', clientId: selectedClient.id, clientName: selectedClient.fullName, transcript: message.trim(),
  })
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
    'Не ставь диагнозов и не давай опасных советов про боль, травмы, лекарства, голодание или экстремальные нагрузки. При боли или травме рекомендуй обратиться к врачу/специалисту.',
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

export function assistantModelMessages(prompt: string): Array<{ role: 'system' | 'user'; text: string }> {
  return [
    { role: 'system', text: assistantSystemPrompt },
    { role: 'user', text: prompt },
  ]
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

export async function runAssistantTurn(authorization: string, command: AssistantTurnRequest): Promise<AssistantTurnResponse> {
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
    .select('account_role').eq('id', user.id).maybeSingle()
  if (profileError) throw new HttpError(503, 'context_unavailable')
  if (profile?.account_role !== 'trainer') throw new HttpError(403, 'trainer_role_required')

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
    const result: AssistantTurnResponse = { reply: assistantCapabilitiesReply(), action: null }
    console.info('assistant_capabilities_reply_persisted', { operationId: turnId, releaseSha })
    return persistAssistantResponse(service, command.conversationId, turnId, result)
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
    console.info('assistant_client_draft_reply_persisted', { operationId: turnId, releaseSha, status: clientDraft.action?.status })
    return persistAssistantResponse(service, command.conversationId, turnId, clientDraft)
  }
  const workoutDraft = recordWorkoutTurn(command.message, clientRows, latestAssistantAction)
  if (workoutDraft !== undefined) {
    console.info('assistant_workout_draft_reply_persisted', { operationId: turnId, releaseSha, status: workoutDraft.action?.status })
    return persistAssistantResponse(service, command.conversationId, turnId, workoutDraft)
  }
  const programDraft = createProgramTurn(command.message, clientRows, latestAssistantAction)
  const programBriefReady = programDraft?.action?.tool === 'create_program_draft' && programDraft.action.payload.step === 'generate'
  if (programDraft !== undefined && !programBriefReady) {
    return persistAssistantResponse(service, command.conversationId, turnId, programDraft)
  }
  const summary = summaryTurn(command.message, clientRows, latestAssistantAction, new Date())
  if (summary !== undefined) {
    console.info('assistant_summary_flow_reply_persisted', { operationId: turnId, releaseSha, status: summary.action?.status })
    return persistAssistantResponse(service, command.conversationId, turnId, summary)
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
        completionOptions: { stream: false, temperature: 0.2, maxTokens: (allowsAssistantAction(command.message) || programBriefReady) ? '1200' : '120' }, jsonSchema: { schema },
        messages: assistantModelMessages(`${modelPrompt(history, clientContext, progressContext, !(allowsAssistantAction(command.message) || programBriefReady), usesInformalAddress(command.message))}${programBriefReady ? `\n\nСформируй именно action=create_program_draft, status=proposed. В payload обязательно верни step=confirm, clientId, clientName, goal, brief и sessions: массив до 4 тренировок с полями title, day, exercises. Каждое exercises — объект {name, exerciseRef?, sets, reps?, weightKg?, durationMin?, distanceKm?}. Если у тебя есть канонический exerciseRef, верни его и не выдумывай ref; UI дополнительно проверит его по каталогу. name — понятное название упражнения; sets — целое 1..8. Для силовых обязательно указывай reps, вес добавляй только если он обоснован. Для кардио укажи durationMin или distanceKm. Не утверждай, что программа сохранена.` : ''}`),
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
  // The deterministic dialog owns the target client. The model only fills in
  // sessions and may not switch a confirmed program to another client.
  if (programBriefReady && !isGeneratedProgramForSelectedClient(modelResult, programDraft)) {
    throw new HttpError(502, 'orchestrator_invalid_response')
  }
  const result = allowsAssistantAction(command.message) || programBriefReady
    ? modelResult
    : { ...modelResult, action: null }
  if (modelResult.action !== null && result.action === null) console.info('assistant_action_suppressed_for_small_talk')
  console.info('assistant_turn_persisted', { operationId: turnId, releaseSha, hasAction: result.action !== null })
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
    const result = await runAssistantTurn(authorization, command)
    console.info('assistant_orchestrator_succeeded', { operationId: command.turnId ?? 'generated', releaseSha, hasAction: result.action !== null })
    return Response.json(result)
  } catch (error) {
    const known = error instanceof HttpError ? error : new HttpError(502, 'orchestrator_failed')
    console.warn('assistant_orchestrator_failed', { operationId, releaseSha, status: known.status, code: known.code })
    return Response.json({ error: known.code }, { status: known.status })
  }
}
