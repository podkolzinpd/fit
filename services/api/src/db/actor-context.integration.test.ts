import { fileURLToPath } from 'node:url'

import { runner } from 'node-pg-migrate'
import { Pool, type QueryResultRow } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { hashPilotSessionToken } from '../auth/pilot-session-token.js'
import { DatabasePilotClientsReader } from '../pilot-clients-reader.js'
import { DatabasePilotSessionIssuer } from '../pilot-session.js'
import { withActorTransaction } from './actor-transaction.js'
import { PgDatabasePool } from './pg-pool.js'
import type { DatabasePool } from './types.js'
import {
  DatabasePilotEnroller,
  PilotEnrollmentConflictError,
} from './yandex-pilot-enrollment.js'
import {
  PilotAccessDeniedError,
  PilotSessionInvalidError,
  withYandexPilotActorTransaction,
} from './yandex-pilot-transaction.js'

const ACTOR_ID = 'c9f75482-117d-4532-8f67-6c3d9b9f4a5e'
const OTHER_ACTOR_ID = '974f21af-f304-421f-81bd-050dbfabdd46'
const MEMBER_TRAINER_ID = '8ffdb87b-078c-42d4-b6db-af8bc60f80f2'
const OUTSIDE_TRAINER_ID = '3f520f21-0be4-4a38-bb2a-e25225e1e608'
const CLIENT_ID = 'b3942b20-52a2-4d5d-9895-b3b63cf61442'
const PILOT_SUBJECT_HASH = 'b'.repeat(64)
const OUTSIDE_SUBJECT_HASH = 'c'.repeat(64)
const ENROLLMENT_SUBJECT_HASH = 'e'.repeat(64)
const RUNTIME_PASSWORD = 'fit-api-test-only'
const migrationsDirectory = fileURLToPath(
  new URL('../../db/migrations', import.meta.url),
)

interface ActorRow extends QueryResultRow {
  actor_id: string | null
}

interface ProfileRow extends QueryResultRow {
  first_name: string | null
}

interface EnrollmentProfileRow extends QueryResultRow {
  account_role: 'trainer' | 'client'
}

interface ClientRow extends QueryResultRow {
  id: string
}

interface SessionDigestRow extends QueryResultRow {
  token_sha256: string
}

function requireLocalTestDatabaseUrl(): string {
  const value = process.env.TEST_DATABASE_URL
  if (value === undefined) throw new Error('TEST_DATABASE_URL is required')

  const url = new URL(value)
  const isLocalHost = url.hostname === '127.0.0.1' || url.hostname === 'localhost'
  if (!isLocalHost || url.pathname !== '/fit_actor_test') {
    throw new Error(
      'Integration tests require a local database named fit_actor_test',
    )
  }
  return value
}

async function readActor(pool: DatabasePool): Promise<string | null> {
  const connection = await pool.connect()
  try {
    const rows = await connection.query<ActorRow>(
      'select auth.uid() as actor_id',
    )
    return rows[0]?.actor_id ?? null
  } finally {
    connection.release()
  }
}

describe.skipIf(process.env.TEST_DATABASE_URL === undefined)(
  'actor context PostgreSQL baseline',
  () => {
    let ownerPool: Pool | undefined
    let enrollmentPool: PgDatabasePool | undefined
    let runtimePool: PgDatabasePool | undefined

    beforeAll(async () => {
      const ownerUrl = requireLocalTestDatabaseUrl()
      ownerPool = new Pool({ connectionString: ownerUrl, max: 1 })
      enrollmentPool = new PgDatabasePool({
        connectionString: ownerUrl,
        max: 1,
      })
      await ownerPool.query(`
        do $$
        begin
          if not exists (select 1 from pg_roles where rolname = 'fit_api') then
            create role fit_api login password '${RUNTIME_PASSWORD}';
          else
            alter role fit_api login password '${RUNTIME_PASSWORD}';
          end if;
        end
        $$;
      `)

      await runner({
        databaseUrl: ownerUrl,
        dir: migrationsDirectory,
        direction: 'up',
        migrationsTable: 'fit_migrations',
        migrationsSchema: 'app_private',
        createMigrationsSchema: true,
        verbose: false,
      })

      await ownerPool.query(
        `
          insert into public.profiles (id, first_name, account_role)
          values ($1, 'Primary actor', 'trainer'), ($2, 'Other actor', 'client')
          on conflict (id) do update set
            first_name = excluded.first_name,
            account_role = excluded.account_role
        `,
        [ACTOR_ID, OTHER_ACTOR_ID],
      )
      await ownerPool.query(
        `
          insert into public.trainers (profile_id)
          values ($1)
          on conflict (profile_id) do nothing
        `,
        [ACTOR_ID],
      )
      await ownerPool.query(
        `
          insert into public.profiles (id, first_name, account_role)
          values
            ($1, 'Member trainer', 'trainer'),
            ($2, 'Outside trainer', 'trainer')
          on conflict (id) do update set
            first_name = excluded.first_name,
            account_role = excluded.account_role
        `,
        [MEMBER_TRAINER_ID, OUTSIDE_TRAINER_ID],
      )
      await ownerPool.query(
        `
          insert into public.trainers (profile_id)
          values ($1), ($2)
          on conflict (profile_id) do nothing
        `,
        [MEMBER_TRAINER_ID, OUTSIDE_TRAINER_ID],
      )
      await ownerPool.query(
        `
          insert into public.clients (
            id, trainer_id, auth_user_id, full_name, gender, age_years, height_cm
          ) values ($1, $2, $3, 'Shared client', 'female', 30, 170)
          on conflict (id) do nothing
        `,
        [CLIENT_ID, ACTOR_ID, OTHER_ACTOR_ID],
      )
      await ownerPool.query(
        `
          insert into public.client_trainers (client_id, trainer_id, alias)
          values ($1, $2, 'Root alias'), ($1, $3, 'Member alias')
          on conflict (client_id, trainer_id) do nothing
        `,
        [CLIENT_ID, ACTOR_ID, MEMBER_TRAINER_ID],
      )
      await ownerPool.query(
        `
          insert into app_private.auth_identities (
            provider, provider_subject_sha256, profile_id
          ) values ('yandex', $1, $2)
          on conflict (provider, provider_subject_sha256) do update set
            profile_id = excluded.profile_id
        `,
        [PILOT_SUBJECT_HASH, ACTOR_ID],
      )
      await ownerPool.query(
        `
          insert into app_private.profile_rollout_assignments (
            profile_id, target_backend, access_mode, enabled
          ) values ($1, 'yandex', 'read_only', true)
          on conflict (profile_id) do update set
            target_backend = excluded.target_backend,
            access_mode = excluded.access_mode,
            enabled = excluded.enabled
        `,
        [ACTOR_ID],
      )

      const runtimeUrl = new URL(ownerUrl)
      runtimeUrl.username = 'fit_api'
      runtimeUrl.password = RUNTIME_PASSWORD
      runtimePool = new PgDatabasePool({
        connectionString: runtimeUrl.toString(),
        max: 1,
      })
    })

    afterAll(async () => {
      await runtimePool?.end()
      await enrollmentPool?.end()
      await ownerPool?.end()
    })

    it('exposes the internal UUID through auth.uid only in one transaction', async () => {
      if (runtimePool === undefined) throw new Error('Runtime pool is not ready')

      expect(await readActor(runtimePool)).toBeNull()

      const actorInsideTransaction = await withActorTransaction(
        runtimePool,
        ACTOR_ID,
        async (client) => {
          const rows = await client.query<ActorRow>(
            'select auth.uid() as actor_id',
          )
          return rows[0]?.actor_id ?? null
        },
      )

      expect(actorInsideTransaction).toBe(ACTOR_ID)
      expect(await readActor(runtimePool)).toBeNull()
    })

    it('maps only an allowlisted Yandex identity to the internal actor', async () => {
      if (runtimePool === undefined) throw new Error('Runtime pool is not ready')

      const profiles = await withYandexPilotActorTransaction(
        runtimePool,
        PILOT_SUBJECT_HASH,
        async (client) =>
          client.query<ProfileRow>(
            'select first_name from public.profiles order by id',
          ),
      )
      expect(profiles).toEqual([{ first_name: 'Primary actor' }])
      expect(await readActor(runtimePool)).toBeNull()

      await expect(
        withYandexPilotActorTransaction(
          runtimePool,
          OUTSIDE_SUBJECT_HASH,
          () => Promise.resolve(undefined),
        ),
      ).rejects.toBeInstanceOf(PilotAccessDeniedError)
      expect(await readActor(runtimePool)).toBeNull()
    })

    it('issues an opaque session and keeps its client list inside the pilot tenant', async () => {
      if (ownerPool === undefined || runtimePool === undefined) {
        throw new Error('Database pools are not ready')
      }

      const issuer = new DatabasePilotSessionIssuer(runtimePool)
      const clientsReader = new DatabasePilotClientsReader(runtimePool)
      const session = await issuer.issue(PILOT_SUBJECT_HASH)

      expect(session?.profile.id).toBe(ACTOR_ID)
      expect(session?.session.token).toMatch(/^[A-Za-z0-9_-]{43}$/)
      const sessionDigest = session === undefined
        ? undefined
        : hashPilotSessionToken(session.session.token)
      const storedSessions = await ownerPool.query<SessionDigestRow>(
        `
          select token_sha256
          from app_private.yandex_pilot_sessions
          where profile_id = $1 and expires_at > now()
          order by created_at desc
          limit 1
        `,
        [ACTOR_ID],
      )
      expect(storedSessions.rows).toEqual([{ token_sha256: sessionDigest }])
      expect(storedSessions.rows[0]?.token_sha256).not.toBe(session?.session.token)
      await expect(
        clientsReader.readClients(session?.session.token ?? ''),
      ).resolves.toMatchObject({
        accessMode: 'read_only',
        clients: [{ id: CLIENT_ID, fullName: 'Root alias' }],
      })
      expect(await readActor(runtimePool)).toBeNull()

      await ownerPool.query(
        'update app_private.profile_rollout_assignments set enabled = false where profile_id = $1',
        [ACTOR_ID],
      )
      await expect(
        clientsReader.readClients(session?.session.token ?? ''),
      ).rejects.toBeInstanceOf(PilotSessionInvalidError)
      await ownerPool.query(
        'update app_private.profile_rollout_assignments set enabled = true where profile_id = $1',
        [ACTOR_ID],
      )

      await expect(
        issuer.issue(OUTSIDE_SUBJECT_HASH),
      ).rejects.toBeInstanceOf(PilotAccessDeniedError)

      const expiredToken = 'x'.repeat(43)
      const expiredHash = hashPilotSessionToken(expiredToken)
      if (expiredHash === undefined) throw new Error('Expired fixture token is invalid')
      await ownerPool.query(
        `
          insert into app_private.yandex_pilot_sessions (
            token_sha256, profile_id, created_at, expires_at
          ) values ($1, $2, now() - interval '2 minutes', now() - interval '1 minute')
        `,
        [expiredHash, ACTOR_ID],
      )
      await expect(
        clientsReader.readClients(expiredToken),
      ).rejects.toBeInstanceOf(PilotSessionInvalidError)
      expect(await readActor(runtimePool)).toBeNull()
    })

    it('enrolls a verified pilot identity once without allowing role changes', async () => {
      if (
        ownerPool === undefined
        || enrollmentPool === undefined
        || runtimePool === undefined
      ) {
        throw new Error('Database pools are not ready')
      }

      await ownerPool.query(
        `
          delete from public.trainers
          where profile_id in (
            select profile_id
            from app_private.auth_identities
            where provider = 'yandex' and provider_subject_sha256 = $1
          )
        `,
        [ENROLLMENT_SUBJECT_HASH],
      )
      await ownerPool.query(
        `
          delete from public.profiles
          where id in (
            select profile_id
            from app_private.auth_identities
            where provider = 'yandex' and provider_subject_sha256 = $1
          )
        `,
        [ENROLLMENT_SUBJECT_HASH],
      )

      const enroller = new DatabasePilotEnroller(enrollmentPool)
      await expect(
        enroller.enroll(ENROLLMENT_SUBJECT_HASH, 'trainer'),
      ).resolves.toEqual({ created: true })
      await ownerPool.query(
        `
          delete from app_private.profile_rollout_assignments
          where profile_id = (
            select profile_id
            from app_private.auth_identities
            where provider = 'yandex' and provider_subject_sha256 = $1
          )
        `,
        [ENROLLMENT_SUBJECT_HASH],
      )
      await expect(
        enroller.enroll(ENROLLMENT_SUBJECT_HASH, 'trainer'),
      ).resolves.toEqual({ created: false })
      await expect(
        enroller.enroll(ENROLLMENT_SUBJECT_HASH, 'client'),
      ).rejects.toBeInstanceOf(PilotEnrollmentConflictError)

      const profiles = await withYandexPilotActorTransaction(
        runtimePool,
        ENROLLMENT_SUBJECT_HASH,
        (client) =>
          client.query<EnrollmentProfileRow>(
            'select account_role from public.profiles',
          ),
      )
      expect(profiles).toEqual([{ account_role: 'trainer' }])
    })

    it('keeps profile reads and updates inside the actor tenant', async () => {
      if (runtimePool === undefined) throw new Error('Runtime pool is not ready')

      await withActorTransaction(runtimePool, ACTOR_ID, async (client) => {
        const visibleProfiles = await client.query<ProfileRow>(
          'select first_name from public.profiles order by id',
        )
        expect(visibleProfiles).toEqual([{ first_name: 'Primary actor' }])

        const hiddenUpdate = await client.query<ProfileRow>(
          `
            update public.profiles
            set first_name = 'Changed by another actor'
            where id = $1
            returning first_name
          `,
          [OTHER_ACTOR_ID],
        )
        expect(hiddenUpdate).toEqual([])

        const ownUpdate = await client.query<ProfileRow>(
          `
            update public.profiles
            set first_name = 'Updated actor'
            where id = $1
            returning first_name
          `,
          [ACTOR_ID],
        )
        expect(ownUpdate).toEqual([{ first_name: 'Updated actor' }])

        const visibleTrainers = await client.query(
          'select profile_id from public.trainers',
        )
        expect(visibleTrainers).toEqual([{ profile_id: ACTOR_ID }])
      })

      const otherProfile = await ownerPool?.query<ProfileRow>(
        'select first_name from public.profiles where id = $1',
        [OTHER_ACTOR_ID],
      )
      expect(otherProfile?.rows).toEqual([{ first_name: 'Other actor' }])
    })

    it('shares a client only with its owner and connected trainers', async () => {
      if (runtimePool === undefined) throw new Error('Runtime pool is not ready')

      for (const actorId of [ACTOR_ID, OTHER_ACTOR_ID, MEMBER_TRAINER_ID]) {
        const visibleClients = await withActorTransaction(
          runtimePool,
          actorId,
          async (client) =>
            client.query<ClientRow>('select id from public.clients'),
        )
        expect(visibleClients).toEqual([{ id: CLIENT_ID }])
      }

      const hiddenClients = await withActorTransaction(
        runtimePool,
        OUTSIDE_TRAINER_ID,
        async (client) => client.query<ClientRow>('select id from public.clients'),
      )
      expect(hiddenClients).toEqual([])

      const hiddenMemberships = await withActorTransaction(
        runtimePool,
        OUTSIDE_TRAINER_ID,
        async (client) =>
          client.query('select trainer_id from public.client_trainers'),
      )
      expect(hiddenMemberships).toEqual([])

      const visibleMemberships = await withActorTransaction(
        runtimePool,
        OTHER_ACTOR_ID,
        async (client) =>
          client.query(
            'select trainer_id from public.client_trainers order by trainer_id',
          ),
      )
      expect(visibleMemberships).toHaveLength(2)
    })

    it('enforces relationship foreign keys and keeps runtime writes closed', async () => {
      if (ownerPool === undefined || runtimePool === undefined) {
        throw new Error('Database pools are not ready')
      }

      await expect(
        ownerPool.query(
          `
            insert into public.client_trainers (client_id, trainer_id)
            values ($1, $2)
          `,
          ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', ACTOR_ID],
        ),
      ).rejects.toMatchObject({ code: '23503' })

      await expect(
        withActorTransaction(runtimePool, ACTOR_ID, async (client) =>
          client.query(
            `
              insert into public.clients (trainer_id, full_name)
              values ($1, 'Not allowed')
            `,
            [ACTOR_ID],
          ),
        ),
      ).rejects.toMatchObject({ code: '42501' })
    })
  },
)
