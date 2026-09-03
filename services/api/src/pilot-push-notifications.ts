import type { DatabaseClient, DatabasePool } from './db/types.js'
import {
  withYandexActorSession,
  type YandexActorSessionInput,
} from './yandex-actor-session.js'
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
  readStatus(session: YandexActorSessionInput): Promise<PushNotificationStatus>
  upsertSubscription(
    session: YandexActorSessionInput,
    draft: PushSubscriptionDraft,
  ): Promise<void>
  deleteSubscription(session: YandexActorSessionInput): Promise<void>
  setPreference(
    session: YandexActorSessionInput,
    kind: PushNotificationKind,
    enabled: boolean,
  ): Promise<void>
}

export class DatabasePilotPushNotifications implements PilotPushNotifications {
  constructor(private readonly pool: DatabasePool) {}

  private withSession<Result>(
    session: YandexActorSessionInput,
    work: (client: DatabaseClient) => Promise<Result>,
  ): Promise<Result> {
    return withYandexActorSession(this.pool, session, work)
  }

  readStatus(session: YandexActorSessionInput): Promise<PushNotificationStatus> {
    return this.withSession(session, readPushNotificationStatus)
  }

  upsertSubscription(
    session: YandexActorSessionInput,
    draft: PushSubscriptionDraft,
  ): Promise<void> {
    return this.withSession(session, (client) =>
      upsertPushSubscription(client, draft))
  }

  deleteSubscription(session: YandexActorSessionInput): Promise<void> {
    return this.withSession(session, deletePushSubscription)
  }

  setPreference(
    session: YandexActorSessionInput,
    kind: PushNotificationKind,
    enabled: boolean,
  ): Promise<void> {
    return this.withSession(session, (client) =>
      setNotificationPreference(client, kind, enabled))
  }
}
