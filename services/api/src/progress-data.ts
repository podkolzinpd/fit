import type { QueryResultRow } from 'pg'

import { PilotDomainCommandError } from './domain-commands.js'
import type { DatabaseClient, DatabasePool } from './db/types.js'
import {
  withYandexActorSession,
  type YandexActorSessionInput,
} from './yandex-actor-session.js'
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
  readBundle(session: YandexActorSessionInput, clientId: string): Promise<unknown>
  readRegularity(session: YandexActorSessionInput, clientId: string): Promise<unknown>
  readRunning(session: YandexActorSessionInput, clientId: string, from: string, to: string): Promise<unknown>
  readExercise(session: YandexActorSessionInput, clientId: string, exerciseRef: string,
    limit: number, cursor: ProgressCursor): Promise<unknown>
  readChronicle(session: YandexActorSessionInput, clientId: string, limit: number,
    cursor: ProgressCursor): Promise<unknown>
  saveProgress(session: YandexActorSessionInput, draft: ProgressDraft,
    expectedVersion: number | null): Promise<{ id: string; version: number }>
  deleteProgress(session: YandexActorSessionInput, id: string, expectedVersion: number): Promise<number>
  saveMetric(session: YandexActorSessionInput, draft: MetricDraft,
    expectedVersion: number | null): Promise<{ id: string; archivedAt: string | null; version: number }>
  setMetricArchived(session: YandexActorSessionInput, id: string, archived: boolean,
    expectedVersion: number): Promise<{ id: string; archivedAt: string | null; version: number }>
  saveGoal(session: YandexActorSessionInput, draft: GoalDraft,
    expectedVersion: number | null): Promise<{ id: string; version: number }>
  archiveGoal(session: YandexActorSessionInput, id: string, expectedVersion: number): Promise<number>
  saveStage(session: YandexActorSessionInput, draft: GoalStageDraft,
    expectedVersion: number | null): Promise<{ id: string; version: number }>
  deleteStage(session: YandexActorSessionInput, id: string, expectedVersion: number): Promise<void>
}

export class DatabasePilotProgressData implements PilotProgressData {
  constructor(private readonly pool: DatabasePool) {}

  private withSession<Result>(session: YandexActorSessionInput, work: (client: DatabaseClient) => Promise<Result>) {
    return withYandexActorSession(this.pool, session, work)
  }

  readBundle(session: YandexActorSessionInput, clientId: string) {
    return this.withSession(session, (client) =>
      readJson(client, 'select public.get_client_progress_bundle($1) result', [clientId]))
  }
  readRegularity(session: YandexActorSessionInput, clientId: string) {
    return this.withSession(session, (client) =>
      readJson(client, 'select public.get_workout_regularity($1) result', [clientId]))
  }
  readRunning(session: YandexActorSessionInput, clientId: string, from: string, to: string) {
    return this.withSession(session, (client) =>
      readJson(client, 'select public.list_running_progress($1, $2, $3) result', [clientId, from, to]))
  }
  readExercise(session: YandexActorSessionInput, clientId: string, exerciseRef: string,
    limit: number, cursor: ProgressCursor) {
    return this.withSession(session, (client) => readJson(client,
      'select public.list_exercise_progress($1, $2, $3, $4, $5) result',
      [clientId, exerciseRef, limit, cursor.completedAt, cursor.workoutId]))
  }
  readChronicle(session: YandexActorSessionInput, clientId: string, limit: number, cursor: ProgressCursor) {
    return this.withSession(session, (client) => readJson(client,
      'select public.list_workout_chronicle($1, $2, $3, $4) result',
      [clientId, limit, cursor.completedAt, cursor.workoutId]))
  }

  saveProgress(session: YandexActorSessionInput, draft: ProgressDraft, expectedVersion: number | null) {
    return this.withSession(session, (client) => command(async () => {
      const rows = await client.query<MutationRow>(
        'select progress_id resource_id, version from public.save_client_progress($1::jsonb, $2)',
        [JSON.stringify(draft), expectedVersion])
      const row = rows[0]
      if (row === undefined) throw new Error('Progress command returned no result')
      return { id: row.resource_id, version: safeVersion(row.version) }
    }))
  }
  deleteProgress(session: YandexActorSessionInput, id: string, expectedVersion: number) {
    return this.withSession(session, (client) => command(async () => {
      const rows = await client.query<MutationRow>(
        'select $1::uuid resource_id, public.delete_client_progress($1, $2) version', [id, expectedVersion])
      return safeVersion(rows[0]?.version ?? '')
    }))
  }
  saveMetric(session: YandexActorSessionInput, draft: MetricDraft, expectedVersion: number | null) {
    return this.metricCommand(session,
      'select metric_id resource_id, archived_at, version from public.save_client_metric($1::jsonb, $2)',
      [JSON.stringify(draft), expectedVersion])
  }
  setMetricArchived(session: YandexActorSessionInput, id: string, archived: boolean, expectedVersion: number) {
    return this.metricCommand(session,
      'select metric_id resource_id, archived_at, version from public.set_client_metric_archived($1, $2, $3)',
      [id, archived, expectedVersion])
  }
  private metricCommand(session: YandexActorSessionInput, sql: string, values: readonly unknown[]) {
    return this.withSession(session, (client) => command(async () => {
      const rows = await client.query<MutationRow>(sql, values)
      const row = rows[0]
      if (row === undefined) throw new Error('Metric command returned no result')
      return { id: row.resource_id, archivedAt: row.archived_at?.toISOString() ?? null,
        version: safeVersion(row.version) }
    }))
  }
  saveGoal(session: YandexActorSessionInput, draft: GoalDraft, expectedVersion: number | null) {
    return this.versionedResourceCommand(session,
      'select goal_id resource_id, version from public.save_client_goal($1::jsonb, $2)',
      [JSON.stringify(draft), expectedVersion])
  }
  archiveGoal(session: YandexActorSessionInput, id: string, expectedVersion: number) {
    return this.withSession(session, (client) => command(async () => {
      const rows = await client.query<MutationRow>(
        'select $1::uuid resource_id, public.archive_client_goal($1, $2) version', [id, expectedVersion])
      return safeVersion(rows[0]?.version ?? '')
    }))
  }
  saveStage(session: YandexActorSessionInput, draft: GoalStageDraft, expectedVersion: number | null) {
    return this.versionedResourceCommand(session,
      'select stage_id resource_id, version from public.save_goal_stage($1::jsonb, $2)',
      [JSON.stringify(draft), expectedVersion])
  }
  deleteStage(session: YandexActorSessionInput, id: string, expectedVersion: number) {
    return this.withSession(session, (client) => command(async () => {
      await client.query('select public.delete_goal_stage($1, $2)', [id, expectedVersion])
    }))
  }
  private versionedResourceCommand(session: YandexActorSessionInput, sql: string, values: readonly unknown[]) {
    return this.withSession(session, (client) => command(async () => {
      const rows = await client.query<MutationRow>(sql, values)
      const row = rows[0]
      if (row === undefined) throw new Error('Progress resource command returned no result')
      return { id: row.resource_id, version: safeVersion(row.version) }
    }))
  }
}
