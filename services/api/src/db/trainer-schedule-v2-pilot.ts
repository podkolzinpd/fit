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
          ) as trainer_ready
        from public.profiles profile
        where profile.id = $1
      `, [profileId])
      const profile = rows[0]
      if (profile === undefined || profile.account_role !== 'trainer' || !profile.trainer_ready) {
        throw new TrainerScheduleV2PilotProfileNotReadyError()
      }

      if (action !== 'inspect') {
        await connection.query(`
          update app_private.user_experiment_assignments
          set enabled = false, updated_at = now()
          where experiment_key = 'trainer_schedule_v2' and enabled = true
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
      const expectedAssignments = action === 'enable' ? 1 : action === 'disable' ? 0 : undefined
      if (expectedAssignments !== undefined && enabledAssignments !== expectedAssignments) {
        throw new Error('Trainer Schedule V2 single-account invariant failed')
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
