import type { ChatImageDraft, ChatMessage, ChatMessagePage, ChatThread, ChatUnreadState } from '../../shared/domain'
import { chatMedia, chatQueries } from '../queries/chat.queries'
import { repositoryError } from './error'

type ThreadRow = {
  conversation_id: string | null; client_id: string; trainer_id: string; partner_user_id: string
  partner_name: string; active_connection: boolean; last_message_body: string | null
  last_message_at: string | null; last_message_sender_id: string | null; unread_count: number
}
type MessageRow = { id: string; conversation_id: string; sender_id: string; body: string; created_at: string; image_path: string | null; image_mime_type: string | null; image_width: number | null; image_height: number | null; image_size_bytes: number | null; edited_at: string | null; reply_to_message_id: string | null; reply_to_sender_id?: string | null; reply_to_body?: string | null; reply_to_has_image?: boolean | null; reply_to_deleted?: boolean | null }

function thread(row: ThreadRow): ChatThread {
  return { conversationId: row.conversation_id, clientId: row.client_id, trainerId: row.trainer_id,
    partnerUserId: row.partner_user_id, partnerName: row.partner_name, activeConnection: row.active_connection,
    lastMessageBody: row.last_message_body, lastMessageAt: row.last_message_at,
    lastMessageSenderId: row.last_message_sender_id, unreadCount: Number(row.unread_count) }
}
async function message(row: MessageRow): Promise<ChatMessage> {
  let url: string | null = null
  if (row.image_path) {
    const signed = await chatMedia.createSignedUrl(row.image_path, 60 * 60)
    url = signed.error ? null : signed.data.signedUrl
  }
  return { id: row.id, conversationId: row.conversation_id, senderId: row.sender_id, body: row.body,
    image: row.image_path && row.image_mime_type === 'image/jpeg' && row.image_width && row.image_height && row.image_size_bytes
      ? { url, mimeType: 'image/jpeg', width: row.image_width, height: row.image_height, sizeBytes: row.image_size_bytes }
      : null,
    createdAt: row.created_at, editedAt: row.edited_at,
    replyTo: row.reply_to_message_id ? { messageId: row.reply_to_message_id, senderId: row.reply_to_sender_id ?? null,
      body: row.reply_to_body ?? null, hasImage: row.reply_to_has_image === true, deleted: row.reply_to_deleted === true } : null }
}

function blobFromDataUrl(dataUrl: string): Blob {
  const encoded = dataUrl.slice('data:image/jpeg;base64,'.length)
  const binary = atob(encoded)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return new Blob([bytes], { type: 'image/jpeg' })
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
    const messages = (await Promise.all(rows.map(message))).reverse()
    const oldest = rows.at(-1)
    return { messages, nextCursor: rows.length === 50 && oldest ? { createdAt: oldest.created_at, id: oldest.id } : null }
  },
  async send(conversationId: string, messageId: string, body: string, image?: ChatImageDraft | null, replyToMessageId?: string | null): Promise<ChatMessage> {
    const stored = image ? { path: `${conversationId}/${messageId}.jpg`, mimeType: image.mimeType, width: image.width, height: image.height, sizeBytes: image.sizeBytes } : null
    if (image && stored) {
      const uploaded = await chatMedia.upload(stored.path, blobFromDataUrl(image.dataUrl), { contentType: image.mimeType, upsert: false })
      if (uploaded.error && !/already exists|duplicate/i.test(uploaded.error.message)) throw repositoryError(uploaded.error)
    }
    const result = await chatQueries.send(conversationId, messageId, body, stored, replyToMessageId)
    if (result.error) throw repositoryError(result.error)
    const row = result.data?.[0]
    if (!row) throw new Error('Сообщение не сохранилось')
    return message(row as MessageRow)
  },
  async edit(conversationId: string, messageId: string, body: string): Promise<ChatMessage> {
    const result = await chatQueries.edit(conversationId, messageId, body)
    if (result.error) throw repositoryError(result.error)
    const row = result.data?.[0]
    if (!row) throw new Error('Изменения не сохранились')
    return message(row as MessageRow)
  },
  async remove(conversationId: string, messageId: string): Promise<void> {
    const result = await chatQueries.remove(conversationId, messageId)
    if (result.error) throw repositoryError(result.error)
    if (result.data) {
      const removed = await chatMedia.remove([result.data])
      if (removed.error && !/not found/i.test(removed.error.message)) throw repositoryError(removed.error)
    }
  },
  async unreadState(conversationId: string): Promise<ChatUnreadState> {
    const result = await chatQueries.unreadState(conversationId)
    if (result.error) throw repositoryError(result.error)
    const row = result.data?.[0]
    return { firstMessageId: row?.first_message_id ?? null, firstCreatedAt: row?.first_created_at ?? null,
      unreadCount: Number(row?.unread_count ?? 0) }
  },
  async markRead(conversationId: string, throughMessageId: string): Promise<void> {
    const result = await chatQueries.markRead(conversationId, throughMessageId)
    if (result.error) throw repositoryError(result.error)
  },
  async search(conversationId: string, query: string): Promise<ChatMessage[]> {
    const result = await chatQueries.search(conversationId, query)
    if (result.error) throw repositoryError(result.error)
    return Promise.all(((result.data ?? []) as MessageRow[]).map(message))
  },
  async window(conversationId: string, messageId: string): Promise<ChatMessage[]> {
    const result = await chatQueries.window(conversationId, messageId)
    if (result.error) throw repositoryError(result.error)
    return Promise.all(((result.data ?? []) as MessageRow[]).map(message))
  },
  subscribe(conversationId: string, onChange: () => void): () => void {
    return chatQueries.subscribe(conversationId, onChange)
  },
}
