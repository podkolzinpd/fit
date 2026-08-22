import { fileURLToPath } from 'node:url'

import { runner } from 'node-pg-migrate'
import { Pool, type QueryResultRow } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { hashPilotSessionToken } from '../auth/pilot-session-token.js'
import { readAccessibleConnections } from '../connections.js'
import {
  claimClientInvitation,
  createClientInvitation,
  leaveClientSpace,
  removeClientTrainer,
  revokeClientInvitation,
} from '../connection-commands.js'
import { DatabasePilotClientsReader } from '../pilot-clients-reader.js'
import { DatabasePilotConnectionsReader } from '../pilot-connections-reader.js'
import { DatabasePilotSessionIssuer } from '../pilot-session.js'
import { DatabasePilotTrainingDataReader } from '../pilot-training-data-reader.js'
import { readAccessibleTrainingData } from '../training-data.js'
import { withActorTransaction } from './actor-transaction.js'
import { PgDatabasePool } from './pg-pool.js'
import {
  DatabaseStageWorkoutFixtureLoader,
  STAGE_SMOKE_PROFILE_ID,
  stageWorkoutFixtureIds,
} from './stage-workout-fixture.js'
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
const ROOT_INVITATION_ID = '76978725-d10e-4c52-9538-b28411706d38'
const MEMBER_INVITATION_ID = '443850c1-ad40-4604-83c4-35e4111c7d88'
const EXPIRED_INVITATION_ID = '8f371423-5120-4cee-9e5e-004878bcc870'
const REVOKED_INVITATION_ID = '01587b1f-70ee-4541-b974-2e7a2b9344bb'
const CLAIMED_INVITATION_ID = 'f1ce4a50-6863-499c-afde-2e124eb11e2f'
const LIFECYCLE_CLIENT_ID = 'e94770f7-369f-4c0d-a9ad-e18466469483'
const LIFECYCLE_CLIENT_ACTOR_ID = '0237c0bf-5dc5-46cd-ab26-951ddfb49949'
const ROOT_CUSTOM_EXERCISE_ID = 'b27d65d0-6221-47cb-91a0-8dfcc0a2ceba'
const MEMBER_CUSTOM_EXERCISE_ID = '3127663e-4395-4100-8dd1-7b784d90917a'
const ROOT_WORKOUT_ID = '12acc6d6-7ca8-43cd-b124-b4224c917fae'
const MEMBER_WORKOUT_ID = 'd3cff30a-7aa2-4407-b62d-0683167cf4c8'
const CLIENT_WORKOUT_ID = '6e2d8d63-7c3a-4301-b9ba-76d875210f1f'
const ROOT_WORKOUT_EXERCISE_ID = 'd40b742b-5d5b-41ab-91df-ed464414d034'
const ROOT_WORKOUT_SET_ID = 'ea8efab5-0530-4660-9798-79901fcddfeb'
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

interface InvitationSecretRow extends QueryResultRow {
  code_hash: string
  revoked_at: Date | null
}

interface CountRow extends QueryResultRow {
  count: number
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

      // The local PostgreSQL container is persistent. Remove only rows carrying
      // the explicit synthetic marker so earlier assertions stay isolated
      // across repeated test runs; stage intentionally keeps these rows.
      await ownerPool.query(
        `delete from public.workouts
         where notes = 'Синтетическая проверка переноса Yandex stage'`,
      )
      await ownerPool.query(
        `delete from public.custom_exercises
         where name = 'Тестовая тяга Yandex stage'`,
      )
      await ownerPool.query(
        `delete from public.clients
         where full_name = 'Тестовый клиент Yandex stage'`,
      )
      await ownerPool.query(
        'delete from public.trainers where profile_id = $1',
        [STAGE_SMOKE_PROFILE_ID],
      )
      await ownerPool.query(
        'delete from public.profiles where id = $1',
        [STAGE_SMOKE_PROFILE_ID],
      )

      // Keep the persistent local Podman database deterministic across reruns.
      // The lifecycle scenario recreates these fixtures later in the suite.
      await ownerPool.query(
        'delete from public.clients where id = $1',
        [LIFECYCLE_CLIENT_ID],
      )
      await ownerPool.query(
        'delete from public.profiles where id = $1',
        [LIFECYCLE_CLIENT_ACTOR_ID],
      )

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
        'delete from public.workouts where id = any($1::uuid[])',
        [[ROOT_WORKOUT_ID, MEMBER_WORKOUT_ID, CLIENT_WORKOUT_ID]],
      )
      await ownerPool.query(
        `
          insert into public.custom_exercises (
            id, trainer_id, name, muscle_group, input_kind
          ) values
            ($1, $3, 'Тяга саней', 'legs', 'strength'),
            ($2, $4, 'Темповый бег', 'cardio', 'duration')
          on conflict (id) do update set
            trainer_id = excluded.trainer_id,
            name = excluded.name,
            muscle_group = excluded.muscle_group,
            input_kind = excluded.input_kind,
            archived_at = null
        `,
        [
          ROOT_CUSTOM_EXERCISE_ID,
          MEMBER_CUSTOM_EXERCISE_ID,
          ACTOR_ID,
          MEMBER_TRAINER_ID,
        ],
      )
      await ownerPool.query(
        `
          insert into public.workouts (
            id, trainer_id, client_id, created_by, workout_date, start_time,
            status, completed_at
          ) values
            ($1, $4, $5, $4, date '2026-08-20', time '10:00', 'planned', null),
            ($2, $4, $5, $6, date '2026-08-21', time '11:00', 'planned', null),
            ($3, $4, $5, $7, date '2026-08-19', null, 'done', timestamptz '2026-08-19 12:00:00+00')
        `,
        [
          ROOT_WORKOUT_ID,
          MEMBER_WORKOUT_ID,
          CLIENT_WORKOUT_ID,
          ACTOR_ID,
          CLIENT_ID,
          MEMBER_TRAINER_ID,
          OTHER_ACTOR_ID,
        ],
      )
      await ownerPool.query(
        `
          insert into public.workout_exercises (
            id, workout_id, trainer_id, client_id, position,
            exercise_source, exercise_ref, exercise_name, muscle_group,
            input_kind
          ) values ($1, $2, $3, $4, 0, 'system', 'running', 'Бег', 'cardio', 'distance')
        `,
        [ROOT_WORKOUT_EXERCISE_ID, ROOT_WORKOUT_ID, ACTOR_ID, CLIENT_ID],
      )
      await ownerPool.query(
        `
          insert into public.workout_sets (
            id, workout_exercise_id, trainer_id, client_id, position,
            plan_duration_sec, plan_distance_km, plan_rpe
          ) values ($1, $2, $3, $4, 0, 1800, 5, 7)
        `,
        [ROOT_WORKOUT_SET_ID, ROOT_WORKOUT_EXERCISE_ID, ACTOR_ID, CLIENT_ID],
      )
      await ownerPool.query(
        `
          insert into public.client_invitations (
            id, client_id, created_by, target_role, code_hash, expires_at,
            claimed_by, claimed_at, revoked_at, created_at
          ) values
            ($1, $6, $7, 'client', $10, now() + interval '7 days', null, null, null, now()),
            ($2, $6, $8, 'trainer', $11, now() + interval '7 days', null, null, null, now()),
            ($3, $6, $7, 'client', $12, now() - interval '1 hour', null, null, null, now() - interval '8 days'),
            ($4, $6, $7, 'client', $13, now() + interval '7 days', null, null, now(), now()),
            ($5, $6, $7, 'client', $14, now() + interval '7 days', $9, now(), null, now())
          on conflict (id) do update set
            client_id = excluded.client_id,
            created_by = excluded.created_by,
            target_role = excluded.target_role,
            code_hash = excluded.code_hash,
            expires_at = excluded.expires_at,
            claimed_by = excluded.claimed_by,
            claimed_at = excluded.claimed_at,
            revoked_at = excluded.revoked_at
        `,
        [
          ROOT_INVITATION_ID,
          MEMBER_INVITATION_ID,
          EXPIRED_INVITATION_ID,
          REVOKED_INVITATION_ID,
          CLAIMED_INVITATION_ID,
          CLIENT_ID,
          ACTOR_ID,
          MEMBER_TRAINER_ID,
          OTHER_ACTOR_ID,
          '1'.repeat(64),
          '2'.repeat(64),
          '3'.repeat(64),
          '4'.repeat(64),
          '5'.repeat(64),
        ],
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
      const connectionsReader = new DatabasePilotConnectionsReader(runtimePool)
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
      await expect(
        connectionsReader.readConnections(session?.session.token ?? ''),
      ).resolves.toMatchObject({
        accessMode: 'read_only',
        memberships: [
          { clientId: CLIENT_ID, trainerId: ACTOR_ID, isRoot: true },
          { clientId: CLIENT_ID, trainerId: MEMBER_TRAINER_ID, isRoot: false },
        ],
        invitations: [{ id: ROOT_INVITATION_ID, clientId: CLIENT_ID }],
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

    it('keeps exercise catalogs and workout aggregates inside author-scoped access', async () => {
      if (runtimePool === undefined) throw new Error('Runtime pool is not ready')

      const rootData = await withActorTransaction(
        runtimePool,
        ACTOR_ID,
        readAccessibleTrainingData,
      )
      expect(rootData.customExercises).toMatchObject([
        { id: ROOT_CUSTOM_EXERCISE_ID, name: 'Тяга саней' },
      ])
      expect(rootData.workouts.map((workout) => workout.id)).toEqual([
        ROOT_WORKOUT_ID,
        CLIENT_WORKOUT_ID,
      ])
      expect(rootData.workouts[0]?.exercises[0]).toMatchObject({
        ref: 'running',
        sets: [{ plan: { durationSec: 1800, distanceKm: 5, rpe: 7 } }],
      })

      const memberData = await withActorTransaction(
        runtimePool,
        MEMBER_TRAINER_ID,
        readAccessibleTrainingData,
      )
      expect(memberData.customExercises).toMatchObject([
        { id: MEMBER_CUSTOM_EXERCISE_ID, name: 'Темповый бег' },
      ])
      expect(memberData.workouts.map((workout) => workout.id)).toEqual([
        MEMBER_WORKOUT_ID,
        CLIENT_WORKOUT_ID,
      ])

      const clientData = await withActorTransaction(
        runtimePool,
        OTHER_ACTOR_ID,
        readAccessibleTrainingData,
      )
      expect(clientData.customExercises).toEqual([])
      expect(clientData.workouts.map((workout) => workout.id)).toEqual([
        MEMBER_WORKOUT_ID,
        ROOT_WORKOUT_ID,
        CLIENT_WORKOUT_ID,
      ])

      const outsideData = await withActorTransaction(
        runtimePool,
        OUTSIDE_TRAINER_ID,
        readAccessibleTrainingData,
      )
      expect(outsideData).toEqual({
        accessMode: 'read_only',
        customExercises: [],
        workouts: [],
        hasMoreWorkouts: false,
      })
    })

    it('shows memberships to the client cohort and active invitations only to their creator', async () => {
      if (runtimePool === undefined) throw new Error('Runtime pool is not ready')

      const clientConnections = await withActorTransaction(
        runtimePool,
        OTHER_ACTOR_ID,
        readAccessibleConnections,
      )
      expect(clientConnections.memberships).toHaveLength(2)
      expect(clientConnections.invitations).toEqual([])

      const memberConnections = await withActorTransaction(
        runtimePool,
        MEMBER_TRAINER_ID,
        readAccessibleConnections,
      )
      expect(memberConnections.memberships).toHaveLength(2)
      expect(memberConnections.invitations).toMatchObject([
        { id: MEMBER_INVITATION_ID, targetRole: 'trainer' },
      ])

      const outsideConnections = await withActorTransaction(
        runtimePool,
        OUTSIDE_TRAINER_ID,
        readAccessibleConnections,
      )
      expect(outsideConnections).toEqual({
        accessMode: 'read_only',
        memberships: [],
        invitations: [],
      })
    })

    it('hides memberships and invitations for archived clients', async () => {
      if (ownerPool === undefined || runtimePool === undefined) {
        throw new Error('Database pools are not ready')
      }

      await ownerPool.query(
        'update public.clients set archived_at = now() where id = $1',
        [CLIENT_ID],
      )
      try {
        await expect(
          withActorTransaction(runtimePool, ACTOR_ID, readAccessibleConnections),
        ).resolves.toEqual({
          accessMode: 'read_only',
          memberships: [],
          invitations: [],
        })
      } finally {
        await ownerPool.query(
          'update public.clients set archived_at = null where id = $1',
          [CLIENT_ID],
        )
      }
    })

    it('runs the invitation lifecycle through guarded database commands', async () => {
      if (ownerPool === undefined || runtimePool === undefined) {
        throw new Error('Database pools are not ready')
      }

      await ownerPool.query(
        `
          insert into public.profiles (id, first_name, account_role)
          values ($1, 'Lifecycle client', 'client')
          on conflict (id) do update set
            first_name = excluded.first_name,
            account_role = excluded.account_role
        `,
        [LIFECYCLE_CLIENT_ACTOR_ID],
      )
      await ownerPool.query(
        `
          insert into public.clients (id, trainer_id, full_name)
          values ($1, $2, 'Lifecycle card')
          on conflict (id) do update set
            trainer_id = excluded.trainer_id,
            auth_user_id = null,
            archived_at = null
        `,
        [LIFECYCLE_CLIENT_ID, ACTOR_ID],
      )
      await ownerPool.query(
        `
          insert into public.client_trainers (client_id, trainer_id)
          values ($1, $2)
          on conflict (client_id, trainer_id) do nothing
        `,
        [LIFECYCLE_CLIENT_ID, ACTOR_ID],
      )

      const firstInvitation = await withActorTransaction(
        runtimePool,
        ACTOR_ID,
        (client) => createClientInvitation(client, LIFECYCLE_CLIENT_ID, 'client'),
      )
      const secondInvitation = await withActorTransaction(
        runtimePool,
        ACTOR_ID,
        (client) => createClientInvitation(client, LIFECYCLE_CLIENT_ID, 'client'),
      )

      expect(firstInvitation.code).toMatch(/^[A-F0-9]{12}$/)
      expect(secondInvitation.code).toMatch(/^[A-F0-9]{12}$/)
      const storedInvitations = await ownerPool.query<InvitationSecretRow>(
        `
          select code_hash, revoked_at
          from public.client_invitations
          where id in ($1, $2)
          order by created_at, id
        `,
        [firstInvitation.id, secondInvitation.id],
      )
      expect(storedInvitations.rows).toHaveLength(2)
      expect(storedInvitations.rows.every((row) => /^[0-9a-f]{64}$/.test(row.code_hash))).toBe(true)
      expect(storedInvitations.rows.some((row) => row.code_hash === firstInvitation.code)).toBe(false)
      expect(storedInvitations.rows.filter((row) => row.revoked_at !== null)).toHaveLength(1)

      await expect(
        withActorTransaction(runtimePool, MEMBER_TRAINER_ID, (client) =>
          claimClientInvitation(client, secondInvitation.code)),
      ).rejects.toMatchObject({ failure: 'forbidden' })

      await expect(
        withActorTransaction(runtimePool, LIFECYCLE_CLIENT_ACTOR_ID, (client) =>
          claimClientInvitation(client, secondInvitation.code)),
      ).resolves.toBe(LIFECYCLE_CLIENT_ID)
      await expect(
        withActorTransaction(runtimePool, LIFECYCLE_CLIENT_ACTOR_ID, (client) =>
          claimClientInvitation(client, secondInvitation.code)),
      ).rejects.toMatchObject({ failure: 'not_found' })

      const trainerInvitation = await withActorTransaction(
        runtimePool,
        LIFECYCLE_CLIENT_ACTOR_ID,
        (client) => createClientInvitation(client, LIFECYCLE_CLIENT_ID, 'trainer'),
      )
      await expect(
        withActorTransaction(runtimePool, OTHER_ACTOR_ID, (client) =>
          revokeClientInvitation(client, trainerInvitation.id)),
      ).rejects.toMatchObject({ failure: 'not_found' })
      await expect(
        withActorTransaction(runtimePool, LIFECYCLE_CLIENT_ACTOR_ID, (client) =>
          revokeClientInvitation(client, trainerInvitation.id)),
      ).resolves.toBeUndefined()
      await expect(
        withActorTransaction(runtimePool, OUTSIDE_TRAINER_ID, (client) =>
          claimClientInvitation(client, trainerInvitation.code)),
      ).rejects.toMatchObject({ failure: 'not_found' })

      const claimableTrainerInvitation = await withActorTransaction(
        runtimePool,
        LIFECYCLE_CLIENT_ACTOR_ID,
        (client) => createClientInvitation(client, LIFECYCLE_CLIENT_ID, 'trainer'),
      )
      await expect(
        withActorTransaction(runtimePool, OUTSIDE_TRAINER_ID, (client) =>
          claimClientInvitation(client, claimableTrainerInvitation.code)),
      ).resolves.toBe(LIFECYCLE_CLIENT_ID)

      await expect(
        withActorTransaction(runtimePool, OTHER_ACTOR_ID, (client) =>
          removeClientTrainer(client, LIFECYCLE_CLIENT_ID, OUTSIDE_TRAINER_ID)),
      ).rejects.toMatchObject({ failure: 'forbidden' })
      await expect(
        withActorTransaction(runtimePool, LIFECYCLE_CLIENT_ACTOR_ID, (client) =>
          removeClientTrainer(client, LIFECYCLE_CLIENT_ID, ACTOR_ID)),
      ).rejects.toMatchObject({ failure: 'invalid' })
      await expect(
        withActorTransaction(runtimePool, ACTOR_ID, (client) =>
          leaveClientSpace(client, LIFECYCLE_CLIENT_ID)),
      ).rejects.toMatchObject({ failure: 'invalid' })
      await expect(
        withActorTransaction(runtimePool, OUTSIDE_TRAINER_ID, (client) =>
          leaveClientSpace(client, LIFECYCLE_CLIENT_ID)),
      ).resolves.toBeUndefined()

      const outsideAccess = await withActorTransaction(
        runtimePool,
        OUTSIDE_TRAINER_ID,
        (client) => client.query('select id from public.clients where id = $1', [LIFECYCLE_CLIENT_ID]),
      )
      expect(outsideAccess).toEqual([])
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

      await expect(
        withActorTransaction(runtimePool, ACTOR_ID, async (client) =>
          client.query(
            `
              insert into public.custom_exercises (
                trainer_id, name, muscle_group, input_kind
              ) values ($1, 'Not allowed', 'other', 'reps')
            `,
            [ACTOR_ID],
          ),
        ),
      ).rejects.toMatchObject({ code: '42501' })

      await expect(
        ownerPool.query(
          `
            insert into public.workout_sets (
              workout_exercise_id, trainer_id, client_id, position
            ) values ($1, $2, $3, 0)
          `,
          ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', ACTOR_ID, CLIENT_ID],
        ),
      ).rejects.toMatchObject({ code: '23503' })

      await expect(
        withActorTransaction(runtimePool, ACTOR_ID, async (client) =>
          client.query(
            `
              insert into public.client_invitations (
                client_id, created_by, target_role, code_hash, expires_at
              ) values ($1, $2, 'client', $3, now() + interval '7 days')
            `,
            [CLIENT_ID, ACTOR_ID, 'f'.repeat(64)],
          ),
        ),
      ).rejects.toMatchObject({ code: '42501' })
    })

    it('loads the synthetic stage workout fixture idempotently and reads it through RLS', async () => {
      if (
        ownerPool === undefined
        || enrollmentPool === undefined
        || runtimePool === undefined
      ) {
        throw new Error('Database pools are not ready')
      }

      const now = new Date()
      const expectedExpiry = new Date(now.getTime() + 15 * 60 * 1_000)
      const loader = new DatabaseStageWorkoutFixtureLoader(
        enrollmentPool,
        () => now,
      )
      const reader = new DatabasePilotTrainingDataReader(runtimePool)

      const first = await loader.load()
      expect(first.seededTrainerCount).toBeGreaterThanOrEqual(2)
      expect(first.sessionToken).toMatch(/^[A-Za-z0-9_-]{43}$/)
      expect(first.sessionExpiresAt).toBe(expectedExpiry.toISOString())

      const smokeData = await reader.readTrainingData(first.sessionToken)
      const smokeIds = stageWorkoutFixtureIds(STAGE_SMOKE_PROFILE_ID)
      expect(smokeData).toMatchObject({
        accessMode: 'read_only',
        customExercises: [
          {
            id: smokeIds.customExerciseId,
            name: 'Тестовая тяга Yandex stage',
            inputKind: 'strength',
          },
        ],
        workouts: [
          {
            id: smokeIds.workoutId,
            notes: 'Синтетическая проверка переноса Yandex stage',
            status: 'done',
            exercises: [
              {
                id: smokeIds.strengthExerciseId,
                sets: [
                  {
                    id: smokeIds.strengthSetId,
                    fact: { weightKg: 42.5, reps: 10, rpe: 8 },
                  },
                ],
              },
              {
                id: smokeIds.runningExerciseId,
                sets: [
                  {
                    id: smokeIds.runningSetId,
                    fact: { durationSec: 1740, distanceKm: 5.2, rpe: 8 },
                  },
                ],
              },
            ],
          },
        ],
      })

      const actorIds = stageWorkoutFixtureIds(ACTOR_ID)
      const actorData = await withActorTransaction(
        runtimePool,
        ACTOR_ID,
        readAccessibleTrainingData,
      )
      expect(actorData.workouts.some(
        (workout) => workout.id === actorIds.workoutId,
      )).toBe(true)
      expect(actorData.workouts.some(
        (workout) => workout.id === smokeIds.workoutId,
      )).toBe(false)

      const outsiderData = await withActorTransaction(
        runtimePool,
        OUTSIDE_TRAINER_ID,
        readAccessibleTrainingData,
      )
      expect(outsiderData.workouts.some(
        (workout) => workout.id === smokeIds.workoutId,
      )).toBe(false)
      expect(outsiderData.workouts.some(
        (workout) => workout.id === actorIds.workoutId,
      )).toBe(false)

      const second = await loader.load()
      expect(second.seededTrainerCount).toBe(first.seededTrainerCount)
      expect(second.sessionToken).not.toBe(first.sessionToken)

      for (const [table, id] of [
        ['clients', smokeIds.clientId],
        ['custom_exercises', smokeIds.customExerciseId],
        ['workouts', smokeIds.workoutId],
        ['workout_exercises', smokeIds.strengthExerciseId],
        ['workout_exercises', smokeIds.runningExerciseId],
        ['workout_sets', smokeIds.strengthSetId],
        ['workout_sets', smokeIds.runningSetId],
      ] as const) {
        const rows = await ownerPool.query<CountRow>(
          `select count(*)::integer as count from public.${table} where id = $1`,
          [id],
        )
        expect(rows.rows).toEqual([{ count: 1 }])
      }
    })
  },
)
