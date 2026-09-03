import {
  createClientCard,
  createCustomExercise,
  setClientArchived,
  setCustomExerciseArchived,
  updateClientCard,
  updateClientPreferences,
  updateCustomExercise,
  type CreatedPilotClient,
  type PilotCustomExerciseMutation,
} from './domain-commands.js'
import type {
  ClientCardDraft,
  CreateClientCardDraft,
  CustomExerciseDraft,
} from './domain-request.js'
import type { DatabasePool } from './db/types.js'
import {
  withYandexActorSession,
  type YandexActorSessionInput,
} from './yandex-actor-session.js'

export interface PilotDomainWriter {
  createClient(
    session: YandexActorSessionInput,
    draft: CreateClientCardDraft,
  ): Promise<CreatedPilotClient>
  updateClient(
    session: YandexActorSessionInput,
    clientId: string,
    draft: ClientCardDraft,
    expectedVersion: number,
  ): Promise<number>
  setClientArchived(
    session: YandexActorSessionInput,
    clientId: string,
    archived: boolean,
    expectedVersion: number,
  ): Promise<number>
  updateClientPreferences(
    session: YandexActorSessionInput,
    clientId: string,
    alias: string | null,
    note: string | null,
    expectedVersion: number,
  ): Promise<number>
  createCustomExercise(
    session: YandexActorSessionInput,
    draft: CustomExerciseDraft,
  ): Promise<PilotCustomExerciseMutation>
  updateCustomExercise(
    session: YandexActorSessionInput,
    exerciseId: string,
    draft: CustomExerciseDraft,
    expectedVersion: number,
  ): Promise<PilotCustomExerciseMutation>
  setCustomExerciseArchived(
    session: YandexActorSessionInput,
    exerciseId: string,
    archived: boolean,
    expectedVersion: number,
  ): Promise<PilotCustomExerciseMutation>
}

export class DatabasePilotDomainWriter implements PilotDomainWriter {
  constructor(private readonly pool: DatabasePool) {}

  private withSession<Result>(
    session: YandexActorSessionInput,
    work: Parameters<typeof withYandexActorSession<Result>>[2],
  ): Promise<Result> {
    return withYandexActorSession(this.pool, session, work)
  }

  createClient(session: YandexActorSessionInput, draft: CreateClientCardDraft) {
    return this.withSession(session, (client) => createClientCard(client, draft))
  }

  updateClient(
    session: YandexActorSessionInput,
    clientId: string,
    draft: ClientCardDraft,
    expectedVersion: number,
  ) {
    return this.withSession(session, (client) =>
      updateClientCard(client, clientId, draft, expectedVersion))
  }

  setClientArchived(
    session: YandexActorSessionInput,
    clientId: string,
    archived: boolean,
    expectedVersion: number,
  ) {
    return this.withSession(session, (client) =>
      setClientArchived(client, clientId, archived, expectedVersion))
  }

  updateClientPreferences(
    session: YandexActorSessionInput,
    clientId: string,
    alias: string | null,
    note: string | null,
    expectedVersion: number,
  ) {
    return this.withSession(session, (client) =>
      updateClientPreferences(client, clientId, alias, note, expectedVersion))
  }

  createCustomExercise(session: YandexActorSessionInput, draft: CustomExerciseDraft) {
    return this.withSession(session, (client) =>
      createCustomExercise(client, draft))
  }

  updateCustomExercise(
    session: YandexActorSessionInput,
    exerciseId: string,
    draft: CustomExerciseDraft,
    expectedVersion: number,
  ) {
    return this.withSession(session, (client) =>
      updateCustomExercise(client, exerciseId, draft, expectedVersion))
  }

  setCustomExerciseArchived(
    session: YandexActorSessionInput,
    exerciseId: string,
    archived: boolean,
    expectedVersion: number,
  ) {
    return this.withSession(session, (client) =>
      setCustomExerciseArchived(client, exerciseId, archived, expectedVersion))
  }
}
