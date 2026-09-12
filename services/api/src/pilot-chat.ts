import type { QueryResultRow } from 'pg'
import type { DatabaseClient, DatabasePool } from './db/types.js'
import { withYandexActorSession, type YandexActorSessionInput } from './yandex-actor-session.js'

export type ChatThread = { conversationId: string | null; clientId: string; trainerId: string; partnerUserId: string; partnerName: string; activeConnection: boolean; lastMessageBody: string | null; lastMessageAt: string | null; lastMessageSenderId: string | null; unreadCount: number; canMessage: boolean; blockedByMe: boolean; blockedByPartner: boolean }
export type ChatBlockState = { canMessage: boolean; blockedByMe: boolean; blockedByPartner: boolean }
export type ChatStoredImage = { path: string; mimeType: 'image/jpeg'; width: number; height: number; sizeBytes: number }
export type ChatReplyPreview = { messageId: string; senderId: string | null; body: string | null; hasImage: boolean; deleted: boolean }
export type ChatMessage = { id: string; conversationId: string; senderId: string; body: string; image: ChatStoredImage | null; createdAt: string; editedAt: string | null; replyTo: ChatReplyPreview | null }
export type ChatUnreadState = { firstMessageId: string | null; firstCreatedAt: string | null; unreadCount: number }
export type ChatCursor = { createdAt: string; id: string }
type ThreadRow = QueryResultRow & { conversation_id: string | null; client_id: string; trainer_id: string; partner_user_id: string; partner_name: string; active_connection: boolean; last_message_body: string | null; last_message_at: string | null; last_message_sender_id: string | null; unread_count: string | number; can_message: boolean; blocked_by_me: boolean; blocked_by_partner: boolean }
type MessageRow = QueryResultRow & { id: string; conversation_id: string; sender_id: string; body: string; image_path: string | null; image_mime_type: string | null; image_width: number | null; image_height: number | null; image_size_bytes: number | null; created_at: string; edited_at?: string | null; reply_to_message_id?: string | null; reply_to_sender_id?: string | null; reply_to_body?: string | null; reply_to_has_image?: boolean | null; reply_to_deleted?: boolean | null }

export class ChatCommandError extends Error {
  constructor(readonly failure: 'forbidden' | 'invalid' | 'conflict' | 'blocked' | 'rate_limited') { super(`Chat command failed: ${failure}`) }
}
function chatError(error: unknown) {
  if (!(error instanceof Error)) return undefined
  if (error.message === 'chat_forbidden') return new ChatCommandError('forbidden')
  if (error.message === 'chat_message_invalid') return new ChatCommandError('invalid')
  if (error.message === 'chat_message_conflict') return new ChatCommandError('conflict')
  if (error.message === 'chat_blocked') return new ChatCommandError('blocked')
  if (error.message === 'chat_rate_limited') return new ChatCommandError('rate_limited')
  return undefined
}
function message(row: MessageRow): ChatMessage {
  return { id: row.id, conversationId: row.conversation_id, senderId: row.sender_id, body: row.body,
    image: row.image_path && row.image_mime_type === 'image/jpeg' && row.image_width && row.image_height && row.image_size_bytes
      ? { path: row.image_path, mimeType: 'image/jpeg', width: row.image_width, height: row.image_height, sizeBytes: row.image_size_bytes }
      : null,
    createdAt: row.created_at, editedAt: row.edited_at ?? null,
    replyTo: row.reply_to_message_id ? { messageId: row.reply_to_message_id, senderId: row.reply_to_sender_id ?? null,
      body: row.reply_to_body ?? null, hasImage: row.reply_to_has_image === true, deleted: row.reply_to_deleted === true } : null }
}

export interface PilotChat {
  listThreads(session: YandexActorSessionInput): Promise<ChatThread[]>
  open(session: YandexActorSessionInput, clientId: string, trainerId: string): Promise<string>
  openPublicTrainer(session: YandexActorSessionInput, publicProfileId: string): Promise<string>
  setBlocked(session: YandexActorSessionInput, conversationId: string, blocked: boolean): Promise<ChatBlockState>
  listMessages(session: YandexActorSessionInput, conversationId: string, cursor: ChatCursor | null, limit: number): Promise<{ messages: ChatMessage[]; nextCursor: ChatCursor | null }>
  authorize(session: YandexActorSessionInput, conversationId: string): Promise<void>
  send(session: YandexActorSessionInput, conversationId: string, messageId: string, body: string, image: ChatStoredImage | null, replyToMessageId?: string | null): Promise<ChatMessage>
  edit(session: YandexActorSessionInput, conversationId: string, messageId: string, body: string): Promise<ChatMessage>
  remove(session: YandexActorSessionInput, conversationId: string, messageId: string): Promise<string | null>
  unreadState(session: YandexActorSessionInput, conversationId: string): Promise<ChatUnreadState>
  markRead(session: YandexActorSessionInput, conversationId: string, throughMessageId: string): Promise<void>
  search(session: YandexActorSessionInput, conversationId: string, query: string): Promise<ChatMessage[]>
  window(session: YandexActorSessionInput, conversationId: string, messageId: string): Promise<ChatMessage[]>
}

export class DatabasePilotChat implements PilotChat {
  constructor(private readonly pool: DatabasePool) {}
  private run<Result>(session: YandexActorSessionInput, work: (client: DatabaseClient) => Promise<Result>) {
    return withYandexActorSession(this.pool, session, async (client) => { try { return await work(client) } catch (error) { throw chatError(error) ?? error } })
  }
  listThreads(session: YandexActorSessionInput) {
    return this.run(session, async (client) => (await client.query<ThreadRow>('select * from public.list_chat_threads()')).map((row) => ({
      conversationId: row.conversation_id, clientId: row.client_id, trainerId: row.trainer_id, partnerUserId: row.partner_user_id,
      partnerName: row.partner_name, activeConnection: row.active_connection, lastMessageBody: row.last_message_body,
      lastMessageAt: row.last_message_at, lastMessageSenderId: row.last_message_sender_id, unreadCount: Number(row.unread_count),
      canMessage: row.can_message, blockedByMe: row.blocked_by_me, blockedByPartner: row.blocked_by_partner,
    })))
  }
  openPublicTrainer(session: YandexActorSessionInput, publicProfileId: string) {
    return this.run(session, async (client) => {
      const rows = await client.query<QueryResultRow & { id: string }>('select public.open_public_trainer_chat($1) as id',[publicProfileId])
      if (!rows[0]?.id) throw new Error('Public trainer chat open returned an unsupported format')
      return rows[0].id
    })
  }
  setBlocked(session: YandexActorSessionInput, conversationId: string, blocked: boolean) {
    return this.run(session, async (client) => {
      const rows = await client.query<QueryResultRow & { can_message: boolean; blocked_by_me: boolean; blocked_by_partner: boolean }>('select * from public.set_chat_block($1,$2)',[conversationId,blocked])
      const row = rows[0]
      if (!row) throw new Error('Chat block returned an unsupported format')
      return { canMessage: row.can_message, blockedByMe: row.blocked_by_me, blockedByPartner: row.blocked_by_partner }
    })
  }
  open(session: YandexActorSessionInput, clientId: string, trainerId: string) {
    return this.run(session, async (client) => {
      const rows = await client.query<QueryResultRow & { id: string }>('select public.open_chat($1,$2) as id',[clientId,trainerId])
      if (!rows[0]?.id) throw new Error('Chat open returned an unsupported format')
      return rows[0].id
    })
  }
  listMessages(session: YandexActorSessionInput, conversationId: string, cursor: ChatCursor | null, limit: number) {
    return this.run(session, async (client) => {
      const rows = await client.query<MessageRow>('select * from public.list_chat_messages_v3($1,$2,$3,$4)',[conversationId,cursor?.createdAt ?? null,cursor?.id ?? null,limit])
      const oldest = rows.at(-1)
      return { messages: rows.map(message).reverse(), nextCursor: rows.length === limit && oldest ? { createdAt: oldest.created_at, id: oldest.id } : null }
    })
  }
  authorize(session: YandexActorSessionInput, conversationId: string) {
    return this.run(session, async (client) => {
      await client.query('select public.authorize_chat_send($1)',[conversationId])
    })
  }
  send(session: YandexActorSessionInput, conversationId: string, messageId: string, body: string, image: ChatStoredImage | null, replyToMessageId?: string | null) {
    return this.run(session, async (client) => {
      const rows = await client.query<MessageRow>('select * from public.send_chat_message_v3($1,$2,$3,$4,$5,$6,$7,$8,$9)',[
        conversationId,messageId,body,image?.path ?? null,image?.mimeType ?? null,image?.width ?? null,image?.height ?? null,image?.sizeBytes ?? null,
        replyToMessageId ?? null,
      ])
      if (!rows[0]) throw new Error('Chat send returned an unsupported format')
      return message(rows[0])
    })
  }
  edit(session: YandexActorSessionInput, conversationId: string, messageId: string, body: string) {
    return this.run(session, async (client) => {
      const rows = await client.query<MessageRow>('select * from public.edit_chat_message($1,$2,$3)',[conversationId,messageId,body])
      if (!rows[0]) throw new Error('Chat edit returned an unsupported format')
      return message(rows[0])
    })
  }
  remove(session: YandexActorSessionInput, conversationId: string, messageId: string) {
    return this.run(session, async (client) => {
      const rows = await client.query<QueryResultRow & { image_path: string | null }>('select public.delete_chat_message($1,$2) as image_path',[conversationId,messageId])
      return rows[0]?.image_path ?? null
    })
  }
  unreadState(session: YandexActorSessionInput, conversationId: string) {
    return this.run(session, async (client) => {
      const rows = await client.query<QueryResultRow & { first_message_id: string | null; first_created_at: string | null; unread_count: string | number }>('select * from public.get_chat_unread_state($1)',[conversationId])
      return { firstMessageId: rows[0]?.first_message_id ?? null, firstCreatedAt: rows[0]?.first_created_at ?? null, unreadCount: Number(rows[0]?.unread_count ?? 0) }
    })
  }
  markRead(session: YandexActorSessionInput, conversationId: string, throughMessageId: string) {
    return this.run(session, async (client) => { await client.query('select public.mark_chat_read_v2($1,$2)',[conversationId,throughMessageId]) })
  }
  search(session: YandexActorSessionInput, conversationId: string, query: string) {
    return this.run(session, async (client) => (await client.query<MessageRow>('select * from public.search_chat_messages($1,$2,$3)',[conversationId,query,50])).map(message))
  }
  window(session: YandexActorSessionInput, conversationId: string, messageId: string) {
    return this.run(session, async (client) => (await client.query<MessageRow>('select * from public.get_chat_message_window($1,$2,$3)',[conversationId,messageId,25])).map(message))
  }
}
