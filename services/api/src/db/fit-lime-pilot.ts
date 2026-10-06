import type { QueryResultRow } from 'pg'

import type { DatabasePool } from './types.js'

export type FitLimePilotAction = 'inspect' | 'enable' | 'disable'

export interface FitLimePilotResult {
  accountRole: 'trainer'
  enabled: boolean
  enabledAllowlistRows: number
}

export interface FitLimePilotManager {
  apply(action: FitLimePilotAction, profileId: string): Promise<FitLimePilotResult>
}

interface ProfileRow extends QueryResultRow {
  account_role: 'trainer' | 'client'
  trainer_ready: boolean
  pilot_allowed: boolean
}

interface FlagRow extends QueryResultRow { enabled: boolean }
interface CountRow extends QueryResultRow { enabled_rows: number | string }

export class FitLimePilotProfileNotReadyError extends Error {
  constructor() {
    super('The target profile is missing or is not an allowlisted trainer')
    this.name = 'FitLimePilotProfileNotReadyError'
  }
}

export class DatabaseFitLimePilotManager implements FitLimePilotManager {
  constructor(private readonly pool: DatabasePool) {}

  async apply(action: FitLimePilotAction, profileId: string): Promise<FitLimePilotResult> {
    const connection = await this.pool.connect()
    let transactionStarted = false
    try {
      await connection.query('begin')
      transactionStarted = true
      await connection.query(
        "select pg_advisory_xact_lock(hashtextextended('fit_lime_pilot', 0))",
      )
      const rows = await connection.query<ProfileRow>(`
        select profile.account_role,
          exists (
            select 1 from public.trainers trainer
            where trainer.profile_id = profile.id
          ) as trainer_ready,
          exists (
            select 1 from app_private.fit_lime_pilot_allowlist allowed
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
        throw new FitLimePilotProfileNotReadyError()
      }

      if (action !== 'inspect') {
        await connection.query(`
          update app_private.fit_lime_pilot_allowlist
          set enabled = $2, updated_at = now()
          where profile_id = $1
        `, [profileId, action === 'enable'])
      }

      const flag = await connection.query<FlagRow>(`
        select enabled
        from app_private.fit_lime_pilot_allowlist
        where profile_id = $1
      `, [profileId])
      const count = await connection.query<CountRow>(`
        select count(*) as enabled_rows
        from app_private.fit_lime_pilot_allowlist
        where enabled = true
      `)
      const enabled = flag[0]?.enabled === true
      const enabledAllowlistRows = Number(count[0]?.enabled_rows ?? 0)
      if (
        enabledAllowlistRows < 0
        || enabledAllowlistRows > 3
        || (action === 'enable' && !enabled)
        || (action === 'disable' && enabled)
      ) {
        throw new Error('Fit Lime three-account invariant failed')
      }
      await connection.query('commit')
      return { accountRole: 'trainer', enabled, enabledAllowlistRows }
    } catch (error) {
      if (transactionStarted) await connection.query('rollback')
      throw error
    } finally {
      connection.release()
    }
  }
}
