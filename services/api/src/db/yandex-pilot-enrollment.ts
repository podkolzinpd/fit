import type { QueryResultRow } from 'pg'

import type { DatabasePool } from './types.js'

const SUBJECT_HASH_PATTERN = /^[0-9a-f]{64}$/

export type PilotAccountRole = 'trainer' | 'client'

export interface PilotEnrollmentResult {
  created: boolean
}

export interface PilotEnroller {
  enroll(
    subjectHash: string,
    accountRole: PilotAccountRole,
  ): Promise<PilotEnrollmentResult>
}

interface ExistingEnrollmentRow extends QueryResultRow {
  account_role: PilotAccountRole
}

interface CreatedProfileRow extends QueryResultRow {
  id: string
}

export class PilotEnrollmentConflictError extends Error {
  constructor() {
    super('Yandex identity is already enrolled with another account role')
    this.name = 'PilotEnrollmentConflictError'
  }
}

export class DatabasePilotEnroller implements PilotEnroller {
  constructor(private readonly pool: DatabasePool) {}

  async enroll(
    subjectHash: string,
    accountRole: PilotAccountRole,
  ): Promise<PilotEnrollmentResult> {
    if (!SUBJECT_HASH_PATTERN.test(subjectHash)) {
      throw new Error('Yandex subject hash must be a lowercase SHA-256 digest')
    }

    const connection = await this.pool.connect()
    let transactionStarted = false

    try {
      await connection.query('begin')
      transactionStarted = true
      await connection.query(
        'select pg_advisory_xact_lock(hashtextextended($1, 0))',
        [subjectHash],
      )

      const existing = await connection.query<ExistingEnrollmentRow>(
        `
          select profile.account_role
          from app_private.auth_identities identity
          join public.profiles profile on profile.id = identity.profile_id
          where identity.provider = 'yandex'
            and identity.provider_subject_sha256 = $1
        `,
        [subjectHash],
      )
      const existingRole = existing[0]?.account_role
      if (existingRole !== undefined) {
        if (existingRole !== accountRole) throw new PilotEnrollmentConflictError()
        if (accountRole === 'trainer') {
          await connection.query(
            `
              insert into public.trainers (profile_id)
              select profile_id
              from app_private.auth_identities
              where provider = 'yandex' and provider_subject_sha256 = $1
              on conflict (profile_id) do nothing
            `,
            [subjectHash],
          )
        }
        await connection.query(
          `
            insert into app_private.profile_rollout_assignments (
              profile_id, target_backend, access_mode, enabled
            )
            select profile_id, 'yandex', 'read_only', true
            from app_private.auth_identities
            where provider = 'yandex' and provider_subject_sha256 = $1
            on conflict (profile_id) do update set
              target_backend = excluded.target_backend,
              access_mode = excluded.access_mode,
              enabled = excluded.enabled
          `,
          [subjectHash],
        )
        await connection.query('commit')
        return { created: false }
      }

      const profiles = await connection.query<CreatedProfileRow>(
        'insert into public.profiles (account_role) values ($1) returning id',
        [accountRole],
      )
      const profileId = profiles[0]?.id
      if (profileId === undefined) throw new Error('Pilot profile was not created')

      if (accountRole === 'trainer') {
        await connection.query(
          'insert into public.trainers (profile_id) values ($1)',
          [profileId],
        )
      }
      await connection.query(
        `
          insert into app_private.auth_identities (
            provider, provider_subject_sha256, profile_id
          ) values ('yandex', $1, $2)
        `,
        [subjectHash, profileId],
      )
      await connection.query(
        `
          insert into app_private.profile_rollout_assignments (
            profile_id, target_backend, access_mode, enabled
          ) values ($1, 'yandex', 'read_only', true)
        `,
        [profileId],
      )
      await connection.query('commit')
      return { created: true }
    } catch (error) {
      if (transactionStarted) {
        try {
          await connection.query('rollback')
        } catch (rollbackError) {
          throw new AggregateError(
            [error, rollbackError],
            'Pilot enrollment and rollback both failed',
            { cause: rollbackError },
          )
        }
      }
      throw error
    } finally {
      connection.release()
    }
  }
}
