import type { QueryResultRow } from 'pg'

import type { DatabaseClient } from './db/types.js'
import { parsePushRequest } from './push-notifications/parse-request.js'
import type {
  PushNotificationInput,
  PushNotificationResult,
} from './push-notifications/send.js'

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

interface EnqueuedRow extends QueryResultRow {
  enqueued: number
}

interface ClaimedRow extends QueryResultRow {
  batch: unknown
}

interface FinalizedRow extends QueryResultRow {
  result: unknown
}

export interface ClaimedPushBatch {
  dispatchToken: string
  notifications: PushNotificationInput[]
}

export interface PushFinalizeSummary {
  discarded: number
  failed: number
  succeeded: number
}

function parseCount(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} returned an unsupported count`)
  }
  return value
}

function parseClaimedBatch(value: unknown): ClaimedPushBatch | null {
  if (value === null) return null
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Push claim returned an unsupported format')
  }
  const record = value as Record<string, unknown>
  if (typeof record.dispatchToken !== 'string' || !UUID_PATTERN.test(record.dispatchToken)) {
    throw new Error('Push claim returned an invalid lease token')
  }
  return {
    dispatchToken: record.dispatchToken,
    notifications: parsePushRequest({ notifications: record.notifications }),
  }
}

function parseFinalizeSummary(value: unknown): PushFinalizeSummary {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Push finalization returned an unsupported format')
  }
  const record = value as Record<string, unknown>
  return {
    discarded: parseCount(record.discarded, 'Push finalization'),
    failed: parseCount(record.failed, 'Push finalization'),
    succeeded: parseCount(record.succeeded, 'Push finalization'),
  }
}

export async function enqueueWorkoutReminders(
  client: DatabaseClient,
  now: Date,
): Promise<number> {
  const rows = await client.query<EnqueuedRow>(
    'select app_private.enqueue_workout_reminders($1) as enqueued',
    [now.toISOString()],
  )
  return parseCount(rows[0]?.enqueued, 'Reminder producer')
}

export async function claimPushNotifications(
  client: DatabaseClient,
  now: Date,
): Promise<ClaimedPushBatch | null> {
  const rows = await client.query<ClaimedRow>(
    'select app_private.claim_push_notifications(20, $1) as batch',
    [now.toISOString()],
  )
  return parseClaimedBatch(rows[0]?.batch)
}

export async function finalizePushNotifications(
  client: DatabaseClient,
  dispatchToken: string,
  results: readonly PushNotificationResult[],
  now: Date,
): Promise<PushFinalizeSummary> {
  const rows = await client.query<FinalizedRow>(
    `select app_private.finalize_push_notifications(
      $1::uuid, $2::jsonb, $3
    ) as result`,
    [dispatchToken, JSON.stringify(results), now.toISOString()],
  )
  return parseFinalizeSummary(rows[0]?.result)
}
