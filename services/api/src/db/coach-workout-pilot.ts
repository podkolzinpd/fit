import type { QueryResultRow } from 'pg'
import type { DatabasePool } from './types.js'
import { FIT_LIME_CALENDAR_LOGINS } from './fit-lime-calendar-plan.js'

/** Read-only, fixed cohort inspection on the private IAM migration runner.
 * The resulting two public UUIDs configure the UI build, not authorization.
 * No arbitrary login/profile input, sessions, credentials or user records. */
export async function inspectCoachWorkoutPilot(pool: DatabasePool): Promise<string[]> {
  const connection = await pool.connect()
  try {
    const rows = await connection.query<QueryResultRow & { profile_id: string }>(`
    select a.profile_id::text profile_id
    from app_private.fit_lime_pilot_allowlist a
    join public.profiles p on p.id = a.profile_id and p.account_role = 'trainer'
    join public.trainers t on t.profile_id = p.id
    join app_private.trainer_schedule_v2_allowlist s
      on s.profile_id = p.id and s.login_sha256 = a.login_sha256
    where a.login_sha256 = any($1::text[])
    order by a.login_sha256
  `, [FIT_LIME_CALENDAR_LOGINS])
    const ids = rows.map((row) => row.profile_id)
    if (ids.length !== 2 || new Set(ids).size !== 2
      || ids.some((id) => !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id))) {
      throw new Error('Two bound trainer identities required')
    }
    return ids
  } finally { connection.release() }
}
