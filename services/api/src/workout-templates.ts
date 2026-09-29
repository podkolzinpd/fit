import type { QueryResultRow } from 'pg'
import type { DatabaseClient, DatabasePool } from './db/types.js'
import { withYandexActorSession, type YandexActorSessionInput } from './yandex-actor-session.js'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export interface WorkoutTemplateDraft {
  id: string
  name: string
  notes: string | null
  exercises: readonly unknown[]
}

export interface WorkoutTemplate extends WorkoutTemplateDraft {
  trainerId: string
  version: number
  createdAt: string
  updatedAt: string
}

interface WorkoutTemplateRow extends QueryResultRow {
  id: string
  trainer_id: string
  name: string
  notes: string | null
  exercises: unknown
  version: string
  created_at: Date
  updated_at: Date
}

export type WorkoutTemplateFailure = 'conflict' | 'forbidden' | 'invalid' | 'not_found'
export class WorkoutTemplateError extends Error {
  constructor(readonly failure: WorkoutTemplateFailure) {
    super(`Workout template command failed: ${failure}`)
    this.name = 'WorkoutTemplateError'
  }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

export function readWorkoutTemplateRequest(body: unknown, routeId?: string): { draft: WorkoutTemplateDraft; expectedVersion: number | null } | undefined {
  const input = record(body)
  const draft = record(input?.draft)
  const id = routeId ?? draft?.id
  const name = typeof draft?.name === 'string' ? draft.name.trim() : ''
  const notes = draft?.notes === null || draft?.notes === undefined || draft?.notes === '' ? null : typeof draft.notes === 'string' ? draft.notes.trim() : undefined
  const exercises = draft?.exercises
  const expected = input?.expectedVersion
  const expectedVersion = expected === null || expected === undefined ? null : Number.isSafeInteger(expected) && Number(expected) >= 1 ? Number(expected) : undefined
  if (typeof id !== 'string' || !UUID_PATTERN.test(id) || name.length < 1 || name.length > 80
    || notes === undefined || (notes?.length ?? 0) > 5_000 || !Array.isArray(exercises)
    || exercises.length > 100 || expectedVersion === undefined) return undefined
  return { draft: { id, name, notes, exercises }, expectedVersion }
}

export function readWorkoutTemplateVersion(body: unknown): number | undefined {
  const value = record(body)?.expectedVersion
  return Number.isSafeInteger(value) && Number(value) >= 1 ? Number(value) : undefined
}

function mapTemplate(row: WorkoutTemplateRow): WorkoutTemplate {
  if (!Array.isArray(row.exercises)) throw new WorkoutTemplateError('invalid')
  const version = Number(row.version)
  if (!Number.isSafeInteger(version) || version < 1) throw new WorkoutTemplateError('invalid')
  return { id: row.id, trainerId: row.trainer_id, name: row.name, notes: row.notes, exercises: row.exercises, version,
    createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString() }
}

function mappedError(error: unknown): WorkoutTemplateError | undefined {
  if (!error || typeof error !== 'object' || !('message' in error)) return undefined
  const message = String(error.message)
  if (message.includes('workout_template_conflict')) return new WorkoutTemplateError('conflict')
  if (message.includes('workout_template_not_found')) return new WorkoutTemplateError('not_found')
  if (message.includes('trainer_not_initialized')) return new WorkoutTemplateError('forbidden')
  if (message.includes('invalid_workout_template')) return new WorkoutTemplateError('invalid')
  return undefined
}

async function run<Result>(work: () => Promise<Result>): Promise<Result> {
  try { return await work() } catch (error) { throw mappedError(error) ?? error }
}

export interface PilotWorkoutTemplates {
  list(session: YandexActorSessionInput): Promise<WorkoutTemplate[]>
  get(session: YandexActorSessionInput, id: string): Promise<WorkoutTemplate>
  save(session: YandexActorSessionInput, draft: WorkoutTemplateDraft, expectedVersion: number | null): Promise<WorkoutTemplate>
  archive(session: YandexActorSessionInput, id: string, expectedVersion: number): Promise<number>
}

async function getTemplate(client: DatabaseClient, id: string): Promise<WorkoutTemplate> {
  const rows = await client.query<WorkoutTemplateRow>('select id,trainer_id,name,notes,exercises,version,created_at,updated_at from public.workout_templates where id=$1 and archived_at is null', [id])
  if (!rows[0]) throw new WorkoutTemplateError('not_found')
  return mapTemplate(rows[0])
}

export class DatabasePilotWorkoutTemplates implements PilotWorkoutTemplates {
  constructor(private readonly pool: DatabasePool) {}
  list(session: YandexActorSessionInput): Promise<WorkoutTemplate[]> {
    return withYandexActorSession(this.pool, session, async (client) => {
      const rows = await client.query<WorkoutTemplateRow>('select id,trainer_id,name,notes,exercises,version,created_at,updated_at from public.workout_templates where archived_at is null order by updated_at desc')
      return rows.map(mapTemplate)
    })
  }
  get(session: YandexActorSessionInput, id: string): Promise<WorkoutTemplate> {
    return withYandexActorSession(this.pool, session, (client) => getTemplate(client, id))
  }
  save(session: YandexActorSessionInput, draft: WorkoutTemplateDraft, expectedVersion: number | null): Promise<WorkoutTemplate> {
    return withYandexActorSession(this.pool, session, (client) => run(async () => {
      await client.query('select public.save_workout_template($1::jsonb,$2)', [JSON.stringify(draft), expectedVersion])
      return getTemplate(client, draft.id)
    }))
  }
  archive(session: YandexActorSessionInput, id: string, expectedVersion: number): Promise<number> {
    return withYandexActorSession(this.pool, session, (client) => run(async () => {
      const rows = await client.query<{ version: string }>('select public.archive_workout_template($1,$2) as version', [id, expectedVersion])
      const version = Number(rows[0]?.version)
      if (!Number.isSafeInteger(version) || version < 1) throw new WorkoutTemplateError('invalid')
      return version
    }))
  }
}
