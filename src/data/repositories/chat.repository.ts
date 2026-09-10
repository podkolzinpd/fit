import type { ChatMessage, ChatMessagePage, ChatThread } from '../../shared/domain'
import { chatQueries } from '../queries/chat.queries'
import { repositoryError } from './error'

type ThreadRow = {
  conversation_id: string | null; client_id: string; trainer_id: string; partner_user_id: string
  partner_name: string; active_connection: boolean; last_message_body: string | null
  last_message_at: string | null; last_message_sender_id: string | null; unread_count: number
}
type MessageRow = { id: string; conversation_id: string; sender_id: string; body: string; created_at: string }

function thread(row: ThreadRow): ChatThread {
  return { conversationId: row.conversation_id, clientId: row.client_id, trainerId: row.trainer_id,
    partnerUserId: row.partner_user_id, partnerName: row.partner_name, activeConnection: row.active_connection,
    lastMessageBody: row.last_message_body, lastMessageAt: row.last_message_at,
    lastMessageSenderId: row.last_message_sender_id, unreadCount: Number(row.unread_count) }
}
function message(row: MessageRow): ChatMessage {
  return { id: row.id, conversationId: row.conversation_id, senderId: row.sender_id, body: row.body, createdAt: row.created_at }
}

export const chatRepository = {
  async listThreads(): Promise<ChatThread[]> {
    const result = await chatQueries.listThreads()
    if (result.error) throw repositoryError(result.error)
    return (result.data ?? []).map((row) => thread(row as ThreadRow))
  },
  async open(clientId: string, trainerId: string): Promise<string> {
    const result = await chatQueries.open(clientId, trainerId)
    if (result.error) throw repositoryError(result.error)
    return result.data
  },
  async listMessages(conversationId: string, cursor?: { createdAt: string; id: string } | null): Promise<ChatMessagePage> {
    const result = await chatQueries.listMessages(conversationId, cursor)
    if (result.error) throw repositoryError(result.error)
    const rows = (result.data ?? []) as MessageRow[]
    const messages = rows.map(message).reverse()
    const oldest = rows.at(-1)
    return { messages, nextCursor: rows.length === 50 && oldest ? { createdAt: oldest.created_at, id: oldest.id } : null }
  },
  async send(conversationId: string, messageId: string, body: string): Promise<ChatMessage> {
    const result = await chatQueries.send(conversationId, messageId, body)
    if (result.error) throw repositoryError(result.error)
    const row = result.data?.[0]
    if (!row) throw new Error('Сообщение не сохранилось')
    return message(row as MessageRow)
  },
  async markRead(conversationId: string): Promise<void> {
    const result = await chatQueries.markRead(conversationId)
    if (result.error) throw repositoryError(result.error)
  },
  subscribe(conversationId: string, onChange: () => void): () => void {
    return chatQueries.subscribe(conversationId, onChange)
  },
}
