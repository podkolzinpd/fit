import { getSupabaseClient } from './client'
import type { Json } from '../database.types'

const conversationColumns = 'id,owner_id,title,created_at'
const messageColumns = 'id,conversation_id,turn_id,author,content,action,created_at'

export const assistantHistoryQueries = {
  listConversations: () => getSupabaseClient().from('assistant_conversations')
    .select(conversationColumns)
    .order('created_at', { ascending: false }),
  createConversation: (ownerId: string, title?: string) => getSupabaseClient().from('assistant_conversations')
    .insert({ owner_id: ownerId, ...(title === undefined ? {} : { title }) })
    .select(conversationColumns)
    .single(),
  listMessages: (conversationId: string) => getSupabaseClient().from('assistant_messages')
    .select(messageColumns)
    .eq('conversation_id', conversationId)
    .order('created_at')
    .order('id'),
  appendUserMessage: (conversationId: string, content: string) => getSupabaseClient().from('assistant_messages')
    .insert({ conversation_id: conversationId, author: 'user', content })
    .select(messageColumns)
    .single(),
  listActions: (conversationId?: string) => {
    const query = getSupabaseClient().from('assistant_actions')
      .select('id,owner_id,conversation_id,assistant_message_id,tool,status,payload,result,error_code,version,created_at,updated_at,applied_at')
      .order('created_at')
    return conversationId === undefined ? query : query.eq('conversation_id', conversationId)
  },
  applyAction: (actionId: string, input: Json, version: number) => getSupabaseClient().rpc('apply_assistant_action', {
    p_action_id: actionId, p_input: input, p_expected_version: version,
  }),
  completeSummary: (actionId: string, version: number) => getSupabaseClient().rpc('complete_assistant_summary', {
    p_action_id: actionId, p_expected_version: version,
  }),
  cancelAction: (actionId: string, version: number) => getSupabaseClient().rpc('cancel_assistant_action', {
    p_action_id: actionId, p_expected_version: version,
  }),
}
