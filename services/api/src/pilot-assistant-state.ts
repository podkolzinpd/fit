import {
  applyAssistantAction,
  cancelAssistantAction,
  completeAssistantSummary,
  createAssistantConversation,
  listAssistantActions,
  listAssistantConversations,
  listAssistantMessages,
  type AssistantConversation,
  type AssistantMessage,
  type AssistantStoredAction,
} from './assistant-state.js'
import { hashPilotSessionToken } from './auth/pilot-session-token.js'
import type { DatabasePool } from './db/types.js'
import {
  PilotSessionInvalidError,
  withYandexPilotSessionTransaction,
} from './db/yandex-pilot-transaction.js'

export interface PilotAssistantState {
  listConversations(sessionToken: string): Promise<AssistantConversation[]>
  createConversation(
    sessionToken: string,
    title: string | null,
  ): Promise<AssistantConversation>
  listMessages(
    sessionToken: string,
    conversationId: string,
  ): Promise<AssistantMessage[]>
  listActions(
    sessionToken: string,
    conversationId: string | null,
  ): Promise<AssistantStoredAction[]>
  applyAction(
    sessionToken: string,
    actionId: string,
    input: Record<string, unknown>,
    expectedVersion: number,
  ): Promise<Record<string, unknown>>
  completeSummary(
    sessionToken: string,
    actionId: string,
    expectedVersion: number,
  ): Promise<Record<string, unknown>>
  cancelAction(
    sessionToken: string,
    actionId: string,
    expectedVersion: number,
  ): Promise<Record<string, unknown>>
}

export class DatabasePilotAssistantState implements PilotAssistantState {
  constructor(private readonly pool: DatabasePool) {}

  private withSession<Result>(
    sessionToken: string,
    work: Parameters<typeof withYandexPilotSessionTransaction<Result>>[2],
  ): Promise<Result> {
    const tokenHash = hashPilotSessionToken(sessionToken)
    if (tokenHash === undefined) throw new PilotSessionInvalidError()
    return withYandexPilotSessionTransaction(this.pool, tokenHash, work)
  }

  listConversations(sessionToken: string) {
    return this.withSession(sessionToken, listAssistantConversations)
  }

  createConversation(sessionToken: string, title: string | null) {
    return this.withSession(sessionToken, (client) =>
      createAssistantConversation(client, title))
  }

  listMessages(sessionToken: string, conversationId: string) {
    return this.withSession(sessionToken, (client) =>
      listAssistantMessages(client, conversationId))
  }

  listActions(sessionToken: string, conversationId: string | null) {
    return this.withSession(sessionToken, (client) =>
      listAssistantActions(client, conversationId))
  }

  applyAction(
    sessionToken: string,
    actionId: string,
    input: Record<string, unknown>,
    expectedVersion: number,
  ) {
    return this.withSession(sessionToken, (client) =>
      applyAssistantAction(client, actionId, input, expectedVersion))
  }

  completeSummary(
    sessionToken: string,
    actionId: string,
    expectedVersion: number,
  ) {
    return this.withSession(sessionToken, (client) =>
      completeAssistantSummary(client, actionId, expectedVersion))
  }

  cancelAction(
    sessionToken: string,
    actionId: string,
    expectedVersion: number,
  ) {
    return this.withSession(sessionToken, (client) =>
      cancelAssistantAction(client, actionId, expectedVersion))
  }
}
