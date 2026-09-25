import { createHash } from 'node:crypto'
import type { QueryResultRow } from 'pg'

import type { DatabasePool } from './db/types.js'
import {
  withYandexActorSession,
  type YandexActorSession,
} from './yandex-actor-session.js'

const CLAIM_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/

interface ClaimTokenRow extends QueryResultRow {
  token_hash: string
}

interface ProfileRow extends QueryResultRow {
  account_role: 'trainer' | 'client'
  pilot_allowed: boolean
  trainer_ready: boolean
}

interface AssignmentCountRow extends QueryResultRow {
  enabled_assignments: number | string
}

export type TrainerScheduleV2ClaimFailure = 'invalid_token' | 'profile_not_ready'

export class TrainerScheduleV2ClaimError extends Error {
  constructor(readonly failure: TrainerScheduleV2ClaimFailure) {
    super(failure === 'invalid_token'
      ? 'The activation link is invalid, expired, or already used'
      : 'The signed-in profile is not ready as a trainer')
    this.name = 'TrainerScheduleV2ClaimError'
  }
}

export interface TrainerScheduleV2Claimer {
  claim(session: YandexActorSession, token: string): Promise<{ enabled: true }>
}

export class DatabaseTrainerScheduleV2Claimer implements TrainerScheduleV2Claimer {
  constructor(private readonly pool: DatabasePool) {}

  claim(session: YandexActorSession, token: string): Promise<{ enabled: true }> {
    if (session.accessMode !== 'read_write' || !CLAIM_TOKEN_PATTERN.test(token)) {
      throw new TrainerScheduleV2ClaimError('invalid_token')
    }
    const tokenHash = createHash('sha256').update(token, 'utf8').digest('hex')

    return withYandexActorSession(this.pool, session, async (client) => {
      await client.query(
        "select pg_advisory_xact_lock(hashtextextended('trainer_schedule_v2', 0))",
      )
      const claims = await client.query<ClaimTokenRow>(`
        select token_hash
        from app_private.experiment_claim_tokens
        where token_hash = $1
          and experiment_key = 'trainer_schedule_v2'
          and consumed_at is null
          and expires_at > now()
        for update
      `, [tokenHash])
      if (claims[0] === undefined) {
        throw new TrainerScheduleV2ClaimError('invalid_token')
      }

      const profiles = await client.query<ProfileRow>(`
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
        where profile.id = auth.uid()
      `)
      const profile = profiles[0]
      if (
        profile === undefined
        || profile.account_role !== 'trainer'
        || !profile.trainer_ready
        || !profile.pilot_allowed
      ) {
        throw new TrainerScheduleV2ClaimError('profile_not_ready')
      }

      await client.query(`
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
      await client.query(`
        insert into app_private.user_experiment_assignments (
          profile_id, experiment_key, enabled, updated_at
        ) values (auth.uid(), 'trainer_schedule_v2', true, now())
        on conflict (profile_id, experiment_key) do update set
          enabled = true,
          updated_at = excluded.updated_at
      `)
      await client.query(`
        update app_private.experiment_claim_tokens
        set consumed_at = now(), consumed_by = auth.uid()
        where token_hash = $1
      `, [tokenHash])
      const counts = await client.query<AssignmentCountRow>(`
        select count(*) as enabled_assignments
        from app_private.user_experiment_assignments
        where experiment_key = 'trainer_schedule_v2' and enabled = true
      `)
      const enabledAssignments = Number(counts[0]?.enabled_assignments ?? 0)
      if (enabledAssignments < 1 || enabledAssignments > 2) {
        throw new Error('Trainer Schedule V2 two-account invariant failed')
      }
      return { enabled: true }
    })
  }
}
