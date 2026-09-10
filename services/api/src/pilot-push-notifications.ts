import type { DatabaseClient, DatabasePool } from './db/types.js'
import {
  withYandexActorSession,
  type YandexActorSessionInput,
} from './yandex-actor-session.js'
import {
  deletePushSubscription,
  hasPushSubscription,
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
  hasSubscription(
    session: YandexActorSessionInput,
    endpoint: string,
  ): Promise<boolean>
  upsertSubscription(
    session: YandexActorSessionInput,
    draft: PushSubscriptionDraft,
  ): Promise<void>
  deleteSubscription(
    session: YandexActorSessionInput,
    endpoint: string,
  ): Promise<void>
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

  hasSubscription(
    session: YandexActorSessionInput,
    endpoint: string,
  ): Promise<boolean> {
    return this.withSession(session, (client) =>
      hasPushSubscription(client, endpoint))
  }

  upsertSubscription(
    session: YandexActorSessionInput,
    draft: PushSubscriptionDraft,
  ): Promise<void> {
    return this.withSession(session, (client) =>
      upsertPushSubscription(client, draft))
  }

  deleteSubscription(
    session: YandexActorSessionInput,
    endpoint: string,
  ): Promise<void> {
    return this.withSession(session, (client) =>
      deletePushSubscription(client, endpoint))
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
