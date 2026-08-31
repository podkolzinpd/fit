import type { QueryResultRow } from 'pg'

import type { DatabaseClient } from './db/types.js'
import type {
  PushNotificationKind,
  PushSubscriptionDraft,
} from './push-notifications-request.js'

export interface PushNotificationStatus {
  subscribed: boolean
  preferences: Record<PushNotificationKind, boolean>
}

interface PushNotificationStatusRow extends QueryResultRow {
  status: unknown
}

export type PushNotificationCommandFailure = 'forbidden' | 'invalid'

export class PushNotificationCommandError extends Error {
  constructor(readonly failure: PushNotificationCommandFailure) {
    super(`Push notification command failed: ${failure}`)
    this.name = 'PushNotificationCommandError'
  }
}

function commandError(error: unknown): PushNotificationCommandError | undefined {
  if (typeof error !== 'object' || error === null || !('message' in error)) {
    return undefined
  }
  if (error.message === 'push_notifications_forbidden') {
    return new PushNotificationCommandError('forbidden')
  }
  if (error.message === 'push_notifications_invalid') {
    return new PushNotificationCommandError('invalid')
  }
  return undefined
}

function parseStatus(value: unknown): PushNotificationStatus {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Push notification status returned an unsupported format')
  }
  const status = value as Record<string, unknown>
  const preferences = status.preferences
  if (typeof status.subscribed !== 'boolean'
    || typeof preferences !== 'object'
    || preferences === null
    || Array.isArray(preferences)) {
    throw new Error('Push notification status returned an unsupported format')
  }
  const preferenceRecord = preferences as Record<string, unknown>
  if (typeof preferenceRecord.workout_reminder !== 'boolean'
    || typeof preferenceRecord.workout_scheduled !== 'boolean') {
    throw new Error('Push notification status returned an unsupported format')
  }
  return {
    subscribed: status.subscribed,
    preferences: {
      workout_reminder: preferenceRecord.workout_reminder,
      workout_scheduled: preferenceRecord.workout_scheduled,
    },
  }
}

export async function readPushNotificationStatus(
  client: DatabaseClient,
): Promise<PushNotificationStatus> {
  try {
    const rows = await client.query<PushNotificationStatusRow>(
      'select public.read_push_notification_status() as status',
    )
    return parseStatus(rows[0]?.status)
  } catch (error) {
    throw commandError(error) ?? error
  }
}

export async function upsertPushSubscription(
  client: DatabaseClient,
  draft: PushSubscriptionDraft,
): Promise<void> {
  try {
    await client.query(
      'select public.upsert_push_subscription($1, $2, $3)',
      [draft.endpoint, draft.p256dh, draft.authKey],
    )
  } catch (error) {
    throw commandError(error) ?? error
  }
}

export async function deletePushSubscription(client: DatabaseClient): Promise<void> {
  try {
    await client.query('select public.delete_push_subscription()')
  } catch (error) {
    throw commandError(error) ?? error
  }
}

export async function setNotificationPreference(
  client: DatabaseClient,
  kind: PushNotificationKind,
  enabled: boolean,
): Promise<void> {
  try {
    await client.query(
      'select public.set_notification_preference($1, $2)',
      [kind, enabled],
    )
  } catch (error) {
    throw commandError(error) ?? error
  }
}
