import type { QueryResultRow } from 'pg'

import {
  fingerprintStandaloneClient,
  fingerprintTenant,
} from '../tenant-migration/bundle.js'
import type { DatabaseConnection, DatabasePool } from './types.js'

export type StageRolloutAssignmentAction = 'inspect' | 'enable' | 'disable'

export type StageRolloutAssignmentTarget =
  | { profileId: string }
  | { tenantFingerprint: string }

export interface StageRolloutAssignmentResult {
  accountRole: 'trainer' | 'client'
  domainReady: boolean
  identityLinked: boolean
  rolloutEnabled: boolean
}

export interface StageRolloutAssignmentManager {
  apply(
    action: StageRolloutAssignmentAction,
    target: StageRolloutAssignmentTarget,
  ): Promise<StageRolloutAssignmentResult>
}

interface ProfileCandidateRow extends QueryResultRow {
  account_role: 'trainer' | 'client'
  id: string
}

interface ProfileReadinessRow extends QueryResultRow {
  account_role: 'trainer' | 'client'
  domain_ready: boolean
  identity_linked: boolean
}

interface RolloutRow extends QueryResultRow {
  rollout_enabled: boolean
}

export class StageRolloutProfileNotReadyError extends Error {
  constructor() {
    super('The profile is missing or its domain root was not migrated')
    this.name = 'StageRolloutProfileNotReadyError'
  }
}

export class DatabaseStageRolloutAssignmentManager
implements StageRolloutAssignmentManager {
  constructor(private readonly pool: DatabasePool) {}

  async apply(
    action: StageRolloutAssignmentAction,
    target: StageRolloutAssignmentTarget,
  ): Promise<StageRolloutAssignmentResult> {
    const connection = await this.pool.connect()
    let transactionStarted = false

    try {
      await connection.query('begin')
      transactionStarted = true
      const profileId = 'profileId' in target
        ? target.profileId
        : await this.resolveProfileId(
            connection,
            target.tenantFingerprint,
          )
      await connection.query(
        'select pg_advisory_xact_lock(hashtextextended($1, 0))',
        [profileId],
      )

      const readiness = await connection.query<ProfileReadinessRow>(
        `
          select
            profile.account_role,
            case profile.account_role
              when 'trainer' then exists (
                select 1 from public.trainers trainer
                where trainer.profile_id = profile.id
              )
              when 'client' then exists (
                select 1 from public.clients client
                where client.auth_user_id = profile.id
              )
              else false
            end as domain_ready,
            exists (
              select 1 from app_private.auth_identities identity
              where identity.profile_id = profile.id
                and identity.provider = 'yandex'
            ) as identity_linked
          from public.profiles profile
          where profile.id = $1
        `,
        [profileId],
      )
      const profile = readiness[0]
      if (profile === undefined || !profile.domain_ready) {
        throw new StageRolloutProfileNotReadyError()
      }

      let rolloutEnabled: boolean
      if (action === 'inspect') {
        const rollout = await connection.query<RolloutRow>(
          `
            select coalesce(bool_or(
              assignment.target_backend = 'yandex'
              and assignment.access_mode = 'read_write'
              and assignment.enabled
            ), false) as rollout_enabled
            from app_private.profile_rollout_assignments assignment
            where assignment.profile_id = $1
          `,
          [profileId],
        )
        rolloutEnabled = rollout[0]?.rollout_enabled === true
      } else {
        rolloutEnabled = action === 'enable'
        await connection.query(
          `
            insert into app_private.profile_rollout_assignments (
              profile_id, target_backend, access_mode, enabled
            ) values ($1, 'yandex', 'read_write', $2)
            on conflict (profile_id) do update set
              target_backend = excluded.target_backend,
              access_mode = excluded.access_mode,
              enabled = excluded.enabled
          `,
          [profileId, rolloutEnabled],
        )
      }

      await connection.query('commit')
      return {
        accountRole: profile.account_role,
        domainReady: true,
        identityLinked: profile.identity_linked,
        rolloutEnabled,
      }
    } catch (error) {
      if (transactionStarted) {
        try {
          await connection.query('rollback')
        } catch (rollbackError) {
          throw new AggregateError(
            [error, rollbackError],
            'Stage rollout assignment and rollback both failed',
            { cause: rollbackError },
          )
        }
      }
      throw error
    } finally {
      connection.release()
    }
  }

  private async resolveProfileId(
    connection: DatabaseConnection,
    tenantFingerprint: string,
  ): Promise<string> {
    const candidates = await connection.query<ProfileCandidateRow>(
      `
        select profile.id::text, profile.account_role
        from public.profiles profile
        where profile.account_role in ('trainer', 'client')
      `,
    )
    const matches = candidates.filter((candidate) => (
      candidate.account_role === 'trainer'
        ? fingerprintTenant(candidate.id)
        : fingerprintStandaloneClient(candidate.id)
    ) === tenantFingerprint)
    const match = matches[0]
    if (match === undefined || matches.length !== 1) {
      throw new StageRolloutProfileNotReadyError()
    }
    return match.id
  }
}
