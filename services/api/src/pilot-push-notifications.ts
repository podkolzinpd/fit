import { hashPilotSessionToken } from './auth/pilot-session-token.js'
import type { DatabaseClient, DatabasePool } from './db/types.js'
import {
  PilotSessionInvalidError,
  withYandexPilotSessionTransaction,
} from './db/yandex-pilot-transaction.js'
import {
  deletePushSubscription,
  readPushNotificationStatus,
  setNotificationPreference,
  type PushNotificationStatus,
  upsertPushSubscription,
} from './push-notifications-command.js'
import type {
  PushNotificationKind,
  PushSubscriptionDraft,
} from './push-notifications-request.js'

export interface PilotPushNotifications {
  readStatus(sessionToken: string): Promise<PushNotificationStatus>
  upsertSubscription(
    sessionToken: string,
    draft: PushSubscriptionDraft,
  ): Promise<void>
  deleteSubscription(sessionToken: string): Promise<void>
  setPreference(
    sessionToken: string,
    kind: PushNotificationKind,
    enabled: boolean,
  ): Promise<void>
}

export class DatabasePilotPushNotifications implements PilotPushNotifications {
  constructor(private readonly pool: DatabasePool) {}

  private withSession<Result>(
    sessionToken: string,
    work: (client: DatabaseClient) => Promise<Result>,
  ): Promise<Result> {
    const tokenHash = hashPilotSessionToken(sessionToken)
    if (tokenHash === undefined) throw new PilotSessionInvalidError()
    return withYandexPilotSessionTransaction(this.pool, tokenHash, work)
  }

  readStatus(sessionToken: string): Promise<PushNotificationStatus> {
    return this.withSession(sessionToken, readPushNotificationStatus)
  }

  upsertSubscription(
    sessionToken: string,
    draft: PushSubscriptionDraft,
  ): Promise<void> {
    return this.withSession(sessionToken, (client) =>
      upsertPushSubscription(client, draft))
  }

  deleteSubscription(sessionToken: string): Promise<void> {
    return this.withSession(sessionToken, deletePushSubscription)
  }

  setPreference(
    sessionToken: string,
    kind: PushNotificationKind,
    enabled: boolean,
  ): Promise<void> {
    return this.withSession(sessionToken, (client) =>
      setNotificationPreference(client, kind, enabled))
  }
}
