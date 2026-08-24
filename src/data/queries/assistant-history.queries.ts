import { supabase } from './client'

const conversationColumns = 'id,owner_id,title,created_at'
const messageColumns = 'id,conversation_id,author,content,action,created_at'

export const assistantHistoryQueries = {
  listConversations: () => supabase.from('assistant_conversations')
    .select(conversationColumns)
    .order('created_at', { ascending: false }),
  createConversation: (ownerId: string, title?: string) => supabase.from('assistant_conversations')
    .insert({ owner_id: ownerId, ...(title === undefined ? {} : { title }) })
    .select(conversationColumns)
    .single(),
  listMessages: (conversationId: string) => supabase.from('assistant_messages')
    .select(messageColumns)
    .eq('conversation_id', conversationId)
    .order('created_at')
    .order('id'),
  appendUserMessage: (conversationId: string, content: string) => supabase.from('assistant_messages')
    .insert({ conversation_id: conversationId, author: 'user', content })
    .select(messageColumns)
    .single(),
}
