import type { QueryResultRow } from 'pg'
import type { DatabaseClient, DatabasePool } from './db/types.js'
import { withYandexActorSession, type YandexActorSessionInput } from './yandex-actor-session.js'

export type ChatThread = { conversationId: string | null; clientId: string; trainerId: string; partnerUserId: string; partnerName: string; activeConnection: boolean; lastMessageBody: string | null; lastMessageAt: string | null; lastMessageSenderId: string | null; unreadCount: number }
export type ChatStoredImage = { path: string; mimeType: 'image/jpeg'; width: number; height: number; sizeBytes: number }
export type ChatMessage = { id: string; conversationId: string; senderId: string; body: string; image: ChatStoredImage | null; createdAt: string }
export type ChatCursor = { createdAt: string; id: string }
type ThreadRow = QueryResultRow & { conversation_id: string | null; client_id: string; trainer_id: string; partner_user_id: string; partner_name: string; active_connection: boolean; last_message_body: string | null; last_message_at: string | null; last_message_sender_id: string | null; unread_count: string | number }
type MessageRow = QueryResultRow & { id: string; conversation_id: string; sender_id: string; body: string; image_path: string | null; image_mime_type: string | null; image_width: number | null; image_height: number | null; image_size_bytes: number | null; created_at: string }

export class ChatCommandError extends Error {
  constructor(readonly failure: 'forbidden' | 'invalid' | 'conflict') { super(`Chat command failed: ${failure}`) }
}
function chatError(error: unknown) {
  if (!(error instanceof Error)) return undefined
  if (error.message === 'chat_forbidden') return new ChatCommandError('forbidden')
  if (error.message === 'chat_message_invalid') return new ChatCommandError('invalid')
  if (error.message === 'chat_message_conflict') return new ChatCommandError('conflict')
  return undefined
}
function message(row: MessageRow): ChatMessage {
  return { id: row.id, conversationId: row.conversation_id, senderId: row.sender_id, body: row.body,
    image: row.image_path && row.image_mime_type === 'image/jpeg' && row.image_width && row.image_height && row.image_size_bytes
      ? { path: row.image_path, mimeType: 'image/jpeg', width: row.image_width, height: row.image_height, sizeBytes: row.image_size_bytes }
      : null,
    createdAt: row.created_at }
}

export interface PilotChat {
  listThreads(session: YandexActorSessionInput): Promise<ChatThread[]>
  open(session: YandexActorSessionInput, clientId: string, trainerId: string): Promise<string>
  listMessages(session: YandexActorSessionInput, conversationId: string, cursor: ChatCursor | null, limit: number): Promise<{ messages: ChatMessage[]; nextCursor: ChatCursor | null }>
  authorize(session: YandexActorSessionInput, conversationId: string): Promise<void>
  send(session: YandexActorSessionInput, conversationId: string, messageId: string, body: string, image: ChatStoredImage | null): Promise<ChatMessage>
  remove(session: YandexActorSessionInput, conversationId: string, messageId: string): Promise<string | null>
  markRead(session: YandexActorSessionInput, conversationId: string): Promise<void>
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
    })))
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
      const rows = await client.query<MessageRow>('select * from public.list_chat_messages_v2($1,$2,$3,$4)',[conversationId,cursor?.createdAt ?? null,cursor?.id ?? null,limit])
      const oldest = rows.at(-1)
      return { messages: rows.map(message).reverse(), nextCursor: rows.length === limit && oldest ? { createdAt: oldest.created_at, id: oldest.id } : null }
    })
  }
  authorize(session: YandexActorSessionInput, conversationId: string) {
    return this.run(session, async (client) => {
      const rows = await client.query<QueryResultRow & { allowed: boolean }>('select exists(select 1 from public.chat_conversations where id=$1 and auth.uid() in(client_user_id,trainer_id)) as allowed',[conversationId])
      if (rows[0]?.allowed !== true) throw new ChatCommandError('forbidden')
    })
  }
  send(session: YandexActorSessionInput, conversationId: string, messageId: string, body: string, image: ChatStoredImage | null) {
    return this.run(session, async (client) => {
      const rows = await client.query<MessageRow>('select * from public.send_chat_message_v2($1,$2,$3,$4,$5,$6,$7,$8)',[
        conversationId,messageId,body,image?.path ?? null,image?.mimeType ?? null,image?.width ?? null,image?.height ?? null,image?.sizeBytes ?? null,
      ])
      if (!rows[0]) throw new Error('Chat send returned an unsupported format')
      return message(rows[0])
    })
  }
  remove(session: YandexActorSessionInput, conversationId: string, messageId: string) {
    return this.run(session, async (client) => {
      const rows = await client.query<QueryResultRow & { image_path: string | null }>('select public.delete_chat_message($1,$2) as image_path',[conversationId,messageId])
      return rows[0]?.image_path ?? null
    })
  }
  markRead(session: YandexActorSessionInput, conversationId: string) {
    return this.run(session, async (client) => { await client.query('select public.mark_chat_read($1)',[conversationId]) })
  }
}
