import { todayInTimeZone, type LocalDate } from '../../shared/local-date'
import type { AssistantOrchestratorAction } from '../../data/repositories/assistant.repository'
import type {
  AssistantActionRow,
  AssistantConversation,
  AssistantMessage,
} from '../../data/repositories/assistant.repository'

export type {
  AssistantActionRow,
  AssistantConversation,
  AssistantMessage,
} from '../../data/repositories/assistant.repository'

export type AssistantConversationGroup = {
  date: LocalDate
  conversations: AssistantConversation[]
}

export type AssistantActionMessage = {
  message: AssistantMessage
  action: AssistantOrchestratorAction
}

const legacyWorkoutOnlyReply = 'Сейчас в чате можно только добавить тренировку. Напишите «добавь тренировку» и укажите клиента, упражнения, подходы, повторы и вес.'

export function compactAssistantContent(content: string): string {
  return content.trim() === legacyWorkoutOnlyReply
    ? 'Сейчас я помогаю только записывать тренировки.'
    : content
}

export function conversationLocalDate(conversation: Pick<AssistantConversation, 'created_at'>, timezone?: string): LocalDate {
  return todayInTimeZone(timezone, new Date(conversation.created_at))
}

export function groupAssistantConversations(conversations: readonly AssistantConversation[], timezone?: string, today = todayInTimeZone(timezone)): AssistantConversationGroup[] {
  const groups = new Map<string, AssistantConversation[]>()
  for (const conversation of conversations) {
    const date = conversationLocalDate(conversation, timezone)
    const items = groups.get(date) ?? []
    items.push(conversation)
    groups.set(date, items)
  }
  return [...groups.entries()]
    .sort(([left], [right]) => right.localeCompare(left))
    .map(([date, items]) => ({
      date: date as LocalDate,
      conversations: [...items].sort((left, right) => right.created_at.localeCompare(left.created_at)),
    }))
    .sort((left, right) => (left.date === today ? -1 : right.date === today ? 1 : right.date.localeCompare(left.date)))
}

export function selectTodayConversation(conversations: readonly AssistantConversation[], timezone?: string, today = todayInTimeZone(timezone)): AssistantConversation | undefined {
  return [...conversations]
    .filter((conversation) => conversationLocalDate(conversation, timezone) === today)
    .sort((left, right) => right.created_at.localeCompare(left.created_at))[0]
}

export function conversationTitle(conversation: Pick<AssistantConversation, 'title'>, date: LocalDate, today = todayInTimeZone()): string {
  const title = conversation.title?.trim()
  if (title) return title
  return date === today ? 'Текущая беседа' : 'Диалог за день'
}

export function mergeAssistantMessages(
  messages: readonly AssistantMessage[],
  actions: readonly AssistantActionRow[],
): AssistantMessage[] {
  const actionByMessage = new Map(actions.map((action) => [action.assistant_message_id, action]))
  return messages.map((message) => {
    if (!message.action) return message
    const durable = actionByMessage.get(message.id)
    return durable?.conversation_id === message.conversation_id
      ? { ...message, action: { ...message.action, id: durable.id, lifecycleStatus: durable.status as AssistantOrchestratorAction['lifecycleStatus'], result: durable.result } }
      : message
  })
}

export function isInteractiveAssistantAction(action: AssistantOrchestratorAction | null): boolean {
  return action !== null && action.lifecycleStatus !== 'applied' && action.lifecycleStatus !== 'cancelled' && action.lifecycleStatus !== 'failed'
}

export function latestActiveAssistantAction(messages: readonly AssistantMessage[], conversationId?: string): AssistantActionMessage | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (!message || message.conversation_id !== conversationId) continue
    if (message.action) return isInteractiveAssistantAction(message.action) ? { message, action: message.action } : undefined
    if (isWorkoutTerminalReply(message)) return undefined
  }
  return undefined
}

export function latestActiveWorkoutAction(messages: readonly AssistantMessage[], conversationId?: string): AssistantActionMessage | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (!message || message.conversation_id !== conversationId) continue
    if (message.action) {
      if (message.action.tool !== 'record_workout') return undefined
      return isInteractiveAssistantAction(message.action) ? { message, action: message.action } : undefined
    }
    if (isWorkoutTerminalReply(message)) return undefined
  }
  return undefined
}

function isWorkoutTerminalReply(message: AssistantMessage): boolean {
  if (message.author !== 'assistant' || message.action !== null) return false
  const content = message.content.trim().toLocaleLowerCase('ru-RU')
  return content.includes('запись тренировки отменена') || content.includes('тренировка сохранена')
}

export function filterTerminalAssistantMessages(messages: readonly AssistantMessage[]): AssistantMessage[] {
  return messages.flatMap((message) => {
    if (!message.action || isInteractiveAssistantAction(message.action)) return [message]
    if ((message.action.tool === 'summarize_progress' || message.action.tool === 'record_workout') && message.action.lifecycleStatus === 'applied') return [message]
    return message.content.trim() === message.action.description.trim() ? [] : [{ ...message, action: null }]
  })
}

export function isWorkoutDictationReceipt(message: AssistantMessage, messages: readonly AssistantMessage[]): boolean {
  if (message.author !== 'user' || !message.turn_id || !message.content.trim()) return false
  return messages.some((candidate) => {
    const payload = candidate.action?.payload
    return candidate.author === 'assistant' && candidate.turn_id === message.turn_id && candidate.action?.tool === 'record_workout'
      && payload?.step === 'workout' && typeof payload.transcript === 'string' && payload.transcript.trim().length > 0
  })
}

export type WorkoutDictationReceiptGroup = {
  firstMessageId: string
  messageIds: string[]
  fragments: string[]
}

export function groupWorkoutDictationReceipts(
  visibleMessages: readonly AssistantMessage[],
  allMessages: readonly AssistantMessage[],
): WorkoutDictationReceiptGroup[] {
  const groups: WorkoutDictationReceiptGroup[] = []
  let current: WorkoutDictationReceiptGroup | undefined

  visibleMessages.forEach((message) => {
    if (isWorkoutDictationReceipt(message, allMessages)) {
      if (!current) {
        current = { firstMessageId: message.id, messageIds: [], fragments: [] }
        groups.push(current)
      }
      current.messageIds.push(message.id)
      current.fragments.push(message.content.trim())
      return
    }

    const payload = message.action?.payload
    const isHiddenWorkoutActionEcho = message.author === 'assistant'
      && message.action?.tool === 'record_workout'
      && isInteractiveAssistantAction(message.action)
      && payload?.step === 'workout'
      && message.content.trim() === message.action.description.trim()

    if (!isHiddenWorkoutActionEcho) current = undefined
  })

  return groups
}

export function workoutDictationFragmentLabel(count: number): string {
  const mod100 = count % 100
  const mod10 = count % 10
  if (mod100 >= 11 && mod100 <= 14) return `${count} фрагментов`
  if (mod10 === 1) return `${count} фрагмент`
  if (mod10 >= 2 && mod10 <= 4) return `${count} фрагмента`
  return `${count} фрагментов`
}

export function isReadOnlyConversation(selectedId: string | undefined, todayId: string | undefined): boolean {
  return selectedId !== undefined && todayId !== undefined && selectedId !== todayId
}
