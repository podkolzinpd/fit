import { hashPilotSessionToken } from './auth/pilot-session-token.js'
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
import {
  PilotSessionInvalidError,
  withYandexPilotSessionTransaction,
} from './db/yandex-pilot-transaction.js'
import type { DatabasePool } from './db/types.js'

export interface PilotDomainWriter {
  createClient(
    sessionToken: string,
    draft: CreateClientCardDraft,
  ): Promise<CreatedPilotClient>
  updateClient(
    sessionToken: string,
    clientId: string,
    draft: ClientCardDraft,
    expectedVersion: number,
  ): Promise<number>
  setClientArchived(
    sessionToken: string,
    clientId: string,
    archived: boolean,
    expectedVersion: number,
  ): Promise<number>
  updateClientPreferences(
    sessionToken: string,
    clientId: string,
    alias: string | null,
    note: string | null,
    expectedVersion: number,
  ): Promise<number>
  createCustomExercise(
    sessionToken: string,
    draft: CustomExerciseDraft,
  ): Promise<PilotCustomExerciseMutation>
  updateCustomExercise(
    sessionToken: string,
    exerciseId: string,
    draft: CustomExerciseDraft,
    expectedVersion: number,
  ): Promise<PilotCustomExerciseMutation>
  setCustomExerciseArchived(
    sessionToken: string,
    exerciseId: string,
    archived: boolean,
    expectedVersion: number,
  ): Promise<PilotCustomExerciseMutation>
}

export class DatabasePilotDomainWriter implements PilotDomainWriter {
  constructor(private readonly pool: DatabasePool) {}

  private withSession<Result>(
    sessionToken: string,
    work: Parameters<typeof withYandexPilotSessionTransaction<Result>>[2],
  ): Promise<Result> {
    const tokenHash = hashPilotSessionToken(sessionToken)
    if (tokenHash === undefined) throw new PilotSessionInvalidError()
    return withYandexPilotSessionTransaction(this.pool, tokenHash, work)
  }

  createClient(sessionToken: string, draft: CreateClientCardDraft) {
    return this.withSession(sessionToken, (client) => createClientCard(client, draft))
  }

  updateClient(
    sessionToken: string,
    clientId: string,
    draft: ClientCardDraft,
    expectedVersion: number,
  ) {
    return this.withSession(sessionToken, (client) =>
      updateClientCard(client, clientId, draft, expectedVersion))
  }

  setClientArchived(
    sessionToken: string,
    clientId: string,
    archived: boolean,
    expectedVersion: number,
  ) {
    return this.withSession(sessionToken, (client) =>
      setClientArchived(client, clientId, archived, expectedVersion))
  }

  updateClientPreferences(
    sessionToken: string,
    clientId: string,
    alias: string | null,
    note: string | null,
    expectedVersion: number,
  ) {
    return this.withSession(sessionToken, (client) =>
      updateClientPreferences(client, clientId, alias, note, expectedVersion))
  }

  createCustomExercise(sessionToken: string, draft: CustomExerciseDraft) {
    return this.withSession(sessionToken, (client) =>
      createCustomExercise(client, draft))
  }

  updateCustomExercise(
    sessionToken: string,
    exerciseId: string,
    draft: CustomExerciseDraft,
    expectedVersion: number,
  ) {
    return this.withSession(sessionToken, (client) =>
      updateCustomExercise(client, exerciseId, draft, expectedVersion))
  }

  setCustomExerciseArchived(
    sessionToken: string,
    exerciseId: string,
    archived: boolean,
    expectedVersion: number,
  ) {
    return this.withSession(sessionToken, (client) =>
      setCustomExerciseArchived(client, exerciseId, archived, expectedVersion))
  }
}
