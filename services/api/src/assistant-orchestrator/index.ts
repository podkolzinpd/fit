import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const releaseSha = process.env.RELEASE_SHA?.trim() || 'unknown'
const assistantSystemPrompt = 'Ты безопасный ассистент фитнес-приложения. Не ставь диагнозов и не давай опасных рекомендаций. Любое write-действие только как предложенная карточка с подтверждением; никогда не утверждай, что данные уже сохранены.'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const tools = ['record_workout', 'create_client_draft', 'create_program_draft', 'schedule_program', 'summarize_progress'] as const
// The database/action RPCs intentionally retain the complete historical union.
// The chat surface is temporarily narrower: a new turn may only prepare a
// workout record. Keeping these as two lists prevents old history from being
// unreadable while making the runtime gate explicit.
const enabledTools = ['record_workout'] as const
type Tool = typeof tools[number]

export type AssistantTurnRequest = { conversationId: string; message: string; turnId?: string }
export type AssistantAction = { id?: string; tool: Tool; status: 'needs_input' | 'proposed'; title: string; description: string; payload: Record<string, unknown> }
export type AssistantTurnResponse = { reply: string; action: AssistantAction | null }

type AssistantCapability = { title: string; description: string }
type SummaryCandidate = { id: string; fullName: string }
type SummaryPeriod = { periodStart: string; periodEnd: string; label: string }
export type ClientDraft = {
  fullName?: string | undefined
  gender?: 'male' | 'female' | undefined
  ageYears?: number | undefined
  heightCm?: number | undefined
  goal?: string | undefined
  initialWeightKg?: number | undefined
}

// Add a capability here only together with its implemented confirmation handler.
// This list is the sole source for answers about what the assistant can do.
const executableCapabilities: readonly AssistantCapability[] = [
  { title: 'Подготовить запись тренировки', description: 'для выбранного клиента и открыть её в существующем разборе упражнений' },
]

const workoutOnlyReply = 'Сейчас в чате можно только добавить тренировку. Напишите «добавь тренировку» и укажите клиента, упражнения, подходы, повторы и вес.'

class HttpError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code) }
}

function required(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new HttpError(503, 'service_unavailable')
  return value
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

export function validateAssistantTurnResponse(value: unknown, allowedTools: readonly Tool[] = tools): AssistantTurnResponse | undefined {
  if (!record(value) || typeof value.reply !== 'string' || value.reply.trim().length === 0 || value.reply.length > 4_000) return undefined
  if (value.action === null) return { reply: value.reply.trim(), action: null }
  if (!record(value.action)) return undefined
  const { id, tool, status, title, description, payload } = value.action
  if (!allowedTools.includes(tool as Tool) || (status !== 'needs_input' && status !== 'proposed') || typeof title !== 'string' || typeof description !== 'string' || !record(payload)) return undefined
  if (!title.trim() || !description.trim() || title.length > 200 || description.length > 1_000) return undefined
  if (status === 'proposed' && !validProposedPayload(tool as Tool, payload)) return undefined
  if (id !== undefined && (typeof id !== 'string' || !UUID.test(id))) return undefined
  return { reply: value.reply.trim(), action: { ...(id === undefined ? {} : { id }), tool: tool as Tool, status, title: title.trim(), description: description.trim(), payload } }
}

/** Validation gate for new chat turns; legacy stored actions use the full union. */
export function validateEnabledAssistantTurnResponse(value: unknown): AssistantTurnResponse | undefined {
  return validateAssistantTurnResponse(value, enabledTools)
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
    && (payload.goal === undefined || (typeof payload.goal === 'string' && payload.goal.trim().length > 0 && payload.goal.length <= 200))
    && (payload.initialWeightKg === undefined || (typeof payload.initialWeightKg === 'number' && Number.isFinite(payload.initialWeightKg) && payload.initialWeightKg > 0 && payload.initialWeightKg < 1_000))
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

function extractClientName(message: string): string | undefined {
  const withoutCommand = message.trim()
    .replace(/^(?:добав(?:ь|ить)|созда(?:й|ть)|завед(?:и|ть))\s+(?:(?:мне|нам|нов\p{L}*|карточк\p{L}*)\s+){0,2}клиент\p{L}*\s*/iu, '')
    .replace(/^[\s,:;—-]+/u, '')
  const fieldStart = withoutCommand.search(/\s+(?:пол\b|женщин\p{L}*|мужчин\p{L}*|женск\p{L}*|мужск\p{L}*|[жм](?=\s|[,;:]|$)|возраст\b|рост\b|цель\b|начальн\p{L}*\s+вес\b|вес\b)/iu)
  const candidate = ((fieldStart < 0 ? withoutCommand : withoutCommand.slice(0, fieldStart))
    .split(/[;,]/u)[0] ?? '')
    .replace(/^(?:по имени|имя|клиент(?:а|ку)?(?: зовут)?)\s*[:—-]?\s*/iu, '')
    .replace(/^[\s,:;—-]+|[\s,:;—-]+$/gu, '')
    .trim()
  if (!candidate || /^(?:пол|женщин\p{L}*|мужчин\p{L}*|женск\p{L}*|мужск\p{L}*|возраст|рост|цель|вес)$/iu.test(candidate)) return undefined
  const words = candidate.split(/\s+/u)
  if (words.length > 3 || words.some((word) => !/^[\p{L}-]+$/u.test(word))) return undefined
  return candidate.length >= 2 ? candidate : undefined
}

function clientDraftFromAction(value: unknown): ClientDraft | undefined {
  const payload = actionRecord(value)
  if (!payload) return undefined
  const draft: ClientDraft = {
    fullName: typeof payload.fullName === 'string' ? payload.fullName : undefined,
    gender: payload.gender === 'male' || payload.gender === 'female' ? payload.gender : undefined,
    ageYears: typeof payload.ageYears === 'number' ? payload.ageYears : undefined,
    heightCm: typeof payload.heightCm === 'number' ? payload.heightCm : undefined,
    goal: typeof payload.goal === 'string' ? payload.goal : undefined,
    initialWeightKg: typeof payload.initialWeightKg === 'number' ? payload.initialWeightKg : undefined,
  }
  return draft.fullName !== undefined || draft.gender !== undefined || draft.ageYears !== undefined || draft.heightCm !== undefined || draft.goal !== undefined || draft.initialWeightKg !== undefined ? draft : undefined
}

function clientDraftFromMessage(message: string, previous: ClientDraft): ClientDraft {
  const normalized = normalizeAssistantMessage(message)
  const explicitAge = normalized.match(/возраст\s*[:—-]?\s*(\d{1,3})(?:\s|$)/u)
  const verbalAge = normalized.match(/(?:^|\s)(\d{1,3})\s*(?:лет|год|года)(?:\s|$)/u)
  const ageValue = explicitAge?.[1] ?? verbalAge?.[1]
  const explicitHeight = normalized.match(/рост\s*[:—-]?\s*(\d{2,3})(?:\s*(?:см|сантиметр\p{L}*))?(?:\s|$)/u)
  const heightWithUnit = normalized.match(/(\d{2,3})\s*(?:см|сантиметр\p{L}*)/u)
  const heightValue = explicitHeight?.[1] ?? heightWithUnit?.[1]
  const weight = normalized.match(/(?:начальн\w*\s+)?вес\s*[:—-]?\s*(\d{1,3}(?:[.,]\d+)?)\s*(?:кг|килограмм\w*)?/u)
  const goal = normalized.match(/(?:цель|хочу)\s*[:—-]?\s*(.+?)(?=\s*(?:[,;.]?\s*)(?:пол|женщин\p{L}*|мужчин\p{L}*|женск\p{L}*|мужск\p{L}*|возраст|рост|начальн\p{L}*\s+вес|вес)(?:\s|$)|$)/u)
  const parsedGoal = goal?.[1]?.trim().replace(/[.,;:]+$/u, '')
  return {
    ...previous,
    fullName: extractClientName(message) ?? previous.fullName,
    gender: /(?:женщин\p{L}*|женск\p{L}*|девушк\p{L}*|(?:^|\s)ж(?:\s|$))/u.test(normalized) ? 'female' : /(?:мужчин\p{L}*|мужск\p{L}*|парень|(?:^|\s)м(?:\s|$))/u.test(normalized) ? 'male' : previous.gender,
    ageYears: ageValue === undefined ? previous.ageYears : Number(ageValue),
    heightCm: heightValue === undefined ? previous.heightCm : Number(heightValue),
    goal: parsedGoal === undefined || parsedGoal.length === 0 ? previous.goal : parsedGoal,
    initialWeightKg: weight === null ? previous.initialWeightKg : Number((weight[1] ?? '0').replace(',', '.')),
  }
}

function clientDraftPayload(draft: ClientDraft): Record<string, unknown> {
  return Object.fromEntries(Object.entries(draft).filter(([, value]) => value !== undefined))
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

function isNonWorkoutRequest(message: string): boolean {
  const normalized = normalizeAssistantMessage(message)
  return ['клиент', 'программ', 'расписан', 'календар', 'сводк', 'прогресс', 'динамик'].some((stem) => normalized.includes(stem))
}

function isWorkoutCollectionComplete(message: string): boolean {
  const normalized = normalizeAssistantMessage(message)
  return [
    'готово', 'все', 'все готово', 'закончил', 'закончила', 'закончить',
    'перейти к разбору', 'разобрать тренировку', 'готово разобрать тренировку',
  ].includes(normalized)
}

function workoutTranscript(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function appendWorkoutFragment(transcript: string, fragment: string): string | undefined {
  const next = [transcript, fragment.trim()].filter(Boolean).join('\n')
  return next.length <= 4_000 ? next : undefined
}

function isWorkoutRecordCancellation(message: string): boolean {
  if (isSummaryCancellation(message)) return true
  const normalized = normalizeAssistantMessage(message)
  return /не\s+(?:надо|нужно|хочу)?\s*(?:добавля|занос|внос|запис|сохран|фиксир|отмеч|оформ|разбира|подготов|продикт)/u.test(normalized)
}

function isWorkoutRecordRequest(message: string): boolean {
  const normalized = normalizeAssistantMessage(message)
  if (isWorkoutRecordCancellation(message)) return false
  // These are deliberately broad Russian stems: the command is a natural
  // chat utterance, not a fixed button label. The object check keeps ordinary
  // uses of words such as «добавь» out of this flow.
  const asksToRecord = [
    'добав', 'занес', 'внес', 'запис', 'запиш', 'сохран', 'зафикс', 'фиксир', 'отмет',
    'оформ', 'разбер', 'разбира', 'подготов', 'продикт', 'заполн', 'собер', 'созда',
    'внесен', 'добавлен',
  ].some((stem) => normalized.split(' ').some((word) => word.startsWith(stem)))
  const workoutObject = ['тренировк', 'заняти', 'тренинг', 'упражнен', 'подход', 'сет', 'повтор', 'вес', 'нагруз', 'кардио', 'жим', 'тяга', 'присед', 'бег'].some((stem) => normalized.includes(stem))
  return asksToRecord && workoutObject
}

/** Remove a known client mention while retaining the original dictated text. */
function stripWorkoutClient(value: string, client: ClientContextRow): string {
  const clientWords = normalizeAssistantMessage(client.fullName).split(' ').filter(Boolean)
  if (!clientWords.length) return value
  const words = [...value.matchAll(/[\p{L}]+/gu)]
  for (let index = 0; index + clientWords.length <= words.length; index += 1) {
    const matches = clientWords.every((clientWord, offset) => {
      const actual = normalizeAssistantMessage(words[index + offset]?.[0] ?? '')
      return actual === clientWord || actual.startsWith(clientWord) || clientWord.startsWith(actual)
    })
    if (matches) {
      const start = words[index]?.index ?? 0
      const endWord = words[index + clientWords.length - 1]
      const end = (endWord?.index ?? value.length) + (endWord?.[0].length ?? 0)
      return `${value.slice(0, start)} ${value.slice(end)}`.replace(/\s+/gu, ' ').trim()
    }
  }
  return value
}

/** Remove only command framing; exercise names and their values stay intact. */
function stripWorkoutCommandPrefix(value: string): string {
  let result = value.trim().replace(/^[\s,:;—-]+|[\s,:;—-]+$/gu, '')
  result = result.replace(/^(?:(?:давай|можно|хочу|нужно|надо|пожалуйста)\s+)+/iu, '')
  result = result.replace(/^(?:добав\p{L}*|занес\p{L}*|внес\p{L}*|запис\p{L}*|запиш\p{L}*|сохран\p{L}*|зафикс\p{L}*|фиксир\p{L}*|отмет\p{L}*|оформ\p{L}*|разбер\p{L}*|подготов\p{L}*|продикт\p{L}*|заполн\p{L}*|собер\p{L}*|созда\p{L}*)\s+/iu, '')
  result = result.replace(/^(?:(?:мне|нам|сюда|сегодня|эту|этом)\s+)+/iu, '')
  result = result.replace(/^(?:запис\p{L}*|внесен\p{L}*|добавлен\p{L}*|факт)\s+/iu, '')
  result = result.replace(/^(?:тренировк\p{L}*|заняти\p{L}*|тренинг\p{L}*|упражнен\p{L}*|тренировочн\p{L}*)\s*/iu, '')
  result = result.replace(/^для\s+/iu, '')
  result = result.replace(/^(?:клиент\p{L}*|клиенту)\s*/iu, '')
  return result.replace(/^[\s,:;—-]+|[\s,:;—-]+$/gu, '').trim()
}

export function extractWorkoutTranscript(message: string, client?: ClientContextRow): string {
  let value = message.trim()
  const colon = value.indexOf(':')
  if (colon >= 0) value = value.slice(colon + 1)
  if (client) value = stripWorkoutClient(value, client)
  return stripWorkoutCommandPrefix(value)
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
  const previousPayload = actionRecord(previousAction?.payload)
  const previousStep = previousPayload?.step
  const previousWorkout = previousAction?.tool === 'record_workout'
  const explicitRequest = isWorkoutRecordRequest(message)
  const likelyFragment = !isNonWorkoutRequest(message) && workoutTextProvided(extractWorkoutTranscript(message))
  if (previousWorkout && isWorkoutRecordCancellation(message)) return { reply: 'Хорошо, запись тренировки отменена.', action: null }
  const continuation = previousWorkout && (
    previousStep === 'client'
    || previousStep === 'workout'
    || (previousStep === 'confirm' && (explicitRequest || likelyFragment))
  )
  if (!explicitRequest && !continuation) return undefined

  const candidates = workoutCandidatesFromAction(latestAction)
  const selectedByNumber = normalizeAssistantMessage(message).match(/^(?:выбрать )?(\d{1,2})$/u)
  const numberedClient = selectedByNumber === null ? undefined : candidates[Number(selectedByNumber[1]) - 1]
  const matches = numberedClient === undefined
    ? matchingSummaryClients(message, clients)
    : clients.filter((client) => client.id === numberedClient.id)
  const selectedClient = matches.length === 1
    ? matches[0]
    : (previousStep === 'workout' || (previousStep === 'confirm' && continuation)) ? summaryClientFromAction(latestAction, clients) : undefined

  if (matches.length > 1) {
    return workoutAction('Выберите клиента', 'Нашла несколько клиентов с таким именем. Выберите одного из списка.', 'needs_input', {
      step: 'client', candidates: matches.map(({ id, fullName }) => ({ id, fullName })),
    })
  }
  if (!selectedClient) {
    return workoutAction('Уточните клиента', 'Для кого записать тренировку? Напишите имя или фамилию клиента.', 'needs_input', { step: 'client' })
  }
  const collectedTranscript = workoutTranscript(previousPayload?.transcript)
  if (previousStep === 'workout' && isWorkoutCollectionComplete(message)) {
    if (!collectedTranscript) {
      return workoutAction('Добавьте упражнения', 'Сначала напишите или продиктуйте хотя бы одно упражнение.', 'needs_input', {
        step: 'workout', clientId: selectedClient.id, clientName: selectedClient.fullName, transcript: '',
      })
    }
    return workoutAction('Проверьте тренировку', `Собрала тренировку для ${selectedClient.fullName}. Теперь можно проверить распознавание, дату и время перед сохранением.`, 'proposed', {
      step: 'confirm', clientId: selectedClient.id, clientName: selectedClient.fullName, transcript: collectedTranscript,
    })
  }
  if (previousStep === 'workout') {
    const fragment = extractWorkoutTranscript(message, selectedClient)
    if (!fragment || isNonWorkoutRequest(message)) return undefined
    const nextTranscript = appendWorkoutFragment(collectedTranscript, fragment)
    if (nextTranscript === undefined) {
      return workoutAction('Черновик заполнен', 'Текст достиг лимита. Перейдите к разбору или отмените сценарий.', 'needs_input', {
        step: 'workout', clientId: selectedClient.id, clientName: selectedClient.fullName, transcript: collectedTranscript,
      })
    }
    return workoutAction('Продолжайте диктовку', 'Добавила фрагмент. Продиктуйте следующее упражнение или перейдите к разбору.', 'needs_input', {
      step: 'workout', clientId: selectedClient.id, clientName: selectedClient.fullName, transcript: nextTranscript,
    })
  }
  if (previousStep === 'confirm' && continuation) {
    const fragment = extractWorkoutTranscript(message, selectedClient)
    const nextTranscript = appendWorkoutFragment(collectedTranscript, fragment)
    if (!fragment || nextTranscript === undefined) return undefined
    return workoutAction('Продолжайте диктовку', 'Добавила новый фрагмент. Продиктуйте следующее упражнение или перейдите к разбору.', 'needs_input', {
      step: 'workout', clientId: selectedClient.id, clientName: selectedClient.fullName, transcript: nextTranscript,
    })
  }
  if (!workoutTextProvided(message)) {
    return workoutAction('Новая тренировка', `Клиент: ${selectedClient.fullName}. Диктуйте упражнения по одному или все сразу.`, 'needs_input', {
      step: 'workout', clientId: selectedClient.id, clientName: selectedClient.fullName, transcript: '',
    })
  }
  const fragment = extractWorkoutTranscript(message, selectedClient)
  if (!fragment || !workoutTextProvided(fragment)) {
    return workoutAction('Добавьте упражнения', 'Сначала напишите или продиктуйте хотя бы одно упражнение.', 'needs_input', {
      step: 'workout', clientId: selectedClient.id, clientName: selectedClient.fullName, transcript: collectedTranscript,
    })
  }
  return workoutAction('Продолжайте диктовку', 'Добавила первый фрагмент. Продиктуйте следующее упражнение или перейдите к разбору.', 'needs_input', {
    step: 'workout', clientId: selectedClient.id, clientName: selectedClient.fullName, transcript: fragment,
  })
}

export function createClientTurn(message: string, latestAction: unknown): AssistantTurnResponse | undefined {
  const previousAction = actionRecord(latestAction)
  const continuation = previousAction?.tool === 'create_client_draft'
  if (!isCreateClientRequest(message) && !continuation) return undefined
  if (continuation && isSummaryCancellation(message)) return { reply: 'Хорошо, создание карточки клиента отменено.', action: null }
  const previousDraft = clientDraftFromAction(previousAction?.payload) ?? {}
  const draft = clientDraftFromMessage(message, previousDraft)
  if (draft.fullName === undefined) {
    return clientAction('Уточните имя', 'Напишите имя клиента, чтобы подготовить карточку.', 'needs_input', { step: 'name', ...clientDraftPayload(draft) })
  }
  const missing = [draft.gender === undefined ? 'пол' : undefined, draft.ageYears === undefined ? 'возраст' : undefined, draft.heightCm === undefined ? 'рост' : undefined].filter((value): value is string => value !== undefined)
  if (missing.length > 0) return clientAction('Данные клиента', `Для ${draft.fullName} осталось уточнить: ${missing.join(', ')}.`, 'needs_input', { step: 'profile', ...clientDraftPayload(draft), missing })
  return clientAction('Карточка клиента готова', `Проверьте данные ${draft.fullName} и подтвердите создание карточки.`, 'proposed', { step: 'confirm', ...clientDraftPayload(draft) })
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
  const { data: rows, error: historyError } = await service.from('assistant_messages')
    .select('author,content,action').eq('conversation_id', command.conversationId).order('created_at', { ascending: false }).order('id', { ascending: false }).limit(20)
  if (historyError) throw new HttpError(503, 'history_unavailable')
  const latestAssistantAction: unknown = (rows ?? []).find((row) => row.author === 'assistant')?.action
  const workoutDraft = recordWorkoutTurn(command.message, clientRows, latestAssistantAction)
  if (workoutDraft !== undefined) {
    console.info('assistant_workout_draft_reply_persisted', { operationId: turnId, releaseSha, status: workoutDraft.action?.status })
    return persistAssistantResponse(service, command.conversationId, turnId, workoutDraft)
  }
  const result: AssistantTurnResponse = { reply: workoutOnlyReply, action: null }
  console.info('assistant_workout_only_reply_persisted', { operationId: turnId, releaseSha })
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
