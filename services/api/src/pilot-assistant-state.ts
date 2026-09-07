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
import type { DatabasePool } from './db/types.js'
import {
  withYandexActorSession,
  type YandexActorSessionInput,
} from './yandex-actor-session.js'

export interface PilotAssistantState {
  listConversations(session: YandexActorSessionInput): Promise<AssistantConversation[]>
  createConversation(
    session: YandexActorSessionInput,
    title: string | null,
  ): Promise<AssistantConversation>
  listMessages(
    session: YandexActorSessionInput,
    conversationId: string,
  ): Promise<AssistantMessage[]>
  listActions(
    session: YandexActorSessionInput,
    conversationId: string | null,
  ): Promise<AssistantStoredAction[]>
  applyAction(
    session: YandexActorSessionInput,
    actionId: string,
    input: Record<string, unknown>,
    expectedVersion: number,
  ): Promise<Record<string, unknown>>
  completeSummary(
    session: YandexActorSessionInput,
    actionId: string,
    expectedVersion: number,
  ): Promise<Record<string, unknown>>
  cancelAction(
    session: YandexActorSessionInput,
    actionId: string,
    expectedVersion: number,
  ): Promise<Record<string, unknown>>
}

export class DatabasePilotAssistantState implements PilotAssistantState {
  constructor(private readonly pool: DatabasePool) {}

  private withSession<Result>(
    session: YandexActorSessionInput,
    work: Parameters<typeof withYandexActorSession<Result>>[2],
  ): Promise<Result> {
    return withYandexActorSession(this.pool, session, work)
  }

  listConversations(session: YandexActorSessionInput) {
    return this.withSession(session, listAssistantConversations)
  }

  createConversation(session: YandexActorSessionInput, title: string | null) {
    return this.withSession(session, (client) =>
      createAssistantConversation(client, title))
  }

  listMessages(session: YandexActorSessionInput, conversationId: string) {
    return this.withSession(session, (client) =>
      listAssistantMessages(client, conversationId))
  }

  listActions(session: YandexActorSessionInput, conversationId: string | null) {
    return this.withSession(session, (client) =>
      listAssistantActions(client, conversationId))
  }

  applyAction(
    session: YandexActorSessionInput,
    actionId: string,
    input: Record<string, unknown>,
    expectedVersion: number,
  ) {
    return this.withSession(session, (client) =>
      applyAssistantAction(client, actionId, input, expectedVersion))
  }

  completeSummary(
    session: YandexActorSessionInput,
    actionId: string,
    expectedVersion: number,
  ) {
    return this.withSession(session, (client) =>
      completeAssistantSummary(client, actionId, expectedVersion))
  }

  cancelAction(
    session: YandexActorSessionInput,
    actionId: string,
    expectedVersion: number,
  ) {
    return this.withSession(session, (client) =>
      cancelAssistantAction(client, actionId, expectedVersion))
  }
}
