import { fileURLToPath } from 'node:url'

import { runner } from 'node-pg-migrate'
import { Pool, type QueryResultRow } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { hashPilotSessionToken } from '../auth/pilot-session-token.js'
import { submitAppFeedback } from '../app-feedback-command.js'
import {
  applyAssistantAction,
  appendAssistantUserMessage,
  createAssistantConversation,
  listAssistantActions,
  listAssistantConversations,
  listAssistantMessages,
  persistAssistantResponse,
} from '../assistant-state.js'
import {
  deletePushSubscription,
  readPushNotificationStatus,
  setNotificationPreference,
  upsertPushSubscription,
} from '../push-notifications-command.js'
import {
  claimPushNotifications,
  enqueueWorkoutReminders,
  finalizePushNotifications,
} from '../push-dispatcher-command.js'
import { readAccessibleClients } from '../clients.js'
import { readAccessibleConnections } from '../connections.js'
import {
  claimClientInvitation,
  createClientInvitation,
  leaveClientSpace,
  removeClientTrainer,
  revokeClientInvitation,
} from '../connection-commands.js'
import {
  createClientCard,
  createCustomExercise,
  setClientArchived,
  setCustomExerciseArchived,
  updateClientCard,
  updateClientPreferences,
  updateCustomExercise,
} from '../domain-commands.js'
import { DatabasePilotClientsReader } from '../pilot-clients-reader.js'
import { DatabasePilotConnectionsReader } from '../pilot-connections-reader.js'
import { DatabasePilotSessionIssuer } from '../pilot-session.js'
import { DatabasePilotTrainingDataReader } from '../pilot-training-data-reader.js'
import type { PlannedWorkoutDraft } from '../planned-workout-request.js'
import { DatabasePilotProgressData } from '../progress-data.js'
import { readAccessibleTrainingData } from '../training-data.js'
import {
  appendLiveExercise,
  appendLiveSet,
  answerWorkoutQuestion,
  askWorkoutQuestion,
  cancelPlannedWorkout,
  confirmLiveSet,
  finishLiveWorkout,
  recordPlannedWorkoutResult,
  removeLiveSet,
  reorderLiveBlock,
  rescheduleWorkout,
  replaceLiveExercise,
  saveCompletedWorkout,
  savePlannedWorkout,
  saveLiveSetDraft,
  setWorkoutReview,
  snoozeClientAttention,
  submitWorkoutFeedback,
  resolveWorkoutQuestion,
  setClientWorkoutComment,
  setLiveExerciseComment,
  softDeletePlannedWorkout,
  softDeleteWorkout,
  startLiveWorkout,
} from '../workout-commands.js'
import { withActorTransaction } from './actor-transaction.js'
import { PgDatabasePool } from './pg-pool.js'
import {
  DatabaseStageWorkoutFixtureLoader,
  STAGE_SMOKE_PROFILE_ID,
  stageWorkoutFixtureIds,
} from './stage-workout-fixture.js'
import {
  DatabaseStageDatabaseReaderAccessManager,
  StageDatabaseReaderNotReadyError,
} from './stage-database-reader-access.js'
import type { DatabasePool } from './types.js'
import {
  DatabasePilotEnroller,
  PilotEnrollmentConflictError,
} from './yandex-pilot-enrollment.js'
import {
  DatabaseYandexAccountLinker,
  YandexAccountLinkError,
} from '../yandex-account-linking.js'
import {
  DatabaseYandexAppSessionIssuer,
  DatabaseYandexAppSessionRevoker,
} from '../yandex-app-session.js'
import {
  YandexAppSessionDeniedError,
  YandexAppSessionInvalidError,
  withYandexAppSessionTransaction,
} from './yandex-app-transaction.js'
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
const DOMAIN_CLIENT_ACTOR_ID = '32e33d28-312f-4a22-8789-459de8541199'
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
const POST_WORKOUT_ID = 'cd691fd5-86ee-4740-838c-b37166df7e71'
const ASSISTANT_TURN_ID = 'a16c6f9e-86ee-4740-838c-b37166df7e71'
const ASSISTANT_ACTION_ID = 'ea691fd5-86ee-4740-838c-b37166df7e71'
const PROGRESS_WORKOUT_EXERCISE_ID = '736e9f0c-634a-42e0-a13b-2c5b070fe5ef'
const PROGRESS_WORKOUT_SET_ID = '9a15f723-44cb-4cf1-9bcf-4659c43cc764'
const ROOT_WORKOUT_EXERCISE_ID = 'd40b742b-5d5b-41ab-91df-ed464414d034'
const ROOT_WORKOUT_SET_ID = 'ea8efab5-0530-4660-9798-79901fcddfeb'
const LIVE_OPERATION_IDS = {
  start: '8bdf6402-7530-4a28-8f45-2b127414c56a',
  startOther: 'f67041a0-baa2-45c8-9a92-2e7054f37afb',
  save: '16db9e7f-764b-454d-aa10-04370ab43149',
  staleSave: '315638e8-2052-4d13-9b3b-f4157102c9cb',
  confirm: '93c54052-ee01-409f-b782-b89231e233eb',
  finish: '609f7f16-c782-4bf3-8389-ef6b6f8ec8c5',
  outside: 'f6e49b82-ee88-46a5-8ccb-8abb00843336',
} as const
const LIVE_STRUCTURE_OPERATION_IDS = {
  appendExercise: 'd700203f-acf6-43a5-a938-107a4f4e57d5',
  appendSet: 'e40e8718-9b54-47af-9a4a-daf326d1cff4',
  clientComment: 'f447d74d-c821-46a4-bae5-a3b99864a56e',
  comment: '57b8b310-c604-46c9-8ef7-c29c772a8744',
  lastSet: 'c4c92d19-bacd-49e2-b979-cb12380f2a2e',
  outside: 'fbca8ce5-8b5f-4035-865c-cb6559566f40',
  removeSet: 'b49323e3-713d-4b3d-af04-8a6067c67c9d',
  reorder: '1b6079dc-4d73-4e4d-80f4-e3496d158d4e',
  replace: '29157073-e963-4e02-85c7-62299757d2d9',
  replaceStarted: '5da77812-96b8-4f06-9700-3dbcb47e28ae',
  staleComment: 'c05c98ae-efc3-4c10-b12b-11862c30bd48',
  start: '935d1c4f-f3bd-4d80-a76b-30dd4fe73814',
} as const
const PILOT_SUBJECT_HASH = 'b'.repeat(64)
const OUTSIDE_SUBJECT_HASH = 'c'.repeat(64)
const ENROLLMENT_SUBJECT_HASH = 'e'.repeat(64)
const APP_ACTOR_ID = '53ec8d8f-8d29-4a1d-9f40-1e00ba797da0'
const APP_SUBJECT_HASH = 'f'.repeat(64)
const LINK_ACTOR_ID = 'a6145f94-3889-47b3-8e63-b0f72df8f2ee'
const LINK_SUBJECT_HASH = '6'.repeat(64)
const OTHER_LINK_SUBJECT_HASH = '7'.repeat(64)
const RUNTIME_PASSWORD = 'fit-api-test-only'
const READER_ROLE = 'fit_ops_reader_test'
const READER_PASSWORD = 'fit-ops-reader-test-only'
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

interface AppFeedbackAuditRow extends QueryResultRow {
  account_role: string
  app_version: string
  display_mode: string
  kind: string
  message: string
  screen_path: string
  user_agent: string
  user_id: string
}

interface PushSubscriptionAuditRow extends QueryResultRow {
  auth_key: string
  endpoint: string
  p256dh: string
  user_id: string
}

interface JsonResultRow extends QueryResultRow {
  result: Record<string, unknown> | unknown[]
}

interface WorkoutAuditRow extends QueryResultRow {
  created_by: string | null
  deleted_at: Date | null
  notes: string | null
  updated_by: string | null
  version: string
}

interface ChildAuditRow extends QueryResultRow {
  updated_by: string | null
}

interface WorkoutPrivilegeRow extends QueryResultRow {
  direct_writes: boolean
  mutation_execute: boolean
  private_receipt_execute: boolean
  structure_execute: boolean
}

interface LiveSetAuditRow extends QueryResultRow {
  confirmed_at: Date | null
  fact_distance_km: string | null
  fact_duration_sec: number | null
  fact_rpe: string | null
  updated_by: string | null
  version: string
}

interface LiveOperationAuditRow extends QueryResultRow {
  count: number
  hashes_valid: boolean
}

interface LiveStructureAuditRow extends QueryResultRow {
  exercise_name: string
  input_kind: string
  position: number
  trainer_comment: string | null
  updated_by: string | null
}

interface LiveStructureReceiptRow extends QueryResultRow {
  count: number
  resource_ids_present: boolean
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
        `delete from public.workouts
         where notes in (
           'Завершённая тренировка без Live',
           'Исправленный факт',
           'Прошлый план',
           'План для переноса'
         )`,
      )
      await ownerPool.query(
        `delete from public.client_goals where client_id in (
           select id from public.clients where full_name = 'Тестовый клиент Yandex stage'
         )`,
      )
      await ownerPool.query(
        `delete from public.client_progress where client_id in (
           select id from public.clients where full_name = 'Тестовый клиент Yandex stage'
         )`,
      )
      await ownerPool.query(
        `delete from public.client_custom_metrics where client_id in (
           select id from public.clients where full_name = 'Тестовый клиент Yandex stage'
         )`,
      )
      await ownerPool.query(
        `delete from public.custom_exercises
         where name = 'Тестовая тяга Yandex stage'`,
      )
      await ownerPool.query(
        `delete from public.client_trainer_relationships
         where client_id in (
           select id from public.clients where full_name = 'Тестовый клиент Yandex stage'
         )`,
      )
      await ownerPool.query(
        `delete from public.clients
         where full_name = 'Тестовый клиент Yandex stage'`,
      )
      await ownerPool.query(
        `delete from public.clients
         where trainer_id = $1 and full_name = 'Клиент из Assistant'`,
        [ACTOR_ID],
      )
      await ownerPool.query(
        'delete from public.profiles where id = $1',
        [stageWorkoutFixtureIds(STAGE_SMOKE_PROFILE_ID).clientActorId],
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
        'delete from public.client_trainer_relationships where client_id = $1',
        [LIFECYCLE_CLIENT_ID],
      )
      await ownerPool.query(
        'delete from public.clients where id = $1',
        [LIFECYCLE_CLIENT_ID],
      )
      await ownerPool.query(
        'delete from public.workouts where id = $1',
        [POST_WORKOUT_ID],
      )
      await ownerPool.query(
        'delete from public.profiles where id = $1',
        [LIFECYCLE_CLIENT_ACTOR_ID],
      )
      await ownerPool.query(
        'delete from app_private.yandex_app_sessions where profile_id = any($1::uuid[])',
        [[APP_ACTOR_ID, LINK_ACTOR_ID]],
      )
      await ownerPool.query(
        `
          delete from app_private.auth_identities
          where provider = 'yandex'
            and (
              provider_subject_sha256 = any($1::text[])
              or profile_id = any($2::uuid[])
            )
        `,
        [
          [APP_SUBJECT_HASH, LINK_SUBJECT_HASH, OTHER_LINK_SUBJECT_HASH],
          [APP_ACTOR_ID, LINK_ACTOR_ID],
        ],
      )
      await ownerPool.query(
        'delete from app_private.profile_rollout_assignments where profile_id = any($1::uuid[])',
        [[APP_ACTOR_ID, LINK_ACTOR_ID]],
      )
      await ownerPool.query(
        'delete from public.profiles where id = any($1::uuid[])',
        [[APP_ACTOR_ID, LINK_ACTOR_ID]],
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
          insert into public.profiles (id, first_name, account_role)
          values
            ($1, 'App actor', 'trainer'),
            ($2, 'Link actor', 'client')
          on conflict (id) do update set
            first_name = excluded.first_name,
            account_role = excluded.account_role
        `,
        [APP_ACTOR_ID, LINK_ACTOR_ID],
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
      await ownerPool.query(
        `
          insert into app_private.auth_identities (
            provider, provider_subject_sha256, profile_id
          ) values ('yandex', $1, $2)
          on conflict (provider, provider_subject_sha256) do update set
            profile_id = excluded.profile_id
        `,
        [APP_SUBJECT_HASH, APP_ACTOR_ID],
      )
      await ownerPool.query(
        `
          insert into app_private.profile_rollout_assignments (
            profile_id, target_backend, access_mode, enabled
          ) values ($1, 'yandex', 'read_write', true)
          on conflict (profile_id) do update set
            target_backend = excluded.target_backend,
            access_mode = excluded.access_mode,
            enabled = excluded.enabled
        `,
        [APP_ACTOR_ID],
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

    it('grants only curated operational views and revokes them idempotently', async () => {
      if (ownerPool === undefined || enrollmentPool === undefined) {
        throw new Error('Database pools are not ready')
      }
      await ownerPool.query(`
        do $$
        begin
          if not exists (
            select 1 from pg_catalog.pg_roles where rolname = '${READER_ROLE}'
          ) then
            create role ${READER_ROLE} login password '${READER_PASSWORD}';
          else
            alter role ${READER_ROLE} login password '${READER_PASSWORD}';
          end if;
        end
        $$;
      `)

      const manager = new DatabaseStageDatabaseReaderAccessManager(enrollmentPool)
      const readerUrl = new URL(requireLocalTestDatabaseUrl())
      readerUrl.username = READER_ROLE
      readerUrl.password = READER_PASSWORD
      const readerPool = new Pool({ connectionString: readerUrl.toString(), max: 1 })

      try {
        await manager.setAccess('grant', READER_ROLE)
        await manager.setAccess('grant', READER_ROLE)

        const visibleProfiles = await readerPool.query(
          'select id from ops_readonly.profiles where id = $1',
          [ACTOR_ID],
        )
        expect(visibleProfiles.rows).toEqual([{ id: ACTOR_ID }])
        await expect(readerPool.query(
          'select id from ops_readonly.app_feedback limit 0',
        )).resolves.toMatchObject({ rows: [] })

        const clientColumns = await readerPool.query<{ column_name: string }>(
          `
            select column_name
            from information_schema.columns
            where table_schema = 'ops_readonly' and table_name = 'clients'
            order by ordinal_position
          `,
        )
        expect(clientColumns.rows.map((row) => row.column_name)).toEqual([
          'id',
          'trainer_id',
          'auth_user_id',
          'archived_at',
          'version',
          'created_at',
          'updated_at',
        ])

        await expect(readerPool.query('select id from public.profiles'))
          .rejects.toMatchObject({ code: '42501' })
        await expect(readerPool.query(
          'select profile_id from app_private.auth_identities',
        )).rejects.toMatchObject({ code: '42501' })
        await expect(readerPool.query(
          `update ops_readonly.profiles set timezone = 'UTC' where id = $1`,
          [ACTOR_ID],
        )).rejects.toMatchObject({ code: '42501' })

        await manager.setAccess('revoke', READER_ROLE)
        await manager.setAccess('revoke', READER_ROLE)
        await expect(readerPool.query('select id from ops_readonly.profiles'))
          .rejects.toMatchObject({ code: '42501' })

        await ownerPool.query(`alter role ${READER_ROLE} bypassrls`)
        try {
          await expect(manager.setAccess('grant', READER_ROLE))
            .rejects.toBeInstanceOf(StageDatabaseReaderNotReadyError)
        } finally {
          await ownerPool.query(`alter role ${READER_ROLE} nobypassrls`)
        }
      } finally {
        await readerPool.end()
        await manager.setAccess('revoke', READER_ROLE)
        await ownerPool.query(`drop role if exists ${READER_ROLE}`)
      }
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

    it('issues and revokes a read-write Yandex app session only for enabled rollout', async () => {
      if (ownerPool === undefined || runtimePool === undefined) {
        throw new Error('Database pools are not ready')
      }

      const issuer = new DatabaseYandexAppSessionIssuer(
        runtimePool,
        () => new Date('2026-08-31T10:00:00.000Z'),
      )
      const revoker = new DatabaseYandexAppSessionRevoker(runtimePool)
      const session = await issuer.issue(APP_SUBJECT_HASH)

      expect(session?.accessMode).toBe('read_write')
      expect(session?.profile.id).toBe(APP_ACTOR_ID)
      expect(session?.session.token).toMatch(/^[A-Za-z0-9_-]{43}$/)
      const sessionDigest = session === undefined
        ? undefined
        : hashPilotSessionToken(session.session.token)
      const storedSessions = await ownerPool.query<SessionDigestRow>(
        `
          select token_sha256
          from app_private.yandex_app_sessions
          where profile_id = $1 and expires_at > now()
          order by created_at desc
          limit 1
        `,
        [APP_ACTOR_ID],
      )
      expect(storedSessions.rows).toEqual([{ token_sha256: sessionDigest }])
      expect(storedSessions.rows[0]?.token_sha256).not.toBe(session?.session.token)

      const resolvedActor = await withYandexAppSessionTransaction(
        runtimePool,
        sessionDigest ?? '',
        async (client) => {
          const rows = await client.query<ActorRow>(
            'select auth.uid() as actor_id',
          )
          return rows[0]?.actor_id ?? null
        },
      )
      expect(resolvedActor).toBe(APP_ACTOR_ID)
      expect(await revoker.revoke(session?.session.token ?? '')).toBe(true)
      await expect(
        withYandexAppSessionTransaction(
          runtimePool,
          sessionDigest ?? '',
          () => Promise.resolve(undefined),
        ),
      ).rejects.toBeInstanceOf(YandexAppSessionInvalidError)

      await ownerPool.query(
        'update app_private.profile_rollout_assignments set enabled = false where profile_id = $1',
        [APP_ACTOR_ID],
      )
      await expect(
        issuer.issue(APP_SUBJECT_HASH),
      ).rejects.toBeInstanceOf(YandexAppSessionDeniedError)
      await ownerPool.query(
        'update app_private.profile_rollout_assignments set enabled = true where profile_id = $1',
        [APP_ACTOR_ID],
      )

      await expect(
        issuer.issue(PILOT_SUBJECT_HASH),
      ).rejects.toBeInstanceOf(YandexAppSessionDeniedError)
      expect(await readActor(runtimePool)).toBeNull()
    })

    it('links Yandex ID to the current FIT actor without granting rollout access', async () => {
      if (ownerPool === undefined || runtimePool === undefined) {
        throw new Error('Database pools are not ready')
      }

      const linker = new DatabaseYandexAccountLinker(runtimePool)

      await expect(
        linker.linkActor(LINK_ACTOR_ID, LINK_SUBJECT_HASH),
      ).resolves.toEqual({ profileId: LINK_ACTOR_ID })
      await expect(
        linker.linkActor(LINK_ACTOR_ID, LINK_SUBJECT_HASH),
      ).resolves.toEqual({ profileId: LINK_ACTOR_ID })

      const linkedIdentities = await ownerPool.query<CountRow>(
        `
          select count(*)::int as count
          from app_private.auth_identities
          where provider = 'yandex'
            and provider_subject_sha256 = $1
            and profile_id = $2
        `,
        [LINK_SUBJECT_HASH, LINK_ACTOR_ID],
      )
      expect(linkedIdentities.rows).toEqual([{ count: 1 }])
      const rolloutRows = await ownerPool.query<CountRow>(
        `
          select count(*)::int as count
          from app_private.profile_rollout_assignments
          where profile_id = $1
        `,
        [LINK_ACTOR_ID],
      )
      expect(rolloutRows.rows).toEqual([{ count: 0 }])

      await expect(
        linker.linkActor(OTHER_ACTOR_ID, LINK_SUBJECT_HASH),
      ).rejects.toBeInstanceOf(YandexAccountLinkError)
      await expect(
        linker.linkActor(LINK_ACTOR_ID, OTHER_LINK_SUBJECT_HASH),
      ).rejects.toBeInstanceOf(YandexAccountLinkError)
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
        attention: [],
        attentionPreferences: [],
        hasMoreWorkouts: false,
        totalWorkouts: 0,
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
      ).resolves.toBe(LIFECYCLE_CLIENT_ID)

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
      expect(first.clientId).toBe(
        stageWorkoutFixtureIds(STAGE_SMOKE_PROFILE_ID).clientId,
      )
      expect(first.sessionToken).toMatch(/^[A-Za-z0-9_-]{43}$/)
      expect(first.sessionExpiresAt).toBe(expectedExpiry.toISOString())
      expect(first.clientSessionToken).toMatch(/^[A-Za-z0-9_-]{43}$/)
      expect(first.clientSessionExpiresAt).toBe(expectedExpiry.toISOString())

      const smokeData = await reader.readTrainingData(first.sessionToken)
      const smokeIds = stageWorkoutFixtureIds(STAGE_SMOKE_PROFILE_ID)
      const progressData = new DatabasePilotProgressData(runtimePool)
      const progressBundle = await progressData.readBundle(
        first.sessionToken,
        first.clientId,
      )
      expect(progressBundle).toMatchObject({
        entries: [{ id: smokeIds.progressId, clientId: smokeIds.clientId }],
        customMetrics: [{ id: smokeIds.progressMetricId }],
        goal: { id: smokeIds.goalId },
      })
      expect(JSON.stringify(progressBundle).length).toBeGreaterThan(0)
      expect(smokeData).toEqual({
        accessMode: 'read_only',
        customExercises: [
          {
            id: smokeIds.customExerciseId,
            name: 'Тестовая тяга Yandex stage',
            muscleGroup: 'back',
            inputKind: 'strength',
            archivedAt: null,
            version: 1,
            createdBy: STAGE_SMOKE_PROFILE_ID,
          },
        ],
        workouts: [
          {
            id: smokeIds.workoutId,
            trainerId: STAGE_SMOKE_PROFILE_ID,
            clientId: smokeIds.clientId,
            clientName: 'Тестовый клиент Yandex stage',
            createdBy: STAGE_SMOKE_PROFILE_ID,
            workoutDate: '2026-08-22',
            startTime: '10:00:00',
            endTime: '11:00:00',
            notes: 'Синтетическая проверка переноса Yandex stage',
            clientComment: null,
            sessionRpe: null,
            wellbeing: null,
            discomfort: null,
            feedbackSubmittedAt: null,
            trainerReaction: null,
            trainerReview: null,
            trainerReviewAuthorId: null,
            trainerReviewedAt: null,
            clientQuestion: null,
            clientQuestionAskedAt: null,
            clientQuestionResolvedAt: null,
            status: 'done',
            startedAt: '2026-08-22T07:00:00.000Z',
            completedAt: '2026-08-22T08:00:00.000Z',
            version: 1,
            stageId: null,
            stageTitle: null,
            hasPr: true,
            exercises: [
              {
                id: smokeIds.strengthExerciseId,
                position: 0,
                source: 'custom',
                ref: `custom:${smokeIds.customExerciseId}`,
                customExerciseId: smokeIds.customExerciseId,
                name: 'Тестовая тяга Yandex stage',
                muscleGroup: 'back',
                inputKind: 'strength',
                blockId: smokeIds.strengthBlockId,
                blockType: 'single',
                blockPreset: 'set',
                blockRounds: 1,
                restBetweenExercisesSec: 0,
                restBetweenRoundsSec: 90,
                restBetweenSetsSec: 90,
                trainerComment: 'Проверка весов и повторов',
                sets: [
                  {
                    id: smokeIds.strengthSetId,
                    position: 0,
                    plan: {
                      weightKg: 40,
                      reps: 10,
                      durationMin: null,
                      durationSec: null,
                      distanceKm: null,
                      rpe: 7,
                    },
                    fact: {
                      weightKg: 42.5,
                      reps: 10,
                      durationMin: null,
                      durationSec: null,
                      distanceKm: null,
                      rpe: 8,
                    },
                    confirmedAt: '2026-08-22T07:30:00.000Z',
                    version: 1,
                  },
                ],
              },
              {
                id: smokeIds.runningExerciseId,
                position: 1,
                source: 'system',
                ref: 'running',
                customExerciseId: null,
                name: 'Бег',
                muscleGroup: 'cardio',
                inputKind: 'distance',
                blockId: smokeIds.runningBlockId,
                blockType: 'single',
                blockPreset: 'interval',
                blockRounds: 1,
                restBetweenExercisesSec: 0,
                restBetweenRoundsSec: 90,
                restBetweenSetsSec: 60,
                trainerComment: 'Проверка времени и дистанции',
                sets: [
                  {
                    id: smokeIds.runningSetId,
                    position: 0,
                    plan: {
                      weightKg: null,
                      reps: null,
                      durationMin: null,
                      durationSec: 1800,
                      distanceKm: 5,
                      rpe: 7,
                    },
                    fact: {
                      weightKg: null,
                      reps: null,
                      durationMin: null,
                      durationSec: 1740,
                      distanceKm: 5.2,
                      rpe: 8,
                    },
                    confirmedAt: '2026-08-22T08:00:00.000Z',
                    version: 1,
                  },
                ],
              },
            ],
          },
        ],
        attention: [],
        attentionPreferences: [{
          clientId: smokeIds.clientId,
          snoozedUntil: null,
        }],
        hasMoreWorkouts: false,
        totalWorkouts: 1,
      })

      const clientSmokeData = await reader.readTrainingData(
        first.clientSessionToken,
      )
      expect(clientSmokeData.workouts.map((workout) => workout.id)).toEqual([
        smokeIds.workoutId,
      ])
      expect(clientSmokeData.attention).toEqual([])

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
      expect(second.clientSessionToken).not.toBe(first.clientSessionToken)

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

    it('saves planned aggregates atomically with versions and actor attribution', async () => {
      if (ownerPool === undefined || runtimePool === undefined) {
        throw new Error('Database pools are not ready')
      }

      const draft: PlannedWorkoutDraft = {
        id: null,
        clientId: CLIENT_ID,
        workoutDate: '2026-08-25',
        startTime: '10:00',
        endTime: '11:00',
        notes: 'Первый versioned план',
        exercises: [{
          position: 0,
          source: 'custom',
          ref: `custom:${ROOT_CUSTOM_EXERCISE_ID}`,
          customExerciseId: ROOT_CUSTOM_EXERCISE_ID,
          name: 'Тяга саней',
          muscleGroup: 'legs',
          inputKind: 'strength',
          blockId: 'ad2c5ddb-5dc8-4cdb-b463-8b0f03f8f2cb',
          blockType: 'single',
          blockPreset: 'set',
          blockRounds: 1,
          restBetweenExercisesSec: 0,
          restBetweenRoundsSec: 90,
          restBetweenSetsSec: 90,
          trainerComment: 'Контроль техники',
          sets: [{
            position: 0,
            weightKg: 40,
            reps: 10,
            durationMin: null,
            durationSec: null,
            distanceKm: null,
            rpe: 7,
          }],
        }],
      }

      const privileges = await ownerPool.query<WorkoutPrivilegeRow>(`
        select
          has_table_privilege(
            'fit_api',
            'public.workouts',
            'INSERT, UPDATE, DELETE'
          ) as direct_writes,
          has_function_privilege(
            'fit_api',
            'public.save_planned_workout(jsonb,bigint)',
            'EXECUTE'
          ) as mutation_execute,
          has_function_privilege(
            'fit_api',
            'public.append_live_exercise(uuid,jsonb,bigint,uuid)',
            'EXECUTE'
          ) as structure_execute,
          has_function_privilege(
            'fit_api',
            'app_private.complete_live_workout_operation(uuid,bigint,uuid)',
            'EXECUTE'
          ) as private_receipt_execute
      `)
      expect(privileges.rows).toEqual([{
        direct_writes: false,
        mutation_execute: true,
        private_receipt_execute: false,
        structure_execute: true,
      }])

      const created = await withActorTransaction(
        runtimePool,
        ACTOR_ID,
        (client) => savePlannedWorkout(client, draft, null),
      )
      expect(created.version).toBe(1)

      const updatedDraft: PlannedWorkoutDraft = {
        ...draft,
        id: created.id,
        notes: 'Обновлённый versioned план',
        exercises: [{
          ...draft.exercises[0]!,
          sets: [{ ...draft.exercises[0]!.sets[0]!, weightKg: 42.5 }],
        }],
      }
      const updated = await withActorTransaction(
        runtimePool,
        ACTOR_ID,
        (client) => savePlannedWorkout(client, updatedDraft, created.version),
      )
      expect(updated).toEqual({ id: created.id, version: 2 })

      const invalidDraft: PlannedWorkoutDraft = {
        ...updatedDraft,
        notes: 'Эта запись должна откатиться',
        exercises: [{
          ...updatedDraft.exercises[0]!,
          customExerciseId: OUTSIDE_TRAINER_ID,
        }],
      }
      await expect(withActorTransaction(
        runtimePool,
        ACTOR_ID,
        (client) => savePlannedWorkout(client, invalidDraft, updated.version),
      )).rejects.toMatchObject({ failure: 'invalid' })

      await expect(withActorTransaction(
        runtimePool,
        ACTOR_ID,
        (client) => savePlannedWorkout(
          client,
          { ...updatedDraft, notes: 'Устаревшая запись' },
          created.version,
        ),
      )).rejects.toMatchObject({ failure: 'conflict' })

      await expect(withActorTransaction(
        runtimePool,
        OUTSIDE_TRAINER_ID,
        (client) => savePlannedWorkout(client, updatedDraft, updated.version),
      )).rejects.toMatchObject({ failure: 'forbidden' })
      await expect(withActorTransaction(
        runtimePool,
        MEMBER_TRAINER_ID,
        (client) => savePlannedWorkout(client, updatedDraft, updated.version),
      )).rejects.toMatchObject({ failure: 'not_found' })

      const workoutRows = await ownerPool.query<WorkoutAuditRow>(
        `
          select created_by, deleted_at, notes, updated_by, version
          from public.workouts
          where id = $1
        `,
        [created.id],
      )
      expect(workoutRows.rows).toEqual([{
        created_by: ACTOR_ID,
        deleted_at: null,
        notes: 'Обновлённый versioned план',
        updated_by: ACTOR_ID,
        version: '2',
      }])

      const exerciseRows = await ownerPool.query<ChildAuditRow>(
        'select updated_by from public.workout_exercises where workout_id = $1',
        [created.id],
      )
      expect(exerciseRows.rows).toEqual([{ updated_by: ACTOR_ID }])
      const setRows = await ownerPool.query<ChildAuditRow>(
        `
          select workout_set.updated_by
          from public.workout_sets workout_set
          join public.workout_exercises exercise
            on exercise.id = workout_set.workout_exercise_id
          where exercise.workout_id = $1
        `,
        [created.id],
      )
      expect(setRows.rows).toEqual([{ updated_by: ACTOR_ID }])

      const deletedVersion = await withActorTransaction(
        runtimePool,
        ACTOR_ID,
        (client) => softDeletePlannedWorkout(client, created.id, updated.version),
      )
      expect(deletedVersion).toBe(3)

      const actorData = await withActorTransaction(
        runtimePool,
        ACTOR_ID,
        readAccessibleTrainingData,
      )
      expect(actorData.workouts.some((workout) => workout.id === created.id)).toBe(false)
      await ownerPool.query('delete from public.workouts where id = $1', [created.id])
    })

    it('saves and corrects completed facts idempotently without rewriting the plan', async () => {
      if (ownerPool === undefined || runtimePool === undefined) {
        throw new Error('Database pools are not ready')
      }

      const requestId = 'b081807b-5fe5-4b26-8e72-dfe3b9eb054a'
      const draft: PlannedWorkoutDraft = {
        id: null,
        requestId,
        clientId: CLIENT_ID,
        workoutDate: '2026-08-20',
        startTime: null,
        endTime: null,
        notes: 'Завершённая тренировка без Live',
        exercises: [{
          position: 0,
          source: 'system',
          ref: 'barbell-squat',
          customExerciseId: null,
          name: 'Приседания со штангой',
          muscleGroup: 'legs',
          inputKind: 'strength',
          blockId: 'cbf26086-1e3b-4fba-a46c-d3ff6ee9f5ad',
          blockType: 'single',
          blockPreset: 'set',
          blockRounds: 1,
          restBetweenExercisesSec: 0,
          restBetweenRoundsSec: 90,
          restBetweenSetsSec: 90,
          trainerComment: 'Контроль глубины',
          sets: [{
            position: 0,
            weightKg: 40,
            reps: 10,
            durationMin: null,
            durationSec: null,
            distanceKm: null,
            rpe: 7,
          }],
        }],
      }

      const created = await withActorTransaction(
        runtimePool,
        ACTOR_ID,
        (client) => saveCompletedWorkout(client, draft, null),
      )
      expect(created.version).toBe(2)
      await expect(withActorTransaction(
        runtimePool,
        ACTOR_ID,
        (client) => saveCompletedWorkout(client, draft, null),
      )).resolves.toEqual(created)

      const aggregate = await ownerPool.query<QueryResultRow & {
        completed_at: Date
        exercise_id: string
        fact_weight_kg: string
        plan_weight_kg: string
        set_id: string
        status: string
      }>(
        `
          select
            workout.status,
            workout.completed_at,
            exercise.id as exercise_id,
            workout_set.id as set_id,
            workout_set.plan_weight_kg,
            workout_set.fact_weight_kg
          from public.workouts workout
          join public.workout_exercises exercise
            on exercise.workout_id = workout.id
          join public.workout_sets workout_set
            on workout_set.workout_exercise_id = exercise.id
          where workout.id = $1
        `,
        [created.id],
      )
      expect(aggregate.rows[0]).toMatchObject({
        fact_weight_kg: '40.00',
        plan_weight_kg: '40.00',
        status: 'done',
      })
      const originalCompletedAt = aggregate.rows[0]!.completed_at.toISOString()
      const correctedDraft: PlannedWorkoutDraft = {
        ...draft,
        id: created.id,
        notes: 'Исправленный факт',
        exercises: [{
          ...draft.exercises[0]!,
          sourceExerciseId: aggregate.rows[0]!.exercise_id,
          sets: [{
            ...draft.exercises[0]!.sets[0]!,
            sourceSetId: aggregate.rows[0]!.set_id,
            weightKg: 45,
          }],
        }],
      }
      delete correctedDraft.requestId
      await expect(withActorTransaction(
        runtimePool,
        ACTOR_ID,
        (client) => saveCompletedWorkout(
          client,
          { ...correctedDraft, clientId: LIFECYCLE_CLIENT_ID },
          created.version,
        ),
      )).rejects.toMatchObject({ failure: 'invalid' })

      const corrected = await withActorTransaction(
        runtimePool,
        ACTOR_ID,
        (client) => saveCompletedWorkout(client, correctedDraft, created.version),
      )
      expect(corrected.version).toBe(3)

      const correctedRows = await ownerPool.query<QueryResultRow & {
        completed_at: Date
        fact_weight_kg: string
        plan_weight_kg: string
      }>(
        `
          select workout.completed_at,
            workout_set.plan_weight_kg,
            workout_set.fact_weight_kg
          from public.workouts workout
          join public.workout_exercises exercise
            on exercise.workout_id = workout.id
          join public.workout_sets workout_set
            on workout_set.workout_exercise_id = exercise.id
          where workout.id = $1 and workout_set.id = $2
        `,
        [created.id, aggregate.rows[0]!.set_id],
      )
      expect(correctedRows.rows).toEqual([{
        completed_at: new Date(originalCompletedAt),
        fact_weight_kg: '45.00',
        plan_weight_kg: '40.00',
      }])

      await expect(withActorTransaction(
        runtimePool,
        OUTSIDE_TRAINER_ID,
        (client) => saveCompletedWorkout(
          client,
          correctedDraft,
          corrected.version,
        ),
      )).rejects.toMatchObject({ failure: 'forbidden' })

      const deletedVersion = await withActorTransaction(
        runtimePool,
        ACTOR_ID,
        (client) => softDeleteWorkout(client, created.id, corrected.version),
      )
      expect(deletedVersion).toBe(4)
      await ownerPool.query('delete from public.workouts where id = $1', [created.id])
    })

    it('records a past plan atomically and resolves cancel, reschedule and comment actions', async () => {
      if (ownerPool === undefined || runtimePool === undefined) {
        throw new Error('Database pools are not ready')
      }

      const plan: PlannedWorkoutDraft = {
        id: null,
        clientId: CLIENT_ID,
        workoutDate: '2000-01-01',
        startTime: '10:00',
        endTime: null,
        notes: 'Прошлый план',
        exercises: [{
          position: 0,
          source: 'system',
          ref: 'running',
          customExerciseId: null,
          name: 'Бег',
          muscleGroup: 'cardio',
          inputKind: 'distance',
          blockId: '3a802aee-86c7-49aa-9e9b-404a4bc53058',
          blockType: 'single',
          blockPreset: 'set',
          blockRounds: 1,
          restBetweenExercisesSec: 0,
          restBetweenRoundsSec: 90,
          restBetweenSetsSec: 60,
          trainerComment: null,
          sets: [{
            position: 0,
            weightKg: null,
            reps: null,
            durationMin: null,
            durationSec: 1800,
            distanceKm: 5,
            rpe: 7,
          }],
        }],
      }
      const created = await withActorTransaction(
        runtimePool,
        ACTOR_ID,
        (client) => savePlannedWorkout(client, plan, null),
      )
      const sourceRows = await ownerPool.query<QueryResultRow & {
        exercise_id: string
        set_id: string
      }>(
        `
          select exercise.id as exercise_id, workout_set.id as set_id
          from public.workout_exercises exercise
          join public.workout_sets workout_set
            on workout_set.workout_exercise_id = exercise.id
          where exercise.workout_id = $1
        `,
        [created.id],
      )
      const resultDraft: PlannedWorkoutDraft = {
        ...plan,
        id: created.id,
        exercises: [{
          ...plan.exercises[0]!,
          sourceExerciseId: sourceRows.rows[0]!.exercise_id,
          sets: [{
            ...plan.exercises[0]!.sets[0]!,
            sourceSetId: sourceRows.rows[0]!.set_id,
            durationSec: 1740,
            distanceKm: 5.2,
            rpe: 8,
          }],
        }],
      }
      const recorded = await withActorTransaction(
        runtimePool,
        ACTOR_ID,
        (client) => recordPlannedWorkoutResult(
          client,
          resultDraft,
          created.version,
        ),
      )
      expect(recorded).toEqual({ id: created.id, version: 3 })
      await expect(withActorTransaction(
        runtimePool,
        ACTOR_ID,
        (client) => recordPlannedWorkoutResult(
          client,
          resultDraft,
          created.version,
        ),
      )).rejects.toMatchObject({ failure: 'conflict' })
      await withActorTransaction(
        runtimePool,
        OTHER_ACTOR_ID,
        (client) => setClientWorkoutComment(
          client,
          created.id,
          '  Темп был комфортным  ',
          recorded.version,
        ),
      )
      const recordedRows = await ownerPool.query<QueryResultRow & {
        client_comment: string
        fact_distance_km: string
        plan_distance_km: string
        status: string
      }>(
        `
          select workout.status, workout.client_comment,
            workout_set.plan_distance_km, workout_set.fact_distance_km
          from public.workouts workout
          join public.workout_exercises exercise
            on exercise.workout_id = workout.id
          join public.workout_sets workout_set
            on workout_set.workout_exercise_id = exercise.id
          where workout.id = $1
        `,
        [created.id],
      )
      expect(recordedRows.rows).toEqual([{
        client_comment: 'Темп был комфортным',
        fact_distance_km: '5.200',
        plan_distance_km: '5.000',
        status: 'done',
      }])

      const missed = await withActorTransaction(
        runtimePool,
        ACTOR_ID,
        (client) => savePlannedWorkout(client, {
          ...plan,
          notes: 'План для переноса',
          exercises: [],
        }, null),
      )
      await expect(withActorTransaction(
        runtimePool,
        OUTSIDE_TRAINER_ID,
        (client) => cancelPlannedWorkout(client, missed.id, missed.version),
      )).rejects.toMatchObject({ failure: 'forbidden' })
      const cancelledVersion = await withActorTransaction(
        runtimePool,
        OTHER_ACTOR_ID,
        (client) => cancelPlannedWorkout(client, missed.id, missed.version),
      )
      expect(cancelledVersion).toBe(2)
      const rescheduledVersion = await withActorTransaction(
        runtimePool,
        OTHER_ACTOR_ID,
        (client) => rescheduleWorkout(
          client,
          missed.id,
          '2099-01-01',
          '12:30',
          cancelledVersion,
        ),
      )
      expect(rescheduledVersion).toBe(3)
      const rescheduledRows = await ownerPool.query<QueryResultRow & {
        end_time: string | null
        start_time: string
        status: string
        workout_date: string
      }>(
        `select status, workout_date::text, start_time, end_time
         from public.workouts where id = $1`,
        [missed.id],
      )
      expect(rescheduledRows.rows).toEqual([{
        end_time: null,
        start_time: '12:30:00',
        status: 'planned',
        workout_date: '2099-01-01',
      }])

      await withActorTransaction(
        runtimePool,
        ACTOR_ID,
        (client) => softDeleteWorkout(client, created.id, recorded.version + 1),
      )
      await withActorTransaction(
        runtimePool,
        ACTOR_ID,
        (client) => softDeleteWorkout(client, missed.id, rescheduledVersion),
      )
      await ownerPool.query(
        'delete from public.workouts where id = any($1::uuid[])',
        [[created.id, missed.id]],
      )
    })

    it('keeps post-workout feedback, questions and attention tenant-safe and idempotent', async () => {
      if (ownerPool === undefined || runtimePool === undefined) {
        throw new Error('Database pools are not ready')
      }

      await ownerPool.query('delete from public.workouts where id = $1', [POST_WORKOUT_ID])
      await ownerPool.query(
        `
          insert into public.workouts (
            id, trainer_id, client_id, created_by, workout_date,
            status, completed_at, notes
          ) values ($1, $2, $3, $2, '2026-08-24', 'done', now(),
            'Post-workout contract')
        `,
        [POST_WORKOUT_ID, ACTOR_ID, CLIENT_ID],
      )

      const feedback = {
        sessionRpe: 8,
        wellbeing: 'normal' as const,
        discomfort: true,
        comment: '  Тянуло плечо  ',
        expectedVersion: 1,
      }
      await expect(withActorTransaction(
        runtimePool,
        OTHER_ACTOR_ID,
        (client) => submitWorkoutFeedback(client, POST_WORKOUT_ID, feedback),
      )).resolves.toBe(2)
      await expect(withActorTransaction(
        runtimePool,
        OTHER_ACTOR_ID,
        (client) => submitWorkoutFeedback(client, POST_WORKOUT_ID, feedback),
      )).resolves.toBe(2)
      await expect(withActorTransaction(
        runtimePool,
        OUTSIDE_TRAINER_ID,
        (client) => submitWorkoutFeedback(client, POST_WORKOUT_ID, feedback),
      )).rejects.toMatchObject({ failure: 'forbidden' })

      const attentionAfterFeedback = await withActorTransaction(
        runtimePool,
        ACTOR_ID,
        (client) => client.query<QueryResultRow & { workout_id: string }>(
          `select workout_id from public.list_trainer_attention_workouts()
           where workout_id = $1`,
          [POST_WORKOUT_ID],
        ),
      )
      expect(attentionAfterFeedback).toEqual([{ workout_id: POST_WORKOUT_ID }])
      await expect(withActorTransaction(
        runtimePool,
        MEMBER_TRAINER_ID,
        (client) => client.query(
          `select workout_id from public.list_trainer_attention_workouts()
           where workout_id = $1`,
          [POST_WORKOUT_ID],
        ),
      )).resolves.toEqual([])

      const reviewed = await withActorTransaction(
        runtimePool,
        ACTOR_ID,
        (client) => setWorkoutReview(client, POST_WORKOUT_ID, {
          reaction: 'strong',
          review: 'Снизим нагрузку на плечо',
          expectedVersion: 2,
        }),
      )
      expect(reviewed).toBe(3)
      await expect(withActorTransaction(
        runtimePool,
        MEMBER_TRAINER_ID,
        (client) => setWorkoutReview(client, POST_WORKOUT_ID, {
          reaction: 'fire',
          review: 'Чужой ответ',
          expectedVersion: reviewed,
        }),
      )).rejects.toMatchObject({ failure: 'forbidden' })

      const asked = await withActorTransaction(
        runtimePool,
        OTHER_ACTOR_ID,
        (client) => askWorkoutQuestion(
          client, POST_WORKOUT_ID, 'Можно заменить упражнение?', reviewed,
        ),
      )
      expect(asked).toBe(4)
      await expect(withActorTransaction(
        runtimePool,
        OTHER_ACTOR_ID,
        (client) => askWorkoutQuestion(
          client, POST_WORKOUT_ID, 'Можно заменить упражнение?', reviewed,
        ),
      )).resolves.toBe(asked)
      await expect(withActorTransaction(
        runtimePool,
        MEMBER_TRAINER_ID,
        (client) => answerWorkoutQuestion(client, POST_WORKOUT_ID, {
          reaction: null,
          review: 'Ответ подключённого тренера',
          expectedVersion: asked,
        }),
      )).rejects.toMatchObject({ failure: 'forbidden' })

      const answered = await withActorTransaction(
        runtimePool,
        ACTOR_ID,
        (client) => answerWorkoutQuestion(client, POST_WORKOUT_ID, {
          reaction: null,
          review: 'Да, заменим в следующем плане',
          expectedVersion: asked,
        }),
      )
      expect(answered).toBe(5)
      const noAttention = await withActorTransaction(
        runtimePool,
        ACTOR_ID,
        (client) => client.query(
          `select workout_id from public.list_trainer_attention_workouts()
           where workout_id = $1`,
          [POST_WORKOUT_ID],
        ),
      )
      expect(noAttention).toEqual([])

      const askedAgain = await withActorTransaction(
        runtimePool,
        OTHER_ACTOR_ID,
        (client) => askWorkoutQuestion(
          client, POST_WORKOUT_ID, 'А какой именно вариант?', answered,
        ),
      )
      await expect(withActorTransaction(
        runtimePool,
        ACTOR_ID,
        (client) => resolveWorkoutQuestion(client, POST_WORKOUT_ID, askedAgain),
      )).resolves.toBe(7)

      const snoozedUntil = await withActorTransaction(
        runtimePool,
        ACTOR_ID,
        (client) => snoozeClientAttention(client, CLIENT_ID),
      )
      expect(new Date(snoozedUntil).getTime()).toBeGreaterThan(Date.now())
      await expect(withActorTransaction(
        runtimePool,
        ACTOR_ID,
        (client) => snoozeClientAttention(client, CLIENT_ID),
      )).resolves.toBe(snoozedUntil)
      const readModel = await withActorTransaction(
        runtimePool,
        ACTOR_ID,
        readAccessibleTrainingData,
      )
      expect(readModel.workouts.find((workout) => workout.id === POST_WORKOUT_ID))
        .toMatchObject({
          sessionRpe: 8,
          wellbeing: 'normal',
          discomfort: true,
          clientComment: 'Тянуло плечо',
          trainerReaction: null,
          trainerReview: 'Да, заменим в следующем плане',
          clientQuestion: 'А какой именно вариант?',
          version: 7,
        })
      expect(readModel.attention.some(
        (attention) => attention.workoutId === POST_WORKOUT_ID,
      )).toBe(false)
      expect(readModel.attentionPreferences).toContainEqual({
        clientId: CLIENT_ID,
        snoozedUntil: snoozedUntil,
      })

      await ownerPool.query('delete from public.workouts where id = $1', [POST_WORKOUT_ID])
    })

    it('runs the idempotent live core lifecycle with conflicts and actor attribution', async () => {
      if (ownerPool === undefined || runtimePool === undefined) {
        throw new Error('Database pools are not ready')
      }

      await ownerPool.query(
        `
          delete from app_private.live_workout_operations
          where actor_id in ($1, $2)
            and operation_id = any($3::uuid[])
        `,
        [OTHER_ACTOR_ID, OUTSIDE_TRAINER_ID, Object.values(LIVE_OPERATION_IDS)],
      )
      await ownerPool.query(
        `
          update public.workouts
          set
            status = 'planned',
            started_at = null,
            completed_at = null,
            updated_by = null,
            version = 1
          where client_id = $1 and status = 'in_progress'
        `,
        [CLIENT_ID],
      )
      await ownerPool.query(
        `
          update public.workouts
          set
            status = 'planned',
            started_at = null,
            completed_at = null,
            updated_by = null,
            version = 1
          where id in ($1, $2)
        `,
        [ROOT_WORKOUT_ID, MEMBER_WORKOUT_ID],
      )
      await ownerPool.query(
        `
          update public.workout_sets
          set
            fact_weight_kg = null,
            fact_reps = null,
            fact_duration_min = null,
            fact_duration_sec = null,
            fact_distance_km = null,
            fact_rpe = null,
            confirmed_at = null,
            updated_by = null,
            version = 1
          where id = $1
        `,
        [ROOT_WORKOUT_SET_ID],
      )

      try {
        const started = await withActorTransaction(
          runtimePool,
          OTHER_ACTOR_ID,
          (client) => startLiveWorkout(
            client,
            ROOT_WORKOUT_ID,
            1,
            LIVE_OPERATION_IDS.start,
          ),
        )
        expect(started).toEqual({ version: 2, replayed: false })

        await expect(withActorTransaction(
          runtimePool,
          OTHER_ACTOR_ID,
          (client) => startLiveWorkout(
            client,
            ROOT_WORKOUT_ID,
            1,
            LIVE_OPERATION_IDS.start,
          ),
        )).resolves.toEqual({ version: 2, replayed: true })

        await expect(withActorTransaction(
          runtimePool,
          OTHER_ACTOR_ID,
          (client) => startLiveWorkout(
            client,
            ROOT_WORKOUT_ID,
            2,
            LIVE_OPERATION_IDS.start,
          ),
        )).rejects.toMatchObject({ failure: 'invalid' })

        await expect(withActorTransaction(
          runtimePool,
          OTHER_ACTOR_ID,
          (client) => startLiveWorkout(
            client,
            MEMBER_WORKOUT_ID,
            1,
            LIVE_OPERATION_IDS.startOther,
          ),
        )).rejects.toMatchObject({ failure: 'active' })

        await expect(withActorTransaction(
          runtimePool,
          OUTSIDE_TRAINER_ID,
          (client) => startLiveWorkout(
            client,
            ROOT_WORKOUT_ID,
            2,
            LIVE_OPERATION_IDS.outside,
          ),
        )).rejects.toMatchObject({ failure: 'forbidden' })

        const draft = {
          weightKg: null,
          reps: null,
          durationMin: null,
          durationSec: 1_650,
          distanceKm: 5.25,
          rpe: 7.5,
        }
        await expect(withActorTransaction(
          runtimePool,
          OTHER_ACTOR_ID,
          (client) => saveLiveSetDraft(
            client,
            ROOT_WORKOUT_SET_ID,
            draft,
            1,
            LIVE_OPERATION_IDS.save,
          ),
        )).resolves.toEqual({ version: 2, replayed: false })
        await expect(withActorTransaction(
          runtimePool,
          OTHER_ACTOR_ID,
          (client) => saveLiveSetDraft(
            client,
            ROOT_WORKOUT_SET_ID,
            draft,
            1,
            LIVE_OPERATION_IDS.save,
          ),
        )).resolves.toEqual({ version: 2, replayed: true })
        await expect(withActorTransaction(
          runtimePool,
          OTHER_ACTOR_ID,
          (client) => saveLiveSetDraft(
            client,
            ROOT_WORKOUT_SET_ID,
            { ...draft, distanceKm: 6 },
            1,
            LIVE_OPERATION_IDS.staleSave,
          ),
        )).rejects.toMatchObject({ failure: 'conflict' })

        await expect(withActorTransaction(
          runtimePool,
          OTHER_ACTOR_ID,
          (client) => confirmLiveSet(
            client,
            ROOT_WORKOUT_SET_ID,
            2,
            LIVE_OPERATION_IDS.confirm,
          ),
        )).resolves.toEqual({ version: 3, replayed: false })
        await expect(withActorTransaction(
          runtimePool,
          OTHER_ACTOR_ID,
          (client) => confirmLiveSet(
            client,
            ROOT_WORKOUT_SET_ID,
            2,
            LIVE_OPERATION_IDS.confirm,
          ),
        )).resolves.toEqual({ version: 3, replayed: true })

        const setRows = await ownerPool.query<LiveSetAuditRow>(
          `
            select
              confirmed_at, fact_distance_km, fact_duration_sec, fact_rpe,
              updated_by, version
            from public.workout_sets
            where id = $1
          `,
          [ROOT_WORKOUT_SET_ID],
        )
        expect(setRows.rows).toMatchObject([{
          fact_distance_km: '5.250',
          fact_duration_sec: 1650,
          fact_rpe: '7.5',
          updated_by: OTHER_ACTOR_ID,
          version: '3',
        }])
        expect(setRows.rows[0]?.confirmed_at).toBeInstanceOf(Date)

        await expect(withActorTransaction(
          runtimePool,
          OTHER_ACTOR_ID,
          (client) => finishLiveWorkout(
            client,
            ROOT_WORKOUT_ID,
            2,
            LIVE_OPERATION_IDS.finish,
          ),
        )).resolves.toEqual({ version: 3, replayed: false })
        await expect(withActorTransaction(
          runtimePool,
          OTHER_ACTOR_ID,
          (client) => finishLiveWorkout(
            client,
            ROOT_WORKOUT_ID,
            2,
            LIVE_OPERATION_IDS.finish,
          ),
        )).resolves.toEqual({ version: 3, replayed: true })

        const completed = await withActorTransaction(
          runtimePool,
          OTHER_ACTOR_ID,
          readAccessibleTrainingData,
        )
        expect(completed.workouts.find(
          (workout) => workout.id === ROOT_WORKOUT_ID,
        )).toMatchObject({
          status: 'done',
          version: 3,
          exercises: [{
            sets: [{
              fact: { durationSec: 1650, distanceKm: 5.25, rpe: 7.5 },
              version: 3,
            }],
          }],
        })

        const operationRows = await ownerPool.query<LiveOperationAuditRow>(
          `
            select
              count(*)::integer as count,
              bool_and(request_sha256 ~ '^[0-9a-f]{64}$') as hashes_valid
            from app_private.live_workout_operations
            where actor_id = $1 and result_version is not null
          `,
          [OTHER_ACTOR_ID],
        )
        expect(operationRows.rows).toEqual([{ count: 4, hashes_valid: true }])

        await expect(withActorTransaction(
          runtimePool,
          OTHER_ACTOR_ID,
          (client) => client.query(
            'select operation_id from app_private.live_workout_operations',
          ),
        )).rejects.toMatchObject({ code: '42501' })
      } finally {
        await ownerPool.query(
          `
            delete from app_private.live_workout_operations
            where actor_id in ($1, $2)
              and operation_id = any($3::uuid[])
          `,
          [OTHER_ACTOR_ID, OUTSIDE_TRAINER_ID, Object.values(LIVE_OPERATION_IDS)],
        )
        await ownerPool.query(
          `
            update public.workouts
            set
              status = 'planned',
              started_at = null,
              completed_at = null,
              updated_by = null,
              version = 1
            where id in ($1, $2)
          `,
          [ROOT_WORKOUT_ID, MEMBER_WORKOUT_ID],
        )
        await ownerPool.query(
          `
            update public.workout_sets
            set
              fact_weight_kg = null,
              fact_reps = null,
              fact_duration_min = null,
              fact_duration_sec = null,
              fact_distance_km = null,
              fact_rpe = null,
              confirmed_at = null,
              updated_by = null,
              version = 1
            where id = $1
          `,
          [ROOT_WORKOUT_SET_ID],
        )
      }
    })

    it('applies idempotent live structural edits through the workout root', async () => {
      if (ownerPool === undefined || runtimePool === undefined) {
        throw new Error('Database pools are not ready')
      }

      const operationIds = Object.values(LIVE_STRUCTURE_OPERATION_IDS)
      await ownerPool.query(
        `
          delete from app_private.live_workout_operations
          where actor_id = any($1::uuid[])
            and operation_id = any($2::uuid[])
        `,
        [[ACTOR_ID, OTHER_ACTOR_ID, OUTSIDE_TRAINER_ID], operationIds],
      )
      await ownerPool.query(
        `
          delete from public.workout_exercises
          where workout_id = $1 and id <> $2
        `,
        [ROOT_WORKOUT_ID, ROOT_WORKOUT_EXERCISE_ID],
      )
      await ownerPool.query(
        `
          update public.workout_exercises
          set
            position = 0,
            exercise_source = 'system',
            exercise_ref = 'running',
            custom_exercise_id = null,
            exercise_name = 'Бег',
            muscle_group = 'cardio',
            input_kind = 'distance',
            trainer_comment = null,
            updated_by = null
          where id = $1
        `,
        [ROOT_WORKOUT_EXERCISE_ID],
      )
      await ownerPool.query(
        `
          delete from public.workout_sets
          where workout_exercise_id = $1 and id <> $2
        `,
        [ROOT_WORKOUT_EXERCISE_ID, ROOT_WORKOUT_SET_ID],
      )
      await ownerPool.query(
        `
          update public.workout_sets
          set
            position = 0,
            plan_weight_kg = null,
            plan_reps = null,
            plan_duration_min = null,
            plan_duration_sec = 1800,
            plan_distance_km = 5,
            plan_rpe = 7,
            fact_weight_kg = null,
            fact_reps = null,
            fact_duration_min = null,
            fact_duration_sec = null,
            fact_distance_km = null,
            fact_rpe = null,
            confirmed_at = null,
            updated_by = null,
            version = 1
          where id = $1
        `,
        [ROOT_WORKOUT_SET_ID],
      )
      await ownerPool.query(
        `
          update public.workouts
          set
            status = 'planned',
            started_at = null,
            completed_at = null,
            updated_by = null,
            version = 1
          where id = $1
        `,
        [ROOT_WORKOUT_ID],
      )

      let appendedExerciseId: string | undefined
      try {
        await expect(withActorTransaction(
          runtimePool,
          OTHER_ACTOR_ID,
          (client) => startLiveWorkout(
            client,
            ROOT_WORKOUT_ID,
            1,
            LIVE_STRUCTURE_OPERATION_IDS.start,
          ),
        )).resolves.toEqual({ version: 2, replayed: false })

        const exercise = {
          source: 'system' as const,
          ref: 'push-up',
          customExerciseId: null,
          name: 'Отжимания',
          muscleGroup: 'chest' as const,
          inputKind: 'reps' as const,
        }
        const appendedExercise = await withActorTransaction(
          runtimePool,
          OTHER_ACTOR_ID,
          (client) => appendLiveExercise(
            client,
            ROOT_WORKOUT_ID,
            exercise,
            2,
            LIVE_STRUCTURE_OPERATION_IDS.appendExercise,
          ),
        )
        appendedExerciseId = appendedExercise.resourceId
        expect(appendedExercise).toMatchObject({ version: 3, replayed: false })
        await expect(withActorTransaction(
          runtimePool,
          OTHER_ACTOR_ID,
          (client) => appendLiveExercise(
            client,
            ROOT_WORKOUT_ID,
            exercise,
            2,
            LIVE_STRUCTURE_OPERATION_IDS.appendExercise,
          ),
        )).resolves.toEqual({ ...appendedExercise, replayed: true })

        const appendedSet = await withActorTransaction(
          runtimePool,
          OTHER_ACTOR_ID,
          (client) => appendLiveSet(
            client,
            ROOT_WORKOUT_EXERCISE_ID,
            3,
            LIVE_STRUCTURE_OPERATION_IDS.appendSet,
          ),
        )
        expect(appendedSet).toMatchObject({ version: 4, replayed: false })
        await expect(withActorTransaction(
          runtimePool,
          OTHER_ACTOR_ID,
          (client) => removeLiveSet(
            client,
            appendedSet.resourceId,
            4,
            LIVE_STRUCTURE_OPERATION_IDS.removeSet,
          ),
        )).resolves.toEqual({
          resourceId: appendedSet.resourceId,
          version: 5,
          replayed: false,
        })
        await expect(withActorTransaction(
          runtimePool,
          OTHER_ACTOR_ID,
          (client) => removeLiveSet(
            client,
            appendedSet.resourceId,
            4,
            LIVE_STRUCTURE_OPERATION_IDS.removeSet,
          ),
        )).resolves.toEqual({
          resourceId: appendedSet.resourceId,
          version: 5,
          replayed: true,
        })

        const replacement = {
          source: 'system' as const,
          ref: 'deadlift',
          customExerciseId: null,
          name: 'Становая тяга',
          muscleGroup: 'back' as const,
          inputKind: 'strength' as const,
        }
        await expect(withActorTransaction(
          runtimePool,
          OTHER_ACTOR_ID,
          (client) => replaceLiveExercise(
            client,
            ROOT_WORKOUT_ID,
            ROOT_WORKOUT_EXERCISE_ID,
            replacement,
            5,
            LIVE_STRUCTURE_OPERATION_IDS.replace,
          ),
        )).resolves.toEqual({
          resourceId: ROOT_WORKOUT_EXERCISE_ID,
          version: 6,
          replayed: false,
        })
        await expect(withActorTransaction(
          runtimePool,
          OTHER_ACTOR_ID,
          (client) => setLiveExerciseComment(
            client,
            ROOT_WORKOUT_EXERCISE_ID,
            'Клиент не меняет комментарий тренера',
            6,
            LIVE_STRUCTURE_OPERATION_IDS.clientComment,
          ),
        )).rejects.toMatchObject({ failure: 'forbidden' })
        await expect(withActorTransaction(
          runtimePool,
          ACTOR_ID,
          (client) => setLiveExerciseComment(
            client,
            ROOT_WORKOUT_EXERCISE_ID,
            'Держи спину прямо',
            6,
            LIVE_STRUCTURE_OPERATION_IDS.comment,
          ),
        )).resolves.toEqual({
          resourceId: ROOT_WORKOUT_EXERCISE_ID,
          version: 7,
          replayed: false,
        })

        const appendedBlockRows = await ownerPool.query<{ block_id: string }>(
          'select block_id from public.workout_exercises where id = $1',
          [appendedExerciseId],
        )
        const appendedBlockId = appendedBlockRows.rows[0]?.block_id
        if (appendedBlockId === undefined) {
          throw new Error('Appended Live exercise block was not created')
        }
        await expect(withActorTransaction(
          runtimePool,
          OTHER_ACTOR_ID,
          (client) => reorderLiveBlock(
            client,
            ROOT_WORKOUT_ID,
            appendedBlockId,
            -1,
            7,
            LIVE_STRUCTURE_OPERATION_IDS.reorder,
          ),
        )).resolves.toEqual({
          resourceId: appendedBlockId,
          version: 8,
          replayed: false,
        })
        await expect(withActorTransaction(
          runtimePool,
          OTHER_ACTOR_ID,
          (client) => reorderLiveBlock(
            client,
            ROOT_WORKOUT_ID,
            appendedBlockId,
            -1,
            7,
            LIVE_STRUCTURE_OPERATION_IDS.reorder,
          ),
        )).resolves.toEqual({
          resourceId: appendedBlockId,
          version: 8,
          replayed: true,
        })

        await expect(withActorTransaction(
          runtimePool,
          ACTOR_ID,
          (client) => setLiveExerciseComment(
            client,
            ROOT_WORKOUT_EXERCISE_ID,
            'Устаревшая правка',
            7,
            LIVE_STRUCTURE_OPERATION_IDS.staleComment,
          ),
        )).rejects.toMatchObject({ failure: 'conflict' })
        await ownerPool.query(
          `
            update public.workout_sets
            set confirmed_at = now()
            where id = $1
          `,
          [ROOT_WORKOUT_SET_ID],
        )
        await expect(withActorTransaction(
          runtimePool,
          OTHER_ACTOR_ID,
          (client) => replaceLiveExercise(
            client,
            ROOT_WORKOUT_ID,
            ROOT_WORKOUT_EXERCISE_ID,
            replacement,
            8,
            LIVE_STRUCTURE_OPERATION_IDS.replaceStarted,
          ),
        )).rejects.toMatchObject({ failure: 'conflict' })
        await ownerPool.query(
          `
            update public.workout_sets
            set confirmed_at = null
            where id = $1
          `,
          [ROOT_WORKOUT_SET_ID],
        )
        await expect(withActorTransaction(
          runtimePool,
          OUTSIDE_TRAINER_ID,
          (client) => appendLiveSet(
            client,
            ROOT_WORKOUT_EXERCISE_ID,
            8,
            LIVE_STRUCTURE_OPERATION_IDS.outside,
          ),
        )).rejects.toMatchObject({ failure: 'forbidden' })
        const appendedSetRows = await ownerPool.query<{ id: string }>(
          `
            select id
            from public.workout_sets
            where workout_exercise_id = $1
          `,
          [appendedExerciseId],
        )
        const onlyAppendedSetId = appendedSetRows.rows[0]?.id
        if (onlyAppendedSetId === undefined) {
          throw new Error('Appended Live exercise set was not created')
        }
        await expect(withActorTransaction(
          runtimePool,
          OTHER_ACTOR_ID,
          (client) => removeLiveSet(
            client,
            onlyAppendedSetId,
            8,
            LIVE_STRUCTURE_OPERATION_IDS.lastSet,
          ),
        )).rejects.toMatchObject({ failure: 'invalid' })

        const structureRows = await ownerPool.query<LiveStructureAuditRow>(
          `
            select
              exercise_name, input_kind, position, trainer_comment, updated_by
            from public.workout_exercises
            where workout_id = $1
            order by position
          `,
          [ROOT_WORKOUT_ID],
        )
        expect(structureRows.rows).toEqual([
          {
            exercise_name: 'Отжимания',
            input_kind: 'reps',
            position: 0,
            trainer_comment: null,
            updated_by: OTHER_ACTOR_ID,
          },
          {
            exercise_name: 'Становая тяга',
            input_kind: 'strength',
            position: 1,
            trainer_comment: 'Держи спину прямо',
            updated_by: OTHER_ACTOR_ID,
          },
        ])
        const rootSetRows = await ownerPool.query<LiveSetAuditRow>(
          `
            select
              confirmed_at, fact_distance_km, fact_duration_sec, fact_rpe,
              updated_by, version
            from public.workout_sets
            where workout_exercise_id = $1
          `,
          [ROOT_WORKOUT_EXERCISE_ID],
        )
        expect(rootSetRows.rows).toEqual([{
          confirmed_at: null,
          fact_distance_km: null,
          fact_duration_sec: null,
          fact_rpe: null,
          updated_by: OTHER_ACTOR_ID,
          version: '1',
        }])

        const receiptRows = await ownerPool.query<LiveStructureReceiptRow>(
          `
            select
              count(*)::integer as count,
              bool_and(result_resource_id is not null) as resource_ids_present
            from app_private.live_workout_operations
            where actor_id = any($1::uuid[])
              and operation_id = any($2::uuid[])
              and result_version is not null
              and action <> 'start'
          `,
          [[ACTOR_ID, OTHER_ACTOR_ID], operationIds],
        )
        expect(receiptRows.rows).toEqual([{
          count: 6,
          resource_ids_present: true,
        }])
      } finally {
        await ownerPool.query(
          `
            delete from app_private.live_workout_operations
            where actor_id = any($1::uuid[])
              and operation_id = any($2::uuid[])
          `,
          [[ACTOR_ID, OTHER_ACTOR_ID, OUTSIDE_TRAINER_ID], operationIds],
        )
        await ownerPool.query(
          `
            delete from public.workout_exercises
            where workout_id = $1 and id <> $2
          `,
          [ROOT_WORKOUT_ID, ROOT_WORKOUT_EXERCISE_ID],
        )
        await ownerPool.query(
          `
            update public.workout_exercises
            set
              position = 0,
              exercise_source = 'system',
              exercise_ref = 'running',
              custom_exercise_id = null,
              exercise_name = 'Бег',
              muscle_group = 'cardio',
              input_kind = 'distance',
              trainer_comment = null,
              updated_by = null
            where id = $1
          `,
          [ROOT_WORKOUT_EXERCISE_ID],
        )
        await ownerPool.query(
          `
            delete from public.workout_sets
            where workout_exercise_id = $1 and id <> $2
          `,
          [ROOT_WORKOUT_EXERCISE_ID, ROOT_WORKOUT_SET_ID],
        )
        await ownerPool.query(
          `
            update public.workout_sets
            set
              position = 0,
              plan_weight_kg = null,
              plan_reps = null,
              plan_duration_min = null,
              plan_duration_sec = 1800,
              plan_distance_km = 5,
              plan_rpe = 7,
              fact_weight_kg = null,
              fact_reps = null,
              fact_duration_min = null,
              fact_duration_sec = null,
              fact_distance_km = null,
              fact_rpe = null,
              confirmed_at = null,
              updated_by = null,
              version = 1
            where id = $1
          `,
          [ROOT_WORKOUT_SET_ID],
        )
        await ownerPool.query(
          `
            update public.workouts
            set
              status = 'planned',
              started_at = null,
              completed_at = null,
              updated_by = null,
              version = 1
            where id = $1
          `,
          [ROOT_WORKOUT_ID],
        )
      }
    })

    it('attributes a self-managed client write and strips trainer-only comments', async () => {
      if (ownerPool === undefined || runtimePool === undefined) {
        throw new Error('Database pools are not ready')
      }

      const created = await withActorTransaction(
        runtimePool,
        OTHER_ACTOR_ID,
        (client) => savePlannedWorkout(client, {
          id: null,
          clientId: CLIENT_ID,
          workoutDate: '2026-08-26',
          startTime: null,
          endTime: null,
          notes: 'Самостоятельная тренировка',
          exercises: [{
            position: 0,
            source: 'system',
            ref: 'running',
            customExerciseId: null,
            name: 'Бег',
            muscleGroup: 'cardio',
            inputKind: 'distance',
            blockId: 'bd3c6eec-6ed9-4dec-8348-48c43c6acb48',
            blockType: 'single',
            blockPreset: 'set',
            blockRounds: 1,
            restBetweenExercisesSec: 0,
            restBetweenRoundsSec: 90,
            restBetweenSetsSec: 60,
            trainerComment: 'Клиент не может назначить комментарий тренера',
            sets: [],
          }],
        }, null),
      )

      const workoutRows = await ownerPool.query<WorkoutAuditRow & {
        trainer_id: string
      }>(
        `
          select created_by, deleted_at, notes, trainer_id, updated_by, version
          from public.workouts
          where id = $1
        `,
        [created.id],
      )
      expect(workoutRows.rows).toEqual([{
        created_by: OTHER_ACTOR_ID,
        deleted_at: null,
        notes: 'Самостоятельная тренировка',
        trainer_id: ACTOR_ID,
        updated_by: OTHER_ACTOR_ID,
        version: '1',
      }])
      const comments = await ownerPool.query<QueryResultRow & {
        trainer_comment: string | null
      }>(
        'select trainer_comment from public.workout_exercises where workout_id = $1',
        [created.id],
      )
      expect(comments.rows).toEqual([{ trainer_comment: null }])
      await ownerPool.query('delete from public.workouts where id = $1', [created.id])
    })

    it('stores app feedback under the transaction actor and keeps runtime reads closed', async () => {
      if (ownerPool === undefined || runtimePool === undefined) {
        throw new Error('Database pools are not ready')
      }

      const draft = {
        kind: 'problem' as const,
        message: 'Не открывается завершённая тренировка',
        screenPath: '/workouts/test',
        appVersion: '0.1.0',
        displayMode: 'browser' as const,
        userAgent: 'Fit integration test',
      }
      const createdIds: string[] = []

      try {
        const actorFeedbackId = await withActorTransaction(
          runtimePool,
          ACTOR_ID,
          (client) => submitAppFeedback(client, draft),
        )
        createdIds.push(actorFeedbackId)
        const otherFeedbackId = await withActorTransaction(
          runtimePool,
          OTHER_ACTOR_ID,
          (client) => submitAppFeedback(client, {
            ...draft,
            kind: 'suggestion',
            message: 'Добавьте быстрый повтор тренировки',
          }),
        )
        createdIds.push(otherFeedbackId)

        const stored = await ownerPool.query<AppFeedbackAuditRow>(
          `select user_id, account_role, kind, message, screen_path,
                  app_version, display_mode, user_agent
           from public.app_feedback
           where id = $1`,
          [actorFeedbackId],
        )
        expect(stored.rows).toEqual([{
          user_id: ACTOR_ID,
          account_role: 'trainer',
          kind: 'problem',
          message: draft.message,
          screen_path: draft.screenPath,
          app_version: draft.appVersion,
          display_mode: draft.displayMode,
          user_agent: draft.userAgent,
        }])

        await expect(withActorTransaction(
          runtimePool,
          OTHER_ACTOR_ID,
          (client) => client.query(
            'select id from public.app_feedback where id = $1',
            [actorFeedbackId],
          ),
        )).rejects.toMatchObject({ code: '42501' })
        await expect(withActorTransaction(
          runtimePool,
          ACTOR_ID,
          (client) => client.query(
            `select public.submit_app_feedback(
              'other', 'Некорректный тип', '/', '0.1.0', 'browser', 'test'
            )`,
          ),
        )).rejects.toMatchObject({ message: 'app_feedback_invalid', code: 'PT422' })

        const authors = await ownerPool.query<{ id: string; user_id: string } & QueryResultRow>(
          'select id, user_id from public.app_feedback where id = any($1::uuid[])',
          [createdIds],
        )
        expect(authors.rows).toEqual(expect.arrayContaining([
          { id: actorFeedbackId, user_id: ACTOR_ID },
          { id: otherFeedbackId, user_id: OTHER_ACTOR_ID },
        ]))
      } finally {
        await ownerPool.query(
          'delete from public.app_feedback where id = any($1::uuid[])',
          [createdIds],
        )
      }
    })

    it('stores actor-scoped push state while keeping secrets and the outbox private', async () => {
      if (ownerPool === undefined || runtimePool === undefined) {
        throw new Error('Database pools are not ready')
      }

      try {
        await ownerPool.query(
          'delete from public.notification_preferences where user_id = any($1::uuid[])',
          [[ACTOR_ID, OTHER_ACTOR_ID]],
        )
        await ownerPool.query(
          'delete from public.push_subscriptions where user_id = any($1::uuid[])',
          [[ACTOR_ID, OTHER_ACTOR_ID]],
        )

        const initial = await withActorTransaction(
          runtimePool,
          ACTOR_ID,
          readPushNotificationStatus,
        )
        expect(initial).toEqual({
          subscribed: false,
          preferences: {
            workout_reminder: true,
            workout_scheduled: true,
          },
        })

        await withActorTransaction(runtimePool, ACTOR_ID, (client) =>
          upsertPushSubscription(client, {
            endpoint: 'https://push.example/actor',
            p256dh: 'actor-public-key',
            authKey: 'actor-auth-secret',
          }))
        expect((await ownerPool.query(
          `select enabled from public.notification_preferences
           where user_id = $1 and kind = 'workout_reminder'`,
          [ACTOR_ID],
        )).rows).toEqual([{ enabled: true }])
        await withActorTransaction(runtimePool, ACTOR_ID, (client) =>
          setNotificationPreference(client, 'workout_reminder', false))

        const actorStatus = await withActorTransaction(
          runtimePool,
          ACTOR_ID,
          readPushNotificationStatus,
        )
        expect(actorStatus).toEqual({
          subscribed: true,
          preferences: {
            workout_reminder: false,
            workout_scheduled: true,
          },
        })
        const otherStatus = await withActorTransaction(
          runtimePool,
          OTHER_ACTOR_ID,
          readPushNotificationStatus,
        )
        expect(otherStatus).toEqual({
          subscribed: false,
          preferences: {
            workout_reminder: true,
            workout_scheduled: true,
          },
        })

        const stored = await ownerPool.query<PushSubscriptionAuditRow>(
          'select user_id, endpoint, p256dh, auth_key from public.push_subscriptions',
        )
        expect(stored.rows).toEqual([{
          user_id: ACTOR_ID,
          endpoint: 'https://push.example/actor',
          p256dh: 'actor-public-key',
          auth_key: 'actor-auth-secret',
        }])

        await expect(withActorTransaction(
          runtimePool,
          ACTOR_ID,
          (client) => client.query('select endpoint from public.push_subscriptions'),
        )).rejects.toMatchObject({ code: '42501' })
        await expect(withActorTransaction(
          runtimePool,
          ACTOR_ID,
          (client) => client.query('select id from app_private.push_notifications_outbox'),
        )).rejects.toMatchObject({ code: '42501' })
        await expect(withActorTransaction(
          runtimePool,
          ACTOR_ID,
          (client) => client.query(
            "select public.upsert_push_subscription('http://invalid', 'key', 'secret')",
          ),
        )).rejects.toMatchObject({
          message: 'push_notifications_invalid',
          code: 'PT422',
        })

        expect((await ownerPool.query(
          `select id from app_private.push_notifications_outbox
           where user_id = any($1::uuid[])`,
          [[ACTOR_ID, OTHER_ACTOR_ID]],
        )).rows).toEqual([])

        await withActorTransaction(
          runtimePool,
          ACTOR_ID,
          deletePushSubscription,
        )
        await withActorTransaction(
          runtimePool,
          ACTOR_ID,
          deletePushSubscription,
        )
        expect((await ownerPool.query(
          'select user_id from public.push_subscriptions where user_id = $1',
          [ACTOR_ID],
        )).rows).toEqual([])
        expect((await ownerPool.query(
          `select enabled from public.notification_preferences
           where user_id = $1 and kind = 'workout_reminder'`,
          [ACTOR_ID],
        )).rows).toEqual([{ enabled: false }])
      } finally {
        await ownerPool.query(
          'delete from public.notification_preferences where user_id = any($1::uuid[])',
          [[ACTOR_ID, OTHER_ACTOR_ID]],
        )
        await ownerPool.query(
          'delete from public.push_subscriptions where user_id = any($1::uuid[])',
          [[ACTOR_ID, OTHER_ACTOR_ID]],
        )
      }
    })

    it('produces, leases and finalizes Yandex push notifications without direct table grants', async () => {
      if (ownerPool === undefined || runtimePool === undefined) {
        throw new Error('Database pools are not ready')
      }

      const workoutIds: string[] = []
      const timezoneRows = await ownerPool.query<{ timezone: string } & QueryResultRow>(
        'select timezone from public.profiles where id = $1',
        [OTHER_ACTOR_ID],
      )
      const originalTimezone = timezoneRows.rows[0]?.timezone
      if (originalTimezone === undefined) throw new Error('Client timezone is missing')
      const actorRows = await ownerPool.query<{ full_name: string } & QueryResultRow>(
        `select btrim(coalesce(first_name, '') || ' ' || coalesce(last_name, ''))
           as full_name
         from public.profiles
         where id = $1`,
        [ACTOR_ID],
      )
      const actorName = actorRows.rows[0]?.full_name
      if (actorName === undefined || actorName === '') {
        throw new Error('Trainer name is missing')
      }

      try {
        await ownerPool.query(
          'delete from app_private.push_notifications_outbox where user_id = $1',
          [OTHER_ACTOR_ID],
        )
        await ownerPool.query(
          'delete from public.notification_preferences where user_id = $1',
          [OTHER_ACTOR_ID],
        )
        await ownerPool.query(
          'delete from public.push_subscriptions where user_id = $1',
          [OTHER_ACTOR_ID],
        )
        await ownerPool.query(
          "update public.profiles set timezone = 'UTC' where id = $1",
          [OTHER_ACTOR_ID],
        )

        await withActorTransaction(runtimePool, OTHER_ACTOR_ID, (client) =>
          upsertPushSubscription(client, {
            endpoint: 'https://push.example/yandex-pipeline',
            p256dh: 'pipeline-public-key',
            authKey: 'pipeline-auth-key',
          }))

        const trainerWorkout = await withActorTransaction(
          runtimePool,
          ACTOR_ID,
          (client) => savePlannedWorkout(client, {
            id: null,
            clientId: CLIENT_ID,
            workoutDate: '2099-01-01',
            startTime: '18:30',
            endTime: null,
            notes: 'Yandex push pipeline trainer plan',
            exercises: [],
          }, null),
        )
        workoutIds.push(trainerWorkout.id)

        await ownerPool.query(
          `delete from app_private.push_notifications_outbox
           where kind = 'workout_scheduled'
             and data = jsonb_build_object('workout_id', $1::uuid)`,
          [trainerWorkout.id],
        )
        const outsideEnqueued = await withActorTransaction(
          runtimePool,
          OUTSIDE_TRAINER_ID,
          async (client) => {
            const rows = await client.query<{ enqueued: boolean } & QueryResultRow>(
              `select app_private.enqueue_workout_scheduled_notification($1)
                 as enqueued`,
              [trainerWorkout.id],
            )
            return rows[0]?.enqueued
          },
        )
        expect(outsideEnqueued).toBe(false)
        const ownerEnqueued = await withActorTransaction(
          runtimePool,
          ACTOR_ID,
          async (client) => {
            const rows = await client.query<{ enqueued: boolean } & QueryResultRow>(
              `select app_private.enqueue_workout_scheduled_notification($1)
                 as enqueued`,
              [trainerWorkout.id],
            )
            return rows[0]?.enqueued
          },
        )
        expect(ownerEnqueued).toBe(true)

        const clientWorkout = await withActorTransaction(
          runtimePool,
          OTHER_ACTOR_ID,
          (client) => savePlannedWorkout(client, {
            id: null,
            clientId: CLIENT_ID,
            workoutDate: '2099-01-02',
            startTime: null,
            endTime: null,
            notes: 'Yandex push pipeline self plan',
            exercises: [],
          }, null),
        )
        workoutIds.push(clientWorkout.id)

        const scheduled = await ownerPool.query<{
          body: string
          kind: string
          title: string
        } & QueryResultRow>(
          `select kind, title, body
           from app_private.push_notifications_outbox
           where user_id = $1`,
          [OTHER_ACTOR_ID],
        )
        expect(scheduled.rows).toHaveLength(1)
        expect(scheduled.rows[0]).toMatchObject({
          kind: 'workout_scheduled',
          title: 'Новая тренировка',
        })
        expect(scheduled.rows[0]?.body).toContain(actorName)

        await ownerPool.query(
          `insert into app_private.push_notifications_outbox (
             kind, user_id, title, body, data, attempts
           ) values (
             'retry_limit_test', $1, 'Retry limit', 'Retry limit', $2::jsonb, 9
           )`,
          [OTHER_ACTOR_ID, JSON.stringify({ test: 'retry-limit' })],
        )

        const dispatchTime = new Date('2099-01-01T09:02:00.000Z')
        await expect(withActorTransaction(
          runtimePool,
          ACTOR_ID,
          (client) => enqueueWorkoutReminders(client, dispatchTime),
        )).resolves.toBe(1)
        await expect(withActorTransaction(
          runtimePool,
          ACTOR_ID,
          (client) => enqueueWorkoutReminders(client, dispatchTime),
        )).resolves.toBe(0)

        const batch = await withActorTransaction(
          runtimePool,
          ACTOR_ID,
          (client) => claimPushNotifications(client, dispatchTime),
        )
        expect(batch?.notifications).toHaveLength(3)
        if (batch === null) throw new Error('Push batch was not claimed')
        const results = batch.notifications.map((notification) =>
          notification.title === 'Новая тренировка'
            ? { id: notification.id, ok: true as const }
            : notification.title === 'Retry limit'
              ? {
                  id: notification.id,
                  ok: false as const,
                  status: 503,
                  error: 'web_push_503',
                }
            : {
                id: notification.id,
                ok: false as const,
                status: 410,
                error: 'web_push_410',
              })
        await expect(withActorTransaction(
          runtimePool,
          ACTOR_ID,
          (client) => finalizePushNotifications(
            client,
            batch.dispatchToken,
            results.slice(0, 1),
            dispatchTime,
          ),
        )).rejects.toMatchObject({ code: 'PT422' })
        await expect(withActorTransaction(
          runtimePool,
          ACTOR_ID,
          (client) => finalizePushNotifications(
            client,
            batch.dispatchToken,
            results,
            dispatchTime,
          ),
        )).resolves.toEqual({ succeeded: 1, failed: 2, discarded: 2 })

        const finalized = await ownerPool.query<{
          attempts: number
          discarded: boolean
          kind: string
          sent: boolean
        } & QueryResultRow>(
          `select
             kind,
             sent_at is not null as sent,
             discarded_at is not null as discarded,
             attempts
           from app_private.push_notifications_outbox
           where user_id = $1
           order by kind`,
          [OTHER_ACTOR_ID],
        )
        expect(finalized.rows).toEqual([
          { kind: 'retry_limit_test', sent: false, discarded: true, attempts: 10 },
          { kind: 'workout_reminder', sent: false, discarded: true, attempts: 1 },
          { kind: 'workout_scheduled', sent: true, discarded: false, attempts: 0 },
        ])
        expect((await ownerPool.query(
          'select user_id from public.push_subscriptions where user_id = $1',
          [OTHER_ACTOR_ID],
        )).rows).toEqual([])
        await expect(withActorTransaction(
          runtimePool,
          ACTOR_ID,
          (client) => claimPushNotifications(
            client,
            new Date('2099-01-01T09:03:00.000Z'),
          ),
        )).resolves.toBeNull()
      } finally {
        await ownerPool.query(
          'delete from app_private.push_notifications_outbox where user_id = $1',
          [OTHER_ACTOR_ID],
        )
        await ownerPool.query(
          'delete from public.notification_preferences where user_id = $1',
          [OTHER_ACTOR_ID],
        )
        await ownerPool.query(
          'delete from public.push_subscriptions where user_id = $1',
          [OTHER_ACTOR_ID],
        )
        if (workoutIds.length > 0) {
          await ownerPool.query(
            'delete from public.workouts where id = any($1::uuid[])',
            [workoutIds],
          )
        }
        await ownerPool.query(
          'update public.profiles set timezone = $2 where id = $1',
          [OTHER_ACTOR_ID, originalTimezone],
        )
      }
    })

    it('enforces the client card, private preferences and custom exercise mutation contract', async () => {
      if (ownerPool === undefined || runtimePool === undefined) {
        throw new Error('Database pools are not ready')
      }

      const draft = {
        fullName: 'Контрактный клиент',
        gender: 'female' as const,
        ageYears: 32,
        ageUpdatedAt: '2026-08-24',
        heightCm: 169,
        goal: 'Подготовиться к соревнованию',
        note: 'Приватная заметка корневого тренера',
      }
      const exerciseDraft = {
        name: 'Контрактная тяга саней',
        muscleGroup: 'legs' as const,
        inputKind: 'strength' as const,
      }
      const created = await withActorTransaction(
        runtimePool,
        ACTOR_ID,
        (client) => createClientCard(client, draft),
      )
      let exerciseId: string | undefined

      try {
        expect(created).toMatchObject({ version: 1, membershipVersion: 1 })
        await ownerPool.query(
          `insert into public.client_trainers (client_id, trainer_id, alias)
           values ($1, $2, 'Подключённый псевдоним')`,
          [created.id, MEMBER_TRAINER_ID],
        )

        await expect(withActorTransaction(
          runtimePool,
          MEMBER_TRAINER_ID,
          (client) => updateClientCard(client, created.id, draft, 1),
        )).rejects.toMatchObject({ failure: 'forbidden' })

        const membershipVersion = await withActorTransaction(
          runtimePool,
          MEMBER_TRAINER_ID,
          (client) => updateClientPreferences(
            client,
            created.id,
            'Личный псевдоним',
            'Приватно для подключённого тренера',
            1,
          ),
        )
        expect(membershipVersion).toBe(2)

        const updatedVersion = await withActorTransaction(
          runtimePool,
          ACTOR_ID,
          (client) => updateClientCard(
            client,
            created.id,
            { ...draft, fullName: 'Обновлённый клиент' },
            1,
          ),
        )
        expect(updatedVersion).toBe(2)
        await expect(withActorTransaction(
          runtimePool,
          ACTOR_ID,
          (client) => updateClientCard(client, created.id, draft, 1),
        )).rejects.toMatchObject({ failure: 'conflict' })

        const archivedVersion = await withActorTransaction(
          runtimePool,
          ACTOR_ID,
          (client) => setClientArchived(client, created.id, true, 2),
        )
        expect(archivedVersion).toBe(3)
        const archivedClients = await withActorTransaction(
          runtimePool,
          ACTOR_ID,
          (client) => readAccessibleClients(client, true),
        )
        expect(archivedClients.clients).toEqual(expect.arrayContaining([
          expect.objectContaining({ id: created.id, version: 3 }),
        ]))
        const restoredVersion = await withActorTransaction(
          runtimePool,
          ACTOR_ID,
          (client) => setClientArchived(client, created.id, false, 3),
        )
        expect(restoredVersion).toBe(4)

        const preferences = await ownerPool.query<{
          alias: string | null
          note: string | null
          version: string
        }>(
          `select alias, note, version
           from public.client_trainers
           where client_id = $1 and trainer_id = $2`,
          [created.id, MEMBER_TRAINER_ID],
        )
        expect(preferences.rows).toEqual([{
          alias: 'Личный псевдоним',
          note: 'Приватно для подключённого тренера',
          version: '2',
        }])

        const exercise = await withActorTransaction(
          runtimePool,
          ACTOR_ID,
          (client) => createCustomExercise(client, exerciseDraft),
        )
        exerciseId = exercise.id
        expect(exercise).toMatchObject({ ...exerciseDraft, version: 1 })

        await expect(withActorTransaction(
          runtimePool,
          OUTSIDE_TRAINER_ID,
          (client) => updateCustomExercise(client, exercise.id, exerciseDraft, 1),
        )).rejects.toMatchObject({ failure: 'forbidden' })

        const updatedExercise = await withActorTransaction(
          runtimePool,
          ACTOR_ID,
          (client) => updateCustomExercise(
            client,
            exercise.id,
            { ...exerciseDraft, name: 'Обновлённая тяга саней' },
            1,
          ),
        )
        expect(updatedExercise).toMatchObject({
          name: 'Обновлённая тяга саней',
          version: 2,
        })
        await expect(withActorTransaction(
          runtimePool,
          ACTOR_ID,
          (client) => updateCustomExercise(client, exercise.id, exerciseDraft, 1),
        )).rejects.toMatchObject({ failure: 'conflict' })

        const archivedExercise = await withActorTransaction(
          runtimePool,
          ACTOR_ID,
          (client) => setCustomExerciseArchived(client, exercise.id, true, 2),
        )
        expect(archivedExercise.version).toBe(3)
        expect(archivedExercise.archivedAt).not.toBeNull()
        const restoredExercise = await withActorTransaction(
          runtimePool,
          ACTOR_ID,
          (client) => setCustomExerciseArchived(client, exercise.id, false, 3),
        )
        expect(restoredExercise.version).toBe(4)
        expect(restoredExercise.archivedAt).toBeNull()
      } finally {
        if (exerciseId !== undefined) {
          await ownerPool.query('delete from public.custom_exercises where id = $1', [exerciseId])
        }
        await ownerPool.query('delete from public.clients where id = $1', [created.id])
      }
    })

    it('lets a client create and maintain exactly one self-managed card', async () => {
      if (ownerPool === undefined || runtimePool === undefined) {
        throw new Error('Database pools are not ready')
      }
      await ownerPool.query(
        `insert into public.profiles (id, first_name, account_role)
         values ($1, 'Self managed domain actor', 'client')
         on conflict (id) do update set account_role = excluded.account_role`,
        [DOMAIN_CLIENT_ACTOR_ID],
      )
      let clientId: string | undefined
      try {
        const draft = {
          fullName: 'Самостоятельный клиент',
          gender: null,
          ageYears: null,
          ageUpdatedAt: null,
          heightCm: null,
          goal: null,
          note: null,
        }
        const created = await withActorTransaction(
          runtimePool,
          DOMAIN_CLIENT_ACTOR_ID,
          (client) => createClientCard(client, draft),
        )
        clientId = created.id
        await expect(withActorTransaction(
          runtimePool,
          DOMAIN_CLIENT_ACTOR_ID,
          (client) => createClientCard(client, draft),
        )).rejects.toMatchObject({ failure: 'conflict' })
        const version = await withActorTransaction(
          runtimePool,
          DOMAIN_CLIENT_ACTOR_ID,
          (client) => updateClientCard(
            client,
            created.id,
            { ...draft, goal: 'Тренироваться самостоятельно' },
            1,
          ),
        )
        expect(version).toBe(2)

        const goal = await withActorTransaction(
          runtimePool,
          DOMAIN_CLIENT_ACTOR_ID,
          async (client) => {
            const rows = await client.query<{
              goal_id: string
              version: string
            } & QueryResultRow>(
              'select goal_id, version from public.save_client_goal($1::jsonb, null)',
              [JSON.stringify({
                id: null,
                clientId: created.id,
                title: 'Самостоятельно сформулированная цель',
                targetDate: null,
              })],
            )
            return rows[0]
          },
        )
        expect(goal).toMatchObject({ version: '1' })
        const storedGoal = await ownerPool.query<{ created_by: string; trainer_id: string } & QueryResultRow>(
          'select created_by, trainer_id from public.client_goals where id = $1',
          [goal?.goal_id],
        )
        expect(storedGoal.rows[0]).toEqual({
          created_by: DOMAIN_CLIENT_ACTOR_ID,
          trainer_id: DOMAIN_CLIENT_ACTOR_ID,
        })
      } finally {
        if (clientId !== undefined) {
          await ownerPool.query('delete from public.clients where id = $1', [clientId])
        }
        await ownerPool.query('delete from public.profiles where id = $1', [DOMAIN_CLIENT_ACTOR_ID])
      }
    })

    it('keeps progress and goals author-scoped while sharing confirmed derived facts', async () => {
      if (ownerPool === undefined || runtimePool === undefined) {
        throw new Error('Database pools are not ready')
      }
      await ownerPool.query('delete from public.client_goals where client_id = $1', [CLIENT_ID])
      await ownerPool.query('delete from public.client_progress where client_id = $1', [CLIENT_ID])
      await ownerPool.query('delete from public.client_custom_metrics where client_id = $1', [CLIENT_ID])
      await ownerPool.query('delete from public.workout_sets where id = $1', [PROGRESS_WORKOUT_SET_ID])
      await ownerPool.query('delete from public.workout_exercises where id = $1', [PROGRESS_WORKOUT_EXERCISE_ID])
      await ownerPool.query(
        `insert into public.workout_exercises (
           id, workout_id, trainer_id, client_id, position, exercise_source,
           exercise_ref, exercise_name, muscle_group, input_kind
         ) values ($1, $2, $3, $4, 0, 'system', 'push-up', 'Отжимания', 'chest', 'reps')`,
        [PROGRESS_WORKOUT_EXERCISE_ID, CLIENT_WORKOUT_ID, ACTOR_ID, CLIENT_ID],
      )
      await ownerPool.query(
        `insert into public.workout_sets (
           id, workout_exercise_id, trainer_id, client_id, position,
           fact_reps, confirmed_at
         ) values ($1, $2, $3, $4, 0, 15, timestamptz '2026-08-19 12:10:00+00')`,
        [PROGRESS_WORKOUT_SET_ID, PROGRESS_WORKOUT_EXERCISE_ID, ACTOR_ID, CLIENT_ID],
      )

      const metric = await withActorTransaction(runtimePool, ACTOR_ID, async (client) => {
        const rows = await client.query<{ metric_id: string; version: string } & QueryResultRow>(
          `select metric_id, version from public.save_client_metric($1::jsonb, null)`,
          [JSON.stringify({ id: null, clientId: CLIENT_ID, name: 'Процент жира', unit: '%' })],
        )
        return rows[0]
      })
      expect(metric?.version).toBe('1')
      await expect(withActorTransaction(runtimePool, OTHER_ACTOR_ID, (client) =>
        client.query('select * from public.save_client_metric($1::jsonb, null)', [JSON.stringify({
          id: null, clientId: CLIENT_ID, name: 'Клиентская метрика', unit: null,
        })]))).rejects.toMatchObject({ message: 'metric_forbidden' })

      const progress = await withActorTransaction(runtimePool, ACTOR_ID, async (client) => {
        const rows = await client.query<{ progress_id: string; version: string } & QueryResultRow>(
          `select progress_id, version from public.save_client_progress($1::jsonb, null)`,
          [JSON.stringify({
            id: null, clientId: CLIENT_ID, recordedOn: '2026-08-20', weightKg: 70,
            chestCm: null, waistCm: 75, hipCm: null, notes: 'Первый замер',
            customMetrics: [{ metricId: metric?.metric_id, value: 20.5 }],
          })],
        )
        return rows[0]
      })
      expect(progress?.version).toBe('1')

      const goal = await withActorTransaction(runtimePool, ACTOR_ID, async (client) => {
        const rows = await client.query<{ goal_id: string; version: string } & QueryResultRow>(
          `select goal_id, version from public.save_client_goal($1::jsonb, null)`,
          [JSON.stringify({
            id: null, clientId: CLIENT_ID, title: 'Снизить вес на 3 кг', targetDate: '2026-12-31',
            criteria: [{
              id: null, version: null, metric: 'weight', operation: 'change_by',
              targetValue: -3, rangeMin: null, rangeMax: null, unit: 'кг',
              confirmationStatus: 'confirmed', position: 0,
            }, {
              id: null, version: null, metric: 'exercise_reps', operation: 'increase_to',
              targetValue: 20, rangeMin: null, rangeMax: null, unit: 'повт.',
              exerciseSource: 'system', exerciseRef: 'push-up', exerciseName: 'Отжимания',
              confirmationStatus: 'confirmed', position: 1,
            }, {
              id: null, version: null, metric: 'custom', operation: 'decrease_to',
              targetValue: 18, rangeMin: null, rangeMax: null, unit: '%',
              customMetricId: metric?.metric_id, customMetricName: 'Процент жира',
              confirmationStatus: 'confirmed', position: 2,
            }],
          })],
        )
        return rows[0]
      })
      await withActorTransaction(runtimePool, MEMBER_TRAINER_ID, (client) =>
        client.query(
          `select stage_id from public.save_goal_stage($1::jsonb, null)`,
          [JSON.stringify({ id: null, goalId: goal?.goal_id, title: 'Первые пять', startsOn: '2026-08-20', endsOn: '2026-10-01', position: 0 })],
        ))

      const shared = await withActorTransaction(runtimePool, MEMBER_TRAINER_ID, async (client) => {
        const rows = await client.query<JsonResultRow>(
          'select public.get_client_progress_bundle($1) result', [CLIENT_ID])
        return rows[0]?.result as {
          entries: unknown[]
          customMetrics: unknown[]
          goal: { criteria: Array<{
            metric: string; confirmationStatus: string
            baselineValue: number; baselineRecordedOn: string
          }> } | null
        }
      })
      expect(shared.entries).toHaveLength(1)
      expect(shared.customMetrics).toHaveLength(1)
      expect(shared.goal).not.toBeNull()
      expect(shared.goal?.criteria).toEqual([
        expect.objectContaining({
          metric: 'weight', confirmationStatus: 'confirmed',
          baselineValue: 70, baselineRecordedOn: '2026-08-20',
        }),
        expect.objectContaining({
          metric: 'exercise_reps', exerciseRef: 'push-up',
          exerciseName: 'Отжимания', confirmationStatus: 'confirmed',
        }),
        expect.objectContaining({
          metric: 'custom', customMetricId: metric?.metric_id,
          customMetricName: 'Процент жира', confirmationStatus: 'confirmed',
        }),
      ])

      const memberOverview = await withActorTransaction(
        runtimePool,
        MEMBER_TRAINER_ID,
        (client) => readAccessibleClients(client),
      )
      expect(memberOverview.clients.find((client) => client.id === CLIENT_ID)).toMatchObject({
        currentWeightKg: 70,
        activity: {
          doneCount: 1,
          completionPercent: 50,
          lastWorkoutDate: '2026-08-19',
          // На 14-й день без тренировки сигнал уже должен быть активен.
          needsAttention: true,
        },
      })

      const outsiderOverview = await withActorTransaction(
        runtimePool,
        OUTSIDE_TRAINER_ID,
        (client) => readAccessibleClients(client),
      )
      expect(outsiderOverview.clients.some((client) => client.id === CLIENT_ID)).toBe(false)

      await expect(withActorTransaction(runtimePool, ACTOR_ID, (client) =>
        client.query(
          `insert into public.client_progress (
             trainer_id, client_id, created_by, recorded_on
           ) values ($1, $2, $1, date '2026-08-21')`,
          [ACTOR_ID, CLIENT_ID],
        ))).rejects.toMatchObject({ code: '42501' })

      await expect(withActorTransaction(runtimePool, MEMBER_TRAINER_ID, (client) =>
        client.query('select * from public.save_client_progress($1::jsonb, $2)', [JSON.stringify({
          id: progress?.progress_id, clientId: CLIENT_ID, recordedOn: '2026-08-20',
          weightKg: 69, customMetrics: [],
        }), 1]))).rejects.toMatchObject({ message: 'progress_forbidden' })

      await expect(withActorTransaction(runtimePool, OUTSIDE_TRAINER_ID, (client) =>
        client.query('select public.get_client_progress_bundle($1)', [CLIENT_ID])))
        .rejects.toMatchObject({ message: 'progress_forbidden' })

      await expect(withActorTransaction(runtimePool, ACTOR_ID, (client) =>
        client.query('select * from public.save_client_progress($1::jsonb, null)', [JSON.stringify({
          id: null, clientId: CLIENT_ID, recordedOn: '2099-01-01',
          weightKg: 70, customMetrics: [],
        })]))).rejects.toMatchObject({ message: 'progress_invalid' })

      const exercisePage = await withActorTransaction(runtimePool, MEMBER_TRAINER_ID, async (client) => {
        const rows = await client.query<JsonResultRow>(
          `select public.list_exercise_progress($1, 'push-up', 20, null, null) result`, [CLIENT_ID])
        return rows[0]?.result as { items: unknown[]; totalCount: number }
      })
      expect(exercisePage.items).toHaveLength(1)
      expect(exercisePage.totalCount).toBe(1)

      const chronicle = await withActorTransaction(runtimePool, MEMBER_TRAINER_ID, async (client) => {
        const rows = await client.query<JsonResultRow>(
          'select public.list_workout_chronicle($1, 20, null, null) result', [CLIENT_ID])
        return rows[0]?.result as { items: unknown[]; totalCount: number }
      })
      expect(chronicle.items).toHaveLength(1)
      expect(chronicle.totalCount).toBe(1)

      const trainerSummary = {
        headline: 'Внутренний вывод только для тренеров',
        progress: ['Отжимания: 15 повторений'],
        consistency: 'Одна завершённая тренировка',
        attention: ['Проверить: доступна 1 тренировка'],
      }
      const clientSummary = {
        headline: 'Отжимания: подтверждено 15 повторений',
        achievements: ['Выполнено 15 повторений'],
        consistency: 'За период завершена 1 тренировка',
        encouragement: 'Первый результат уже зафиксирован.',
        goalAlignment: 'Это начальная точка для цели «Подтянуться 10 раз».',
        nextSteps: ['Собрать данные следующей тренировки'],
      }
      const saveSummary = (actorId: string, fingerprint: string) =>
        withActorTransaction(runtimePool!, actorId, (client) => client.query<JsonResultRow>(`
          select public.save_generated_training_summary(
            $1, date '2026-08-01', date '2026-08-26', $2,
            $3::jsonb, $4::jsonb, $5::jsonb, 'gpt://folder/yandexgpt/latest',
            'training-progress-v6', $6, $7::jsonb, $8::jsonb,
            timestamptz '2026-08-26 12:00:00+00'
          ) result
        `, [
          CLIENT_ID, trainerSummary.headline, JSON.stringify(trainerSummary),
          JSON.stringify(clientSummary), JSON.stringify({ completed_workouts: 1 }),
          fingerprint, JSON.stringify({ workouts: 1, exercises: 1, sets: 1 }),
          JSON.stringify({ inputTextTokens: '100' }),
        ]))

      await saveSummary(ACTOR_ID, 'a'.repeat(64))
      const memberInternal = await withActorTransaction(
        runtimePool,
        MEMBER_TRAINER_ID,
        (client) => client.query<QueryResultRow & { trainer_summary: unknown }>(
          'select trainer_summary from public.client_training_summaries where client_id = $1',
          [CLIENT_ID],
        ),
      )
      expect(memberInternal).toHaveLength(1)
      expect(memberInternal[0]?.trainer_summary).toEqual(trainerSummary)

      const sourceSummary = await ownerPool.query<QueryResultRow & {
        id: string
        version: number
      }>(
        `select id, version
         from public.client_training_summaries
         where trainer_id = $1 and client_id = $2
           and period_start = date '2026-08-01'
           and period_end = date '2026-08-26'`,
        [ACTOR_ID, CLIENT_ID],
      )
      const source = sourceSummary.rows[0]
      if (source === undefined) throw new Error('Training summary fixture is missing')
      const publishedClientSummary = {
        ...clientSummary,
        encouragement: 'Опубликовано через read-write Assistant contract.',
      }
      const publication = await withActorTransaction(
        runtimePool,
        ACTOR_ID,
        (client) => client.query<QueryResultRow & {
          published_id: string
          next_version: number
        }>(
          'select * from public.publish_training_summary($1, $2::jsonb, $3)',
          [source.id, JSON.stringify(publishedClientSummary), source.version],
        ),
      )
      expect(publication).toHaveLength(1)
      expect(publication[0]?.published_id).toMatch(/^[0-9a-f-]{36}$/)
      expect(Number(publication[0]?.next_version)).toBe(Number(source.version) + 1)
      await expect(withActorTransaction(
        runtimePool,
        ACTOR_ID,
        (client) => client.query(
          'select * from public.publish_training_summary($1, $2::jsonb, $3)',
          [source.id, JSON.stringify(clientSummary), source.version],
        ),
      )).rejects.toMatchObject({ code: 'PT409' })

      const publishedThroughAssistant = await withActorTransaction(
        runtimePool,
        OTHER_ACTOR_ID,
        (client) => client.query<QueryResultRow & { summary: unknown }>(
          'select summary from public.client_published_training_summaries where client_id = $1',
          [CLIENT_ID],
        ),
      )
      expect(publishedThroughAssistant[0]?.summary).toEqual(publishedClientSummary)

      const clientInternal = await withActorTransaction(
        runtimePool,
        OTHER_ACTOR_ID,
        (client) => client.query(
          'select trainer_summary from public.client_training_summaries where client_id = $1',
          [CLIENT_ID],
        ),
      )
      expect(clientInternal).toEqual([])

      await saveSummary(OTHER_ACTOR_ID, 'b'.repeat(64))
      const clientVisible = await withActorTransaction(
        runtimePool,
        OTHER_ACTOR_ID,
        (client) => client.query<QueryResultRow & { summary: unknown }>(
          'select summary from public.client_published_training_summaries where client_id = $1',
          [CLIENT_ID],
        ),
      )
      expect(clientVisible).toHaveLength(1)
      expect(clientVisible[0]?.summary).toEqual(clientSummary)
      expect(JSON.stringify(clientVisible)).not.toContain('Внутренний вывод')

      await expect(saveSummary(OUTSIDE_TRAINER_ID, 'c'.repeat(64)))
        .rejects.toMatchObject({ message: 'training_summary_forbidden' })
      const outsiderVisible = await withActorTransaction(
        runtimePool,
        OUTSIDE_TRAINER_ID,
        (client) => client.query(
          'select summary from public.client_published_training_summaries where client_id = $1',
          [CLIENT_ID],
        ),
      )
      expect(outsiderVisible).toEqual([])
      await expect(withActorTransaction(runtimePool, ACTOR_ID, (client) =>
        client.query(`insert into public.client_training_summaries (
          trainer_id, client_id, period_start, period_end, summary,
          trainer_summary, client_summary, model_uri, prompt_version, input_fingerprint
        ) values ($1, $2, current_date, current_date, 'x', '{}'::jsonb, '{}'::jsonb,
          'model', 'prompt', 'fingerprint')`, [ACTOR_ID, CLIENT_ID])))
        .rejects.toMatchObject({ code: '42501' })
    })

    it('keeps Assistant history and actions durable, idempotent and actor-scoped', async () => {
      if (ownerPool === undefined || runtimePool === undefined) {
        throw new Error('Database pools are not ready')
      }
      await ownerPool.query(
        'delete from public.assistant_conversations where owner_id = any($1::uuid[])',
        [[ACTOR_ID, MEMBER_TRAINER_ID]],
      )
      await ownerPool.query(
        `delete from public.clients where trainer_id = $1
          and full_name = 'Клиент из Assistant'`,
        [ACTOR_ID],
      )

      const conversation = await withActorTransaction(
        runtimePool,
        ACTOR_ID,
        (client) => createAssistantConversation(client, 'Проверка Assistant'),
      )
      await withActorTransaction(runtimePool, ACTOR_ID, (client) =>
        appendAssistantUserMessage(
          client,
          conversation.id,
          ASSISTANT_TURN_ID,
          'Добавь клиента',
        ))
      await withActorTransaction(runtimePool, ACTOR_ID, (client) =>
        appendAssistantUserMessage(
          client,
          conversation.id,
          ASSISTANT_TURN_ID,
          'Добавь клиента',
        ))
      await expect(withActorTransaction(runtimePool, ACTOR_ID, (client) =>
        appendAssistantUserMessage(
          client,
          conversation.id,
          ASSISTANT_TURN_ID,
          'Другой текст',
        ))).rejects.toMatchObject({ failure: 'conflict' })

      const responseAction = {
        id: ASSISTANT_ACTION_ID,
        tool: 'create_client_draft',
        status: 'proposed',
        title: 'Новый клиент',
        description: 'Проверьте имя',
        payload: { step: 'confirm' },
      }
      const persisted = await withActorTransaction(runtimePool, ACTOR_ID, (client) =>
        persistAssistantResponse(
          client,
          conversation.id,
          ASSISTANT_TURN_ID,
          'Готов черновик клиента',
          responseAction,
        ))
      const repeated = await withActorTransaction(runtimePool, ACTOR_ID, (client) =>
        persistAssistantResponse(
          client,
          conversation.id,
          ASSISTANT_TURN_ID,
          'Этот текст не заменит сохранённый',
          responseAction,
        ))
      expect(persisted.deduplicated).toBe(false)
      expect(repeated).toMatchObject({
        deduplicated: true,
        content: 'Готов черновик клиента',
      })

      const applied = await withActorTransaction(runtimePool, ACTOR_ID, (client) =>
        applyAssistantAction(
          client,
          ASSISTANT_ACTION_ID,
          { fullName: 'Клиент из Assistant' },
          1,
        ))
      const appliedAgain = await withActorTransaction(
        runtimePool,
        ACTOR_ID,
        (client) => applyAssistantAction(client, ASSISTANT_ACTION_ID, {}, 2),
      )
      expect(applied).toMatchObject({ status: 'applied', version: 2 })
      expect(appliedAgain).toMatchObject({ status: 'applied', version: 2 })
      const createdCount = await ownerPool.query<CountRow>(
        `select count(*)::integer count from public.clients
          where trainer_id = $1 and full_name = 'Клиент из Assistant'`,
        [ACTOR_ID],
      )
      expect(createdCount.rows[0]?.count).toBe(1)

      const ownState = await withActorTransaction(runtimePool, ACTOR_ID, async (client) => ({
        conversations: await listAssistantConversations(client),
        messages: await listAssistantMessages(client, conversation.id),
        actions: await listAssistantActions(client, conversation.id),
      }))
      expect(ownState.conversations).toHaveLength(1)
      expect(ownState.messages).toHaveLength(2)
      expect(ownState.actions).toMatchObject([{
        id: ASSISTANT_ACTION_ID,
        status: 'applied',
        version: 2,
      }])

      const foreignState = await withActorTransaction(
        runtimePool,
        MEMBER_TRAINER_ID,
        async (client) => ({
          conversations: await listAssistantConversations(client),
          messages: await listAssistantMessages(client, conversation.id),
          actions: await listAssistantActions(client, conversation.id),
        }),
      )
      expect(foreignState).toEqual({
        conversations: [],
        messages: [],
        actions: [],
      })
      await expect(withActorTransaction(runtimePool, MEMBER_TRAINER_ID, (client) =>
        persistAssistantResponse(
          client,
          conversation.id,
          ASSISTANT_TURN_ID,
          'Чужой ответ',
          null,
        ))).rejects.toMatchObject({ failure: 'not_found' })
      await expect(withActorTransaction(runtimePool, OTHER_ACTOR_ID, (client) =>
        createAssistantConversation(client, null)))
        .rejects.toMatchObject({ failure: 'forbidden' })
      await expect(withActorTransaction(runtimePool, ACTOR_ID, (client) =>
        client.query(
          `insert into public.assistant_conversations (owner_id)
            values ($1)`,
          [ACTOR_ID],
        ))).rejects.toMatchObject({ code: '42501' })
    })
  },
)
