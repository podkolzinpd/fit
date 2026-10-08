import type { QueryResultRow } from 'pg'
import type { DatabaseClient, DatabasePool } from './db/types.js'
import { PilotDomainCommandError } from './domain-commands.js'
import { withYandexActorSession, type YandexActorSessionInput } from './yandex-actor-session.js'

interface SummaryRow extends QueryResultRow {
  id: string
  workout_date: string
  status: 'planned' | 'in_progress' | 'done' | 'cancelled'
}

interface HomeRow extends SummaryRow {
  client_id: string
  client_name: string
  start_time: string | null
  exercise_count: string
  exercise_names: string[]
}

export interface ActiveWorkoutSummary {
  id: string
  workoutDate: string
  status: SummaryRow['status']
}

export interface HomeWorkoutSummary extends ActiveWorkoutSummary {
  clientId: string
  clientName: string
  startTime: string | null
  exerciseCount: number
  exerciseNames: string[]
}

export async function readActiveWorkout(client: DatabaseClient, clientId: string): Promise<ActiveWorkoutSummary | null> {
  const roots = await client.query<{ id: string }>('select id from public.clients where id = $1::uuid', [clientId])
  if (roots.length === 0) throw new PilotDomainCommandError('not_found')
  // Filter before LIMIT: an old active workout must not disappear behind history pages.
  const rows = await client.query<SummaryRow>(`
    select id, workout_date::text, status
    from public.workouts
    where client_id = $1::uuid and deleted_at is null and status = 'in_progress'
    order by workout_date desc, start_time desc nulls last, created_at desc, id
    limit 1
  `, [clientId])
  const row = rows[0]
  return row ? { id: row.id, workoutDate: row.workout_date, status: row.status } : null
}

export async function readWorkoutHome(client: DatabaseClient, today: string): Promise<HomeWorkoutSummary[]> {
  // Only representative roots are returned, not every history page. Keep all
  // active sessions/today plans; per client keep existence, latest done/past plan
  // and nearest upcoming plan, sufficient for the existing trainer home rules.
  // Timed and untimed representatives are separate: the existing Mono/Lime
  // context comparators differ for a null time, so neither candidate may be lost.
  // All reads use the existing actor RLS; sets and personal-record functions are absent.
  const rows = await client.query<HomeRow>(`
    with accessible as materialized (
      select w.id, w.client_id, c.full_name client_name,
        w.workout_date, w.start_time, w.status, w.created_at
      from public.workouts w join public.clients c on c.id = w.client_id
      where w.deleted_at is null
    ), ranked as (
      select a.*,
        row_number() over (partition by client_id
          order by workout_date desc, coalesce(start_time::text, '') desc, id desc) latest,
        row_number() over (partition by client_id, status, (start_time is null)
          order by workout_date desc, start_time desc nulls last, id desc) last_status,
        row_number() over (partition by client_id, status
          order by workout_date desc, start_time desc nulls last, created_at desc, id) classic_last_status,
        row_number() over (partition by client_id, status, (workout_date < $1::date)
          order by workout_date desc, start_time desc nulls last, created_at desc, id) last_in_group,
        row_number() over (partition by client_id, status, (workout_date < $1::date), (start_time is null)
          order by workout_date, start_time nulls first, id) first_in_group
      from accessible a
    )
    select r.id, r.client_id, r.client_name, r.workout_date::text, r.start_time, r.status,
      (select count(*)::text from public.workout_exercises e where e.workout_id = r.id) exercise_count,
      array(select e.exercise_name from public.workout_exercises e
        where e.workout_id = r.id order by e.position, e.id limit 2) exercise_names
    from ranked r
    where latest = 1 or status = 'in_progress'
      or (status = 'done' and (last_status = 1 or classic_last_status = 1))
      or (status = 'planned' and (workout_date = $1::date
        or (workout_date < $1::date and last_in_group = 1)
        or (workout_date >= $1::date and first_in_group = 1)))
    order by workout_date desc, start_time desc nulls last, created_at desc, id
  `, [today])
  return rows.map((row) => {
    const count = Number(row.exercise_count)
    if (!Number.isSafeInteger(count) || count < 0) throw new Error('Invalid home exercise count')
    return { id: row.id, clientId: row.client_id, clientName: row.client_name,
      workoutDate: row.workout_date, startTime: row.start_time, status: row.status,
      exerciseCount: count, exerciseNames: row.exercise_names }
  })
}

export interface WorkoutHomeReader {
  home(session: YandexActorSessionInput, today: string): Promise<HomeWorkoutSummary[]>
  active(session: YandexActorSessionInput, clientId: string): Promise<ActiveWorkoutSummary | null>
}

export class DatabaseWorkoutHomeReader implements WorkoutHomeReader {
  constructor(private readonly pool: DatabasePool) {}

  home(session: YandexActorSessionInput, today: string) {
    return withYandexActorSession(this.pool, session, (client) => readWorkoutHome(client, today), 'read-only-snapshot')
  }

  active(session: YandexActorSessionInput, clientId: string) {
    return withYandexActorSession(this.pool, session, (client) => readActiveWorkout(client, clientId), 'read-only-snapshot')
  }
}
