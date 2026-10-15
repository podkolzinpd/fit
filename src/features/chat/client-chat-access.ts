import type { ChatThread, Client } from '../../shared/domain'

// History is readable independently of today's connection; sending is server-owned.
export function canOpenClientChat(client: Pick<Client, 'hasAccount' | 'archivedAt'>, thread?: ChatThread) {
  return Boolean(thread?.conversationId || (client.hasAccount && !client.archivedAt))
}
