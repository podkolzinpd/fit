import type { QueryResultRow } from 'pg'

import { hashPilotSessionToken } from './auth/pilot-session-token.js'
import { PilotDomainCommandError } from './domain-commands.js'
import type { DatabaseClient, DatabasePool } from './db/types.js'
import {
  PilotSessionInvalidError,
  withYandexPilotSessionTransaction,
} from './db/yandex-pilot-transaction.js'
import type {
  GoalDraft,
  GoalStageDraft,
  MetricDraft,
  ProgressDraft,
} from './progress-request.js'

interface JsonRow extends QueryResultRow { result: unknown }
interface MutationRow extends QueryResultRow {
  resource_id: string
  archived_at?: Date | null
  version: string
}

export interface ProgressCursor {
  completedAt: string | null
  workoutId: string | null
}

function safeVersion(value: string): number {
  const result = Number(value)
  if (!Number.isSafeInteger(result) || result < 1) throw new Error('Invalid progress version')
  return result
}

function commandError(error: unknown): PilotDomainCommandError | undefined {
  if (typeof error !== 'object' || error === null || !('message' in error)) return undefined
  const message = error.message
  if (typeof message !== 'string') return undefined
  if (message.endsWith('_forbidden')) return new PilotDomainCommandError('forbidden')
  if (message.endsWith('_conflict')) return new PilotDomainCommandError('conflict')
  if (message.endsWith('_not_found')) return new PilotDomainCommandError('not_found')
  if (message.endsWith('_invalid')) return new PilotDomainCommandError('invalid')
  return undefined
}

async function command<Result>(work: () => Promise<Result>): Promise<Result> {
  try { return await work() } catch (error) { throw commandError(error) ?? error }
}

async function readJson(client: DatabaseClient, sql: string, values: readonly unknown[]) {
  return command(async () => {
    const rows = await client.query<JsonRow>(sql, values)
    if (rows[0] === undefined) throw new Error('Progress query returned no result')
    return rows[0].result
  })
}

export interface PilotProgressData {
  readBundle(sessionToken: string, clientId: string): Promise<unknown>
  readRegularity(sessionToken: string, clientId: string): Promise<unknown>
  readRunning(sessionToken: string, clientId: string, from: string, to: string): Promise<unknown>
  readExercise(sessionToken: string, clientId: string, exerciseRef: string,
    limit: number, cursor: ProgressCursor): Promise<unknown>
  readChronicle(sessionToken: string, clientId: string, limit: number,
    cursor: ProgressCursor): Promise<unknown>
  saveProgress(sessionToken: string, draft: ProgressDraft,
    expectedVersion: number | null): Promise<{ id: string; version: number }>
  deleteProgress(sessionToken: string, id: string, expectedVersion: number): Promise<number>
  saveMetric(sessionToken: string, draft: MetricDraft,
    expectedVersion: number | null): Promise<{ id: string; archivedAt: string | null; version: number }>
  setMetricArchived(sessionToken: string, id: string, archived: boolean,
    expectedVersion: number): Promise<{ id: string; archivedAt: string | null; version: number }>
  saveGoal(sessionToken: string, draft: GoalDraft,
    expectedVersion: number | null): Promise<{ id: string; version: number }>
  archiveGoal(sessionToken: string, id: string, expectedVersion: number): Promise<number>
  saveStage(sessionToken: string, draft: GoalStageDraft,
    expectedVersion: number | null): Promise<{ id: string; version: number }>
  deleteStage(sessionToken: string, id: string, expectedVersion: number): Promise<void>
}

export class DatabasePilotProgressData implements PilotProgressData {
  constructor(private readonly pool: DatabasePool) {}

  private withSession<Result>(sessionToken: string, work: (client: DatabaseClient) => Promise<Result>) {
    const tokenHash = hashPilotSessionToken(sessionToken)
    if (tokenHash === undefined) throw new PilotSessionInvalidError()
    return withYandexPilotSessionTransaction(this.pool, tokenHash, work)
  }

  readBundle(token: string, clientId: string) {
    return this.withSession(token, (client) =>
      readJson(client, 'select public.get_client_progress_bundle($1) result', [clientId]))
  }
  readRegularity(token: string, clientId: string) {
    return this.withSession(token, (client) =>
      readJson(client, 'select public.get_workout_regularity($1) result', [clientId]))
  }
  readRunning(token: string, clientId: string, from: string, to: string) {
    return this.withSession(token, (client) =>
      readJson(client, 'select public.list_running_progress($1, $2, $3) result', [clientId, from, to]))
  }
  readExercise(token: string, clientId: string, exerciseRef: string,
    limit: number, cursor: ProgressCursor) {
    return this.withSession(token, (client) => readJson(client,
      'select public.list_exercise_progress($1, $2, $3, $4, $5) result',
      [clientId, exerciseRef, limit, cursor.completedAt, cursor.workoutId]))
  }
  readChronicle(token: string, clientId: string, limit: number, cursor: ProgressCursor) {
    return this.withSession(token, (client) => readJson(client,
      'select public.list_workout_chronicle($1, $2, $3, $4) result',
      [clientId, limit, cursor.completedAt, cursor.workoutId]))
  }

  saveProgress(token: string, draft: ProgressDraft, expectedVersion: number | null) {
    return this.withSession(token, (client) => command(async () => {
      const rows = await client.query<MutationRow>(
        'select progress_id resource_id, version from public.save_client_progress($1::jsonb, $2)',
        [JSON.stringify(draft), expectedVersion])
      const row = rows[0]
      if (row === undefined) throw new Error('Progress command returned no result')
      return { id: row.resource_id, version: safeVersion(row.version) }
    }))
  }
  deleteProgress(token: string, id: string, expectedVersion: number) {
    return this.withSession(token, (client) => command(async () => {
      const rows = await client.query<MutationRow>(
        'select $1::uuid resource_id, public.delete_client_progress($1, $2) version', [id, expectedVersion])
      return safeVersion(rows[0]?.version ?? '')
    }))
  }
  saveMetric(token: string, draft: MetricDraft, expectedVersion: number | null) {
    return this.metricCommand(token,
      'select metric_id resource_id, archived_at, version from public.save_client_metric($1::jsonb, $2)',
      [JSON.stringify(draft), expectedVersion])
  }
  setMetricArchived(token: string, id: string, archived: boolean, expectedVersion: number) {
    return this.metricCommand(token,
      'select metric_id resource_id, archived_at, version from public.set_client_metric_archived($1, $2, $3)',
      [id, archived, expectedVersion])
  }
  private metricCommand(token: string, sql: string, values: readonly unknown[]) {
    return this.withSession(token, (client) => command(async () => {
      const rows = await client.query<MutationRow>(sql, values)
      const row = rows[0]
      if (row === undefined) throw new Error('Metric command returned no result')
      return { id: row.resource_id, archivedAt: row.archived_at?.toISOString() ?? null,
        version: safeVersion(row.version) }
    }))
  }
  saveGoal(token: string, draft: GoalDraft, expectedVersion: number | null) {
    return this.versionedResourceCommand(token,
      'select goal_id resource_id, version from public.save_client_goal($1::jsonb, $2)',
      [JSON.stringify(draft), expectedVersion])
  }
  archiveGoal(token: string, id: string, expectedVersion: number) {
    return this.withSession(token, (client) => command(async () => {
      const rows = await client.query<MutationRow>(
        'select $1::uuid resource_id, public.archive_client_goal($1, $2) version', [id, expectedVersion])
      return safeVersion(rows[0]?.version ?? '')
    }))
  }
  saveStage(token: string, draft: GoalStageDraft, expectedVersion: number | null) {
    return this.versionedResourceCommand(token,
      'select stage_id resource_id, version from public.save_goal_stage($1::jsonb, $2)',
      [JSON.stringify(draft), expectedVersion])
  }
  deleteStage(token: string, id: string, expectedVersion: number) {
    return this.withSession(token, (client) => command(async () => {
      await client.query('select public.delete_goal_stage($1, $2)', [id, expectedVersion])
    }))
  }
  private versionedResourceCommand(token: string, sql: string, values: readonly unknown[]) {
    return this.withSession(token, (client) => command(async () => {
      const rows = await client.query<MutationRow>(sql, values)
      const row = rows[0]
      if (row === undefined) throw new Error('Progress resource command returned no result')
      return { id: row.resource_id, version: safeVersion(row.version) }
    }))
  }
}
