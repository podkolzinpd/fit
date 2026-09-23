import { getSupabaseClient } from './client'
import type { RealtimeChannel } from '@supabase/supabase-js'

export function chatMedia() {
  return getSupabaseClient().storage.from('chat-media')
}

export const chatQueries = {
  listThreads: () => getSupabaseClient().rpc('list_chat_threads'),
  open: (clientId: string, trainerId: string) => getSupabaseClient().rpc('open_chat', { p_client_id: clientId, p_trainer_id: trainerId }),
  openPublicTrainer: (publicProfileId: string) => getSupabaseClient().rpc('open_public_trainer_chat', { p_public_id: publicProfileId }),
  authorizeSend: (conversationId: string) => getSupabaseClient().rpc('authorize_chat_send', { p_conversation_id: conversationId }),
  setBlocked: (conversationId: string, blocked: boolean) => getSupabaseClient().rpc('set_chat_block', { p_conversation_id: conversationId, p_blocked: blocked }),
  connectionState: (conversationId: string) => getSupabaseClient().rpc('get_chat_connection_state', { p_conversation_id: conversationId }),
  inviteToConnect: (conversationId: string) => getSupabaseClient().rpc('send_chat_connection_invitation', { p_conversation_id: conversationId }),
  acceptConnection: (conversationId: string) => getSupabaseClient().rpc('accept_chat_connection_invitation', { p_conversation_id: conversationId }),
  listMessages: (conversationId: string, cursor?: { createdAt: string; id: string } | null) => getSupabaseClient().rpc('list_chat_messages_v3', {
    p_conversation_id: conversationId,
    p_before_created_at: cursor?.createdAt ?? undefined,
    p_before_id: cursor?.id ?? undefined,
    p_limit: 50,
  }),
  send: (conversationId: string, messageId: string, body: string, image: { path: string; mimeType: string; width: number; height: number; sizeBytes: number } | null, replyToMessageId?: string | null) => getSupabaseClient().rpc('send_chat_message_v3', {
    p_conversation_id: conversationId, p_message_id: messageId, p_body: body,
    p_image_path: image?.path ?? null, p_image_mime_type: image?.mimeType ?? null,
    p_image_width: image?.width ?? null, p_image_height: image?.height ?? null, p_image_size_bytes: image?.sizeBytes ?? null,
    p_reply_to_message_id: replyToMessageId ?? null,
  }),
  edit: (conversationId: string, messageId: string, body: string) => getSupabaseClient().rpc('edit_chat_message', {
    p_conversation_id: conversationId, p_message_id: messageId, p_body: body,
  }),
  remove: (conversationId: string, messageId: string) => getSupabaseClient().rpc('delete_chat_message', {
    p_conversation_id: conversationId,
    p_message_id: messageId,
  }),
  unreadState: (conversationId: string) => getSupabaseClient().rpc('get_chat_unread_state', { p_conversation_id: conversationId }),
  markRead: (conversationId: string, throughMessageId: string) => getSupabaseClient().rpc('mark_chat_read_v2', {
    p_conversation_id: conversationId, p_through_message_id: throughMessageId,
  }),
  search: (conversationId: string, query: string) => getSupabaseClient().rpc('search_chat_messages', {
    p_conversation_id: conversationId, p_query: query, p_limit: 50,
  }),
  window: (conversationId: string, messageId: string) => getSupabaseClient().rpc('get_chat_message_window', {
    p_conversation_id: conversationId, p_message_id: messageId, p_radius: 25,
  }),
  subscribe(conversationId: string, onChange: () => void) {
    const channel: RealtimeChannel = getSupabaseClient().channel(`chat:${conversationId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_messages', filter: `conversation_id=eq.${conversationId}` }, onChange)
      .subscribe()
    return () => { void getSupabaseClient().removeChannel(channel) }
  },
}
