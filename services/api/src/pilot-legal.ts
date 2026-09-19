import type { DatabasePool } from './db/types.js'
import {
  acceptLegalDocuments,
  cancelAccountDeletionRequest,
  readAccountDeletionRequest,
  readLegalAcceptance,
  requestAccountDeletion,
  type AccountDeletionRequestState,
  type LegalAcceptanceState,
} from './legal.js'
import {
  withYandexActorSession,
  type YandexActorSessionInput,
} from './yandex-actor-session.js'

export interface PilotLegal {
  acceptance(
    session: YandexActorSessionInput,
    termsVersion: string,
    privacyVersion: string,
  ): Promise<LegalAcceptanceState>
  accept(
    session: YandexActorSessionInput,
    termsVersion: string,
    privacyVersion: string,
    source: 'registration' | 'existing_user',
  ): Promise<string>
  deletionRequest(session: YandexActorSessionInput): Promise<AccountDeletionRequestState | null>
  requestDeletion(session: YandexActorSessionInput): Promise<string>
  cancelDeletion(session: YandexActorSessionInput): Promise<void>
}

export class DatabasePilotLegal implements PilotLegal {
  constructor(private readonly pool: DatabasePool) {}

  acceptance(
    session: YandexActorSessionInput,
    termsVersion: string,
    privacyVersion: string,
  ): Promise<LegalAcceptanceState> {
    return withYandexActorSession(this.pool, session, (client) =>
      readLegalAcceptance(client, termsVersion, privacyVersion))
  }

  accept(
    session: YandexActorSessionInput,
    termsVersion: string,
    privacyVersion: string,
    source: 'registration' | 'existing_user',
  ): Promise<string> {
    return withYandexActorSession(this.pool, session, (client) =>
      acceptLegalDocuments(client, termsVersion, privacyVersion, source))
  }

  deletionRequest(session: YandexActorSessionInput): Promise<AccountDeletionRequestState | null> {
    return withYandexActorSession(this.pool, session, readAccountDeletionRequest)
  }

  requestDeletion(session: YandexActorSessionInput): Promise<string> {
    return withYandexActorSession(this.pool, session, requestAccountDeletion)
  }

  cancelDeletion(session: YandexActorSessionInput): Promise<void> {
    return withYandexActorSession(this.pool, session, cancelAccountDeletionRequest)
  }
}
