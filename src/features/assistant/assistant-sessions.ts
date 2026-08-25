import { todayInTimeZone, type LocalDate } from '../../shared/local-date'
import type { AssistantOrchestratorAction } from '../../data/repositories/assistant.repository'

export type AssistantConversation = {
  id: string
  title: string | null
  created_at: string
}

export type AssistantMessage = {
  id: string
  conversation_id: string
  turn_id: string | null
  author: string
  content: string
  action: AssistantOrchestratorAction | null
  created_at: string
}

export type AssistantActionRow = {
  id: string
  conversation_id: string
  assistant_message_id: string
  status: string
  version: number
  result: Record<string, unknown> | null
}

export type AssistantConversationGroup = {
  date: LocalDate
  conversations: AssistantConversation[]
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

export function isReadOnlyConversation(selectedId: string | undefined, todayId: string | undefined): boolean {
  return selectedId !== undefined && todayId !== undefined && selectedId !== todayId
}
