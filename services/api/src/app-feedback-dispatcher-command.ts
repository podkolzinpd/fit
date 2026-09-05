import type { QueryResultRow } from 'pg'

import type { AppFeedbackDeliveryResult } from './app-feedback-integrations/sender.js'
import type { DatabaseClient } from './db/types.js'

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

interface ClaimedRow extends QueryResultRow {
  batch: unknown
}

interface FinalizedRow extends QueryResultRow {
  result: unknown
}

export interface ClaimedAppFeedbackBatch {
  dispatchToken: string
  deliveries: Array<{
    id: string
    accountRole: 'trainer' | 'client'
    kind: 'suggestion' | 'problem'
    message: string
    screenPath: string
    appVersion: string
    displayMode: 'browser' | 'standalone'
    createdAt: string
    sendTracker: boolean
    sendTelegram: boolean
  }>
}

export interface AppFeedbackFinalizeSummary {
  trackerSucceeded: number
  trackerFailed: number
  trackerDiscarded: number
  telegramSucceeded: number
  telegramFailed: number
  telegramDiscarded: number
}

function readRecord(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${name} returned an unsupported format`)
  }
  return value as Record<string, unknown>
}

function readText(record: Record<string, unknown>, key: string): string {
  const value = record[key]
  if (typeof value !== 'string' || value === '') {
    throw new Error('App feedback claim returned an unsupported delivery')
  }
  return value
}

function readBoolean(record: Record<string, unknown>, key: string): boolean {
  const value = record[key]
  if (typeof value !== 'boolean') {
    throw new Error('App feedback claim returned an unsupported delivery')
  }
  return value
}

function parseDelivery(value: unknown): ClaimedAppFeedbackBatch['deliveries'][number] {
  const record = readRecord(value, 'App feedback claim')
  const id = readText(record, 'id')
  const accountRole = readText(record, 'accountRole')
  const kind = readText(record, 'kind')
  const displayMode = readText(record, 'displayMode')
  const sendTracker = readBoolean(record, 'sendTracker')
  const sendTelegram = readBoolean(record, 'sendTelegram')
  if (
    !UUID_PATTERN.test(id)
    || (accountRole !== 'trainer' && accountRole !== 'client')
    || (kind !== 'suggestion' && kind !== 'problem')
    || (displayMode !== 'browser' && displayMode !== 'standalone')
    || (!sendTracker && !sendTelegram)
  ) {
    throw new Error('App feedback claim returned an unsupported delivery')
  }
  return {
    id,
    accountRole,
    kind,
    message: readText(record, 'message'),
    screenPath: readText(record, 'screenPath'),
    appVersion: readText(record, 'appVersion'),
    displayMode,
    createdAt: readText(record, 'createdAt'),
    sendTracker,
    sendTelegram,
  }
}

function parseClaimedBatch(value: unknown): ClaimedAppFeedbackBatch | null {
  if (value === null) return null
  const record = readRecord(value, 'App feedback claim')
  const dispatchToken = record.dispatchToken
  const deliveries = record.deliveries
  if (
    typeof dispatchToken !== 'string'
    || !UUID_PATTERN.test(dispatchToken)
    || !Array.isArray(deliveries)
    || deliveries.length === 0
    || deliveries.length > 20
  ) {
    throw new Error('App feedback claim returned an unsupported batch')
  }
  const parsed = deliveries.map(parseDelivery)
  if (new Set(parsed.map((delivery) => delivery.id)).size !== parsed.length) {
    throw new Error('App feedback claim returned duplicate deliveries')
  }
  return { dispatchToken, deliveries: parsed }
}

function parseCount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error('App feedback finalization returned an unsupported count')
  }
  return value
}

function parseFinalizeSummary(value: unknown): AppFeedbackFinalizeSummary {
  const record = readRecord(value, 'App feedback finalization')
  return {
    trackerSucceeded: parseCount(record.trackerSucceeded),
    trackerFailed: parseCount(record.trackerFailed),
    trackerDiscarded: parseCount(record.trackerDiscarded),
    telegramSucceeded: parseCount(record.telegramSucceeded),
    telegramFailed: parseCount(record.telegramFailed),
    telegramDiscarded: parseCount(record.telegramDiscarded),
  }
}

export async function claimAppFeedbackDeliveries(
  client: DatabaseClient,
  now: Date,
): Promise<ClaimedAppFeedbackBatch | null> {
  const rows = await client.query<ClaimedRow>(
    'select app_private.claim_app_feedback_deliveries(20, $1) as batch',
    [now.toISOString()],
  )
  return parseClaimedBatch(rows[0]?.batch)
}

export async function finalizeAppFeedbackDeliveries(
  client: DatabaseClient,
  dispatchToken: string,
  results: readonly AppFeedbackDeliveryResult[],
  now: Date,
): Promise<AppFeedbackFinalizeSummary> {
  const rows = await client.query<FinalizedRow>(
    `select app_private.finalize_app_feedback_deliveries(
      $1::uuid, $2::jsonb, $3
    ) as result`,
    [dispatchToken, JSON.stringify(results), now.toISOString()],
  )
  return parseFinalizeSummary(rows[0]?.result)
}
