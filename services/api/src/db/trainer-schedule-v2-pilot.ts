import type { QueryResultRow } from 'pg'

import type { DatabasePool } from './types.js'

export type TrainerScheduleV2PilotAction = 'inspect' | 'enable' | 'disable'

export interface TrainerScheduleV2PilotResult {
  accountRole: 'trainer'
  enabled: boolean
  enabledAssignments: number
}

export interface TrainerScheduleV2PilotManager {
  apply(action: TrainerScheduleV2PilotAction, profileId: string): Promise<TrainerScheduleV2PilotResult>
}

interface ProfileRow extends QueryResultRow {
  account_role: 'trainer' | 'client'
  pilot_allowed: boolean
  trainer_ready: boolean
}

interface AssignmentRow extends QueryResultRow {
  enabled: boolean
}

interface AssignmentCountRow extends QueryResultRow {
  enabled_assignments: number | string
}

export class TrainerScheduleV2PilotProfileNotReadyError extends Error {
  constructor() {
    super('The target profile is missing or is not a trainer')
    this.name = 'TrainerScheduleV2PilotProfileNotReadyError'
  }
}

export class DatabaseTrainerScheduleV2PilotManager implements TrainerScheduleV2PilotManager {
  constructor(private readonly pool: DatabasePool) {}

  async apply(
    action: TrainerScheduleV2PilotAction,
    profileId: string,
  ): Promise<TrainerScheduleV2PilotResult> {
    const connection = await this.pool.connect()
    let transactionStarted = false
    try {
      await connection.query('begin')
      transactionStarted = true
      await connection.query(
        "select pg_advisory_xact_lock(hashtextextended('trainer_schedule_v2', 0))",
      )
      const rows = await connection.query<ProfileRow>(`
        select profile.account_role,
          exists (
            select 1 from public.trainers trainer
            where trainer.profile_id = profile.id
          ) as trainer_ready,
          exists (
            select 1
            from app_private.trainer_schedule_v2_allowlist allowed
            where allowed.profile_id = profile.id
          ) as pilot_allowed
        from public.profiles profile
        where profile.id = $1
      `, [profileId])
      const profile = rows[0]
      if (
        profile === undefined
        || profile.account_role !== 'trainer'
        || !profile.trainer_ready
        || !profile.pilot_allowed
      ) {
        throw new TrainerScheduleV2PilotProfileNotReadyError()
      }

      if (action !== 'inspect') {
        await connection.query(`
          update app_private.user_experiment_assignments assignment
          set enabled = false, updated_at = now()
          where assignment.experiment_key = 'trainer_schedule_v2'
            and assignment.enabled = true
            and not exists (
              select 1
              from app_private.trainer_schedule_v2_allowlist allowed
              where allowed.profile_id = assignment.profile_id
            )
        `)
        await connection.query(`
          insert into app_private.user_experiment_assignments (
            profile_id, experiment_key, enabled, updated_at
          ) values ($1, 'trainer_schedule_v2', $2, now())
          on conflict (profile_id, experiment_key) do update set
            enabled = excluded.enabled,
            updated_at = excluded.updated_at
        `, [profileId, action === 'enable'])
      }

      const assignment = await connection.query<AssignmentRow>(`
        select enabled
        from app_private.user_experiment_assignments
        where profile_id = $1 and experiment_key = 'trainer_schedule_v2'
      `, [profileId])
      const assignmentCount = await connection.query<AssignmentCountRow>(`
        select count(*) as enabled_assignments
        from app_private.user_experiment_assignments
        where experiment_key = 'trainer_schedule_v2' and enabled = true
      `)
      const enabled = assignment[0]?.enabled === true
      const enabledAssignments = Number(assignmentCount[0]?.enabled_assignments ?? 0)
      if (
        enabledAssignments < 0
        || enabledAssignments > 2
        || (action === 'enable' && (!enabled || enabledAssignments < 1))
        || (action === 'disable' && enabled)
      ) {
        throw new Error('Trainer Schedule V2 two-account invariant failed')
      }
      await connection.query('commit')
      return { accountRole: 'trainer', enabled, enabledAssignments }
    } catch (error) {
      if (transactionStarted) await connection.query('rollback')
      throw error
    } finally {
      connection.release()
    }
  }
}
