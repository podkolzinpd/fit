import type { QueryResultRow } from 'pg'
import type { DatabaseClient, DatabasePool } from './types.js'
import { buildFitLimeCalendarPlan, FIT_LIME_CALENDAR_BATCH, FIT_LIME_CALENDAR_LOGINS } from './fit-lime-calendar-plan.js'

export type FitLimeCalendarAction = 'inspect' | 'seed' | 'cleanup'
export class FitLimeCalendarNotReadyError extends Error {}
interface Trainer extends QueryResultRow { profile_id: string; timezone: string; today: string; monday: string; enabled: boolean; schedule_enabled: boolean }
interface Counts extends QueryResultRow { clients: number; workouts: number; active: number; done: number; planned: number; cancelled: number; untimed: number; visible: number; cleaned: boolean }
export interface FitLimeCalendarResult { batch: string; created: boolean; trainers: Counts[]; isolated: boolean }
export interface FitLimeCalendarManager { apply(action: FitLimeCalendarAction): Promise<FitLimeCalendarResult> }

async function counts(client: DatabaseClient, trainerId: string): Promise<Counts> {
  const rows = await client.query<Counts>(`select
    (select count(*)::int from app_private.fit_lime_calendar_clients f where f.trainer_id = $1 and f.batch_id = $2) clients,
    count(w.id)::int workouts,
    count(*) filter (where w.status = 'in_progress' and w.deleted_at is null)::int active,
    count(*) filter (where w.status = 'done' and w.deleted_at is null)::int done,
    count(*) filter (where w.status = 'planned' and w.deleted_at is null)::int planned,
    count(*) filter (where w.status = 'cancelled' and w.deleted_at is null)::int cancelled,
    count(*) filter (where w.start_time is null and w.deleted_at is null)::int untimed,
    count(*) filter (where w.deleted_at is null)::int visible,
    coalesce((select cleaned_at is not null from app_private.fit_lime_calendar_batches b where b.trainer_id = $1 and b.batch_id = $2), false) cleaned
    from app_private.fit_lime_calendar_workouts f
    join public.workouts w on w.id = f.workout_id
    join app_private.fit_lime_calendar_clients c on c.client_id = f.client_id
    where c.trainer_id = $1 and c.batch_id = $2`, [trainerId, FIT_LIME_CALENDAR_BATCH])
  if (!rows[0]) throw new Error('Missing fixture counts')
  return rows[0]
}

async function assertIsolated(client: DatabaseClient) {
  const rows = await client.query<{ violations: number }>(`select (
    (select count(*) from public.clients c join app_private.fit_lime_calendar_clients f on f.client_id = c.id where c.auth_user_id is not null or c.merged_into_client_id is not null)
    + (select count(*) from public.trainer_finance_sessions s join app_private.fit_lime_calendar_clients f on f.client_id = s.client_id)
    + (select count(*) from app_private.push_notifications_outbox p join app_private.fit_lime_calendar_workouts f on p.data->>'workout_id' = f.workout_id::text)
    + (select count(*) from analytics.client_overview a join app_private.fit_lime_calendar_clients f on f.client_id = a.client_id)
  )::int violations`)
  if (rows[0]?.violations !== 0) throw new FitLimeCalendarNotReadyError('Fixture isolation check failed')
}

async function seedTrainer(client: DatabaseClient, trainer: Trainer) {
  const plan = buildFitLimeCalendarPlan(trainer.profile_id, trainer.monday, trainer.today)
  await client.query(`insert into app_private.fit_lime_calendar_batches (batch_id, trainer_id, anchor_date) values ($1, $2, $3)`, [FIT_LIME_CALENDAR_BATCH, trainer.profile_id, trainer.monday])
  for (const item of plan.clients) {
    await client.query(`insert into app_private.fit_lime_calendar_clients (client_id, batch_id, trainer_id) values ($1, $2, $3)`, [item.id, FIT_LIME_CALENDAR_BATCH, trainer.profile_id])
    await client.query(`insert into public.clients (id, trainer_id, full_name) values ($1, $2, $3)`, [item.id, trainer.profile_id, item.fullName])
    await client.query(`insert into public.client_trainers (client_id, trainer_id, alias) values ($1, $2, $3)`, [item.id, trainer.profile_id, item.fullName])
  }
  for (const item of plan.workouts) {
    await client.query(`insert into app_private.fit_lime_calendar_workouts (workout_id, client_id) values ($1, $2)`, [item.id, item.clientId])
    await client.query(`insert into public.workouts
      (id, trainer_id, client_id, created_by, workout_date, start_time, end_time, status, title, training_format, started_at, completed_at, started_by, completed_by)
      values ($1, $2, $3, $2, $4, $5, $6, $7, $8, 'with_trainer',
        case when $7 = 'in_progress' then now() when $7 = 'done' then ($4::date + coalesce($5::time, time '10:00')) at time zone $9 else null end,
        case when $7 = 'done' then ($4::date + coalesce($6::time, time '11:00')) at time zone $9 else null end,
        case when $7 in ('in_progress', 'done') then $2::uuid else null end,
        case when $7 = 'done' then $2::uuid else null end)`,
    [item.id, trainer.profile_id, item.clientId, item.workoutDate, item.startTime, item.endTime, item.status, item.title, trainer.timezone])
    if (!item.withExercises) continue
    await client.query(`insert into public.workout_exercises
      (id, workout_id, trainer_id, client_id, position, exercise_source, exercise_ref, exercise_name, muscle_group, input_kind, block_id)
      values ($1, $2, $3, $4, 0, 'system', $6, $7, $8, $9, $5)`,
    [item.exerciseId, item.id, trainer.profile_id, item.clientId, item.blockId, item.exercise.ref, item.exercise.name, item.exercise.group, item.exercise.kind])
    for (const [position, setId] of item.setIds.entries()) {
      await client.query(`insert into public.workout_sets
        (id, workout_exercise_id, trainer_id, client_id, position, plan_weight_kg, plan_reps,
          plan_duration_sec, plan_distance_km, fact_weight_kg, fact_reps, fact_duration_sec, fact_distance_km, confirmed_at)
        values ($1, $2, $3, $4, $5,
          case when $8 = 'strength' then 30 else null end, case when $8 = 'strength' then 10 else null end,
          case when $8 = 'duration' then 30 when $8 = 'distance' then 300 else null end, case when $8 = 'distance' then 0.5 else null end,
          case when $6 and $8 = 'strength' then 30 else null end, case when $6 and $8 = 'strength' then 10 else null end,
          case when $6 and $8 = 'duration' then 30 when $6 and $8 = 'distance' then 300 else null end,
          case when $6 and $8 = 'distance' then 0.5 else null end,
          case when $6 then (select completed_at from public.workouts where id = $7) else null end)`,
      [setId, item.exerciseId, trainer.profile_id, item.clientId, position, item.status === 'done', item.id, item.exercise.kind])
    }
  }
}

export class DatabaseFitLimeCalendarManager implements FitLimeCalendarManager {
  constructor(private readonly pool: DatabasePool) {}
  async apply(action: FitLimeCalendarAction): Promise<FitLimeCalendarResult> {
    const connection = await this.pool.connect()
    let started = false
    try {
      await connection.query('begin isolation level repeatable read')
      started = true
      await connection.query("select pg_advisory_xact_lock(hashtextextended('fit_lime_calendar_20261003', 0))")
      const trainers = await connection.query<Trainer>(`select p.id profile_id, p.timezone,
        (now() at time zone p.timezone)::date::text today,
        date_trunc('week', now() at time zone p.timezone)::date::text monday,
        a.enabled, e.enabled schedule_enabled
        from app_private.fit_lime_pilot_allowlist a
        join public.profiles p on p.id = a.profile_id and p.account_role = 'trainer'
        join public.trainers t on t.profile_id = p.id
        join app_private.trainer_schedule_v2_allowlist s on s.profile_id = p.id and s.login_sha256 = a.login_sha256
        join app_private.user_experiment_assignments e on e.profile_id = p.id and e.experiment_key = 'trainer_schedule_v2'
        where a.login_sha256 = any($1::text[]) order by a.login_sha256
        for share of a, s, p, t, e`, [FIT_LIME_CALENDAR_LOGINS])
      if (trainers.length !== 2 || new Set(trainers.map((item) => item.profile_id)).size !== 2
        || (action === 'seed' && trainers.some((item) => !item.enabled || !item.schedule_enabled))) {
        throw new FitLimeCalendarNotReadyError('Exactly two bound pilot trainers required')
      }
      const batches = await connection.query<{ count: number }>(`select count(*)::int count from app_private.fit_lime_calendar_batches where batch_id = $1`, [FIT_LIME_CALENDAR_BATCH])
      const batchCount = batches[0]?.count
      if (batchCount !== 0 && batchCount !== 2) throw new FitLimeCalendarNotReadyError('Partial fixture batch')
      let created = false
      if (action === 'seed' && batchCount === 0) {
        for (const trainer of trainers) await seedTrainer(connection, trainer)
        created = true
      }
      if (action === 'cleanup' && batchCount === 2) {
        const edited = await connection.query<{ count: number }>(`select (
          (select count(*) from public.clients c join app_private.fit_lime_calendar_clients f on f.client_id = c.id where c.version <> 1)
          + (select count(*) from public.workouts w join app_private.fit_lime_calendar_clients f on f.client_id = w.client_id where w.version <> 1 or not exists (select 1 from app_private.fit_lime_calendar_workouts fw where fw.workout_id = w.id))
          + (select count(*) from public.workout_exercises e join app_private.fit_lime_calendar_clients f on f.client_id = e.client_id where e.updated_at <> e.created_at)
          + (select count(*) from public.workout_sets s join app_private.fit_lime_calendar_clients f on f.client_id = s.client_id where s.version <> 1 or s.updated_at <> s.created_at)
        )::int count`)
        const prior = await counts(connection, trainers[0]!.profile_id)
        if (!prior.cleaned) {
          if (edited[0]?.count !== 0) throw new FitLimeCalendarNotReadyError('Edited fixtures need individual review before cleanup')
          await connection.query(`update public.workouts w set deleted_at = now(), version = version + 1
            where exists (select 1 from app_private.fit_lime_calendar_workouts f where f.workout_id = w.id)`)
          await connection.query(`update public.clients c set archived_at = now(), version = version + 1
            where exists (select 1 from app_private.fit_lime_calendar_clients f where f.client_id = c.id)`)
          await connection.query(`update app_private.fit_lime_calendar_batches set cleaned_at = now() where batch_id = $1`, [FIT_LIME_CALENDAR_BATCH])
        }
      }
      const results: Counts[] = []
      for (const trainer of trainers) results.push(await counts(connection, trainer.profile_id))
      if (action === 'seed' && results.some((item) => item.clients !== 15 || item.workouts !== 60 || item.cleaned)) throw new FitLimeCalendarNotReadyError('Fixture count or cleanup invariant')
      await assertIsolated(connection)
      await connection.query('commit')
      return { batch: FIT_LIME_CALENDAR_BATCH, created, trainers: results, isolated: true }
    } catch (error) {
      if (started) await connection.query('rollback')
      throw error
    } finally { connection.release() }
  }
}
