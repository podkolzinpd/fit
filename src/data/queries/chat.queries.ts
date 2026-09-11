import { supabase } from './client'
import type { RealtimeChannel } from '@supabase/supabase-js'

export const chatMedia = supabase.storage.from('chat-media')

export const chatQueries = {
  listThreads: () => supabase.rpc('list_chat_threads'),
  open: (clientId: string, trainerId: string) => supabase.rpc('open_chat', { p_client_id: clientId, p_trainer_id: trainerId }),
  listMessages: (conversationId: string, cursor?: { createdAt: string; id: string } | null) => supabase.rpc('list_chat_messages_v3', {
    p_conversation_id: conversationId,
    p_before_created_at: cursor?.createdAt ?? undefined,
    p_before_id: cursor?.id ?? undefined,
    p_limit: 50,
  }),
  send: (conversationId: string, messageId: string, body: string, image: { path: string; mimeType: string; width: number; height: number; sizeBytes: number } | null, replyToMessageId?: string | null) => supabase.rpc('send_chat_message_v3', {
    p_conversation_id: conversationId, p_message_id: messageId, p_body: body,
    p_image_path: image?.path ?? null, p_image_mime_type: image?.mimeType ?? null,
    p_image_width: image?.width ?? null, p_image_height: image?.height ?? null, p_image_size_bytes: image?.sizeBytes ?? null,
    p_reply_to_message_id: replyToMessageId ?? null,
  }),
  edit: (conversationId: string, messageId: string, body: string) => supabase.rpc('edit_chat_message', {
    p_conversation_id: conversationId, p_message_id: messageId, p_body: body,
  }),
  remove: (conversationId: string, messageId: string) => supabase.rpc('delete_chat_message', {
    p_conversation_id: conversationId,
    p_message_id: messageId,
  }),
  unreadState: (conversationId: string) => supabase.rpc('get_chat_unread_state', { p_conversation_id: conversationId }),
  markRead: (conversationId: string, throughMessageId: string) => supabase.rpc('mark_chat_read_v2', {
    p_conversation_id: conversationId, p_through_message_id: throughMessageId,
  }),
  search: (conversationId: string, query: string) => supabase.rpc('search_chat_messages', {
    p_conversation_id: conversationId, p_query: query, p_limit: 50,
  }),
  window: (conversationId: string, messageId: string) => supabase.rpc('get_chat_message_window', {
    p_conversation_id: conversationId, p_message_id: messageId, p_radius: 25,
  }),
  subscribe(conversationId: string, onChange: () => void) {
    const channel: RealtimeChannel = supabase.channel(`chat:${conversationId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_messages', filter: `conversation_id=eq.${conversationId}` }, onChange)
      .subscribe()
    return () => { void supabase.removeChannel(channel) }
  },
}
