import { supabase } from './client'
import type { RealtimeChannel } from '@supabase/supabase-js'

export const chatQueries = {
  listThreads: () => supabase.rpc('list_chat_threads'),
  open: (clientId: string, trainerId: string) => supabase.rpc('open_chat', { p_client_id: clientId, p_trainer_id: trainerId }),
  listMessages: (conversationId: string, cursor?: { createdAt: string; id: string } | null) => supabase.rpc('list_chat_messages', {
    p_conversation_id: conversationId,
    p_before_created_at: cursor?.createdAt ?? undefined,
    p_before_id: cursor?.id ?? undefined,
    p_limit: 50,
  }),
  send: (conversationId: string, messageId: string, body: string) => supabase.rpc('send_chat_message', {
    p_conversation_id: conversationId, p_message_id: messageId, p_body: body,
  }),
  markRead: (conversationId: string) => supabase.rpc('mark_chat_read', { p_conversation_id: conversationId }),
  subscribe(conversationId: string, onChange: () => void) {
    const channel: RealtimeChannel = supabase.channel(`chat:${conversationId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `conversation_id=eq.${conversationId}` }, onChange)
      .subscribe()
    return () => { void supabase.removeChannel(channel) }
  },
}
