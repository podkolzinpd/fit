import type { ChatThread, Client } from '../../shared/domain'

// History is readable independently of today's connection; sending is server-owned.
export function canOpenClientChat(client: Pick<Client, 'hasAccount' | 'archivedAt'>, thread?: ChatThread) {
  return Boolean(thread?.conversationId || (client.hasAccount && !client.archivedAt))
}

// API order is newest first. A connection-only candidate must not overwrite
// existing history after several cards resolve to the same canonical client.
export function clientChatThreads(threads: readonly ChatThread[]) {
  const result = new Map<string, ChatThread>()
  for (const thread of threads) {
    const previous = result.get(thread.clientId)
    if (!previous || (!previous.conversationId && thread.conversationId)) result.set(thread.clientId, thread)
  }
  return result
}
