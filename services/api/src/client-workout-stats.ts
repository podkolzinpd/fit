import type { QueryResultRow } from 'pg'

import type { DatabaseClient, DatabasePool } from './db/types.js'
import { PilotDomainCommandError } from './domain-commands.js'
import { withYandexActorSession, type YandexActorSessionInput } from './yandex-actor-session.js'

export interface ClientWorkoutStats {
  doneCount: number
  completionPercent: number | null
  lastWorkoutDate: string | null
  daysInWork: number | null
  needsAttention: boolean
}

interface StatsRow extends QueryResultRow {
  done_count: string
  missed_count: string
  last_workout_date: string | null
  days_in_work: number | null
  needs_attention: boolean
}

export async function readClientWorkoutStats(
  client: DatabaseClient, clientId: string, today: string,
): Promise<ClientWorkoutStats> {
  // A visible client root distinguishes an empty history from a forbidden ID.
  // Both tables are read under the existing actor RLS in one SQL snapshot.
  const rows = await client.query<StatsRow>(`
    select stats.done_count, stats.missed_count,
      stats.last_workout_date::text,
      case when stats.first_workout_date is null then null
        else greatest(0, $2::date - stats.first_workout_date) end as days_in_work,
      coalesce($2::date - stats.last_workout_date >= 14, false) as needs_attention
    from public.clients root
    cross join lateral (
      select count(*) filter (where workout.status = 'done') as done_count,
        count(*) filter (where workout.status = 'cancelled'
          or (workout.status = 'planned' and workout.workout_date < $2::date)) as missed_count,
        max(workout.workout_date) filter (where workout.status = 'done') as last_workout_date,
        min(workout.workout_date) as first_workout_date
      from public.workouts workout
      where workout.client_id = root.id and workout.deleted_at is null
    ) stats
    where root.id = $1::uuid
  `, [clientId, today])
  const row = rows[0]
  if (row === undefined) throw new PilotDomainCommandError('not_found')
  const doneCount = Number(row.done_count)
  const missedCount = Number(row.missed_count)
  if (!Number.isSafeInteger(doneCount) || doneCount < 0
    || !Number.isSafeInteger(missedCount) || missedCount < 0
    || !Number.isSafeInteger(doneCount + missedCount)) throw new Error('Invalid workout stats count')
  return {
    doneCount,
    completionPercent: doneCount + missedCount === 0 ? null
      : Math.round(doneCount / (doneCount + missedCount) * 100),
    lastWorkoutDate: row.last_workout_date,
    daysInWork: row.days_in_work,
    needsAttention: row.needs_attention,
  }
}

export interface ClientWorkoutStatsReader {
  read(session: YandexActorSessionInput, clientId: string, today: string): Promise<ClientWorkoutStats>
}

export class DatabaseClientWorkoutStatsReader implements ClientWorkoutStatsReader {
  constructor(private readonly pool: DatabasePool) {}

  read(session: YandexActorSessionInput, clientId: string, today: string) {
    return withYandexActorSession(this.pool, session,
      (client) => readClientWorkoutStats(client, clientId, today))
  }
}
