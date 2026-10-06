import { randomBytes, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import { runner } from 'node-pg-migrate'
import { Pool, type QueryResultRow } from 'pg'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { hashPilotSessionToken } from '../auth/pilot-session-token.js'
import { submitAppFeedback } from '../app-feedback-command.js'
import {
  claimAppFeedbackDeliveries,
  finalizeAppFeedbackDeliveries,
} from '../app-feedback-dispatcher-command.js'
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
  hasPushSubscription,
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
  claimClientInvitationLink,
  createClientInvitation,
  createNewClientInvitationShare,
  leaveClientSpace,
  removeClientTrainer,
  revokeClientInvitation,
} from '../connection-commands.js'
import {
  createClientCard,
  createQuickOwnClientCard,
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
import { readClientWorkoutStats } from '../client-workout-stats.js'
import type { MediaObjectStorage } from '../object-storage-media.js'
import { DatabasePilotTrainerProfiles, type TrainerProfileDraft } from '../trainer-profile.js'
import type { YandexActorSession } from '../yandex-actor-session.js'
import {
  appendLiveExercise,
  appendLiveRound,
  appendLiveSet,
  answerWorkoutQuestion,
  askWorkoutQuestion,
  cancelPlannedWorkout,
  confirmLiveSet,
  finishLiveWorkout,
  mergeLiveBlockWithNext,
  recordPlannedWorkoutResult,
  removeLiveSet,
  removeLastLiveRound,
  splitLiveSuperset,
  removeLiveExercise,
  reorderLiveBlock,
  rescheduleWorkout,
  replaceLiveExercise,
  saveCompletedWorkout,
  savePlannedWorkout,
  saveLiveSetDraft,
  setWorkoutReview,
  snoozeClientAttention,
  submitWorkoutFeedback,
  setWorkoutActualDuration,
  resolveWorkoutQuestion,
  setClientWorkoutComment,
  setLiveExerciseComment,
  softDeletePlannedWorkout,
  softDeleteWorkout,
  startLiveWorkout,
  quickStartLiveWorkout,
  cancelEmptyLiveWorkout,
} from '../workout-commands.js'
import { withActorTransaction } from './actor-transaction.js'
import { PgDatabasePool } from './pg-pool.js'
import {
  DatabaseStageWorkoutFixtureLoader,
  STAGE_SMOKE_PROFILE_ID,
  STAGE_TRAINER_PROFILE_SMOKE_PROFILE_ID,
  stageWorkoutFixtureIds,
} from './stage-workout-fixture.js'
import {
  DatabaseStageDatabaseReaderAccessManager,
  StageDatabaseReaderNotReadyError,
} from './stage-database-reader-access.js'
import { DatabaseStageRolloutAssignmentManager } from './stage-rollout-assignment.js'
import { DatabaseFitLimeCalendarManager, FitLimeCalendarNotReadyError } from './fit-lime-calendar-fixtures.js'
import { FIT_LIME_CALENDAR_LOGINS } from './fit-lime-calendar-plan.js'
import type { DatabasePool } from './types.js'
import {
  DatabasePilotEnroller,
  PilotEnrollmentConflictError,
} from './yandex-pilot-enrollment.js'
import {
  DatabaseYandexAccountLinker,
  YandexAccountLinkError,
  type ExistingActor,
} from '../yandex-account-linking.js'
import {
  DatabaseYandexNativeRegistrar,
} from '../yandex-native-registration.js'
import { loadDatabaseProgramContext } from '../assistant-orchestrator/program/source.js'
import { DatabaseYandexAuthHandoffService } from '../yandex-auth-handoff.js'
import {
  CURRENT_PRIVACY_VERSION,
  CURRENT_TERMS_VERSION,
} from '../legal-document-versions.js'
import {
  acceptLegalDocuments,
  cancelAccountDeletionRequest,
  readAccountDeletionRequest,
  readLegalAcceptance,
  requestAccountDeletion,
} from '../legal.js'
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
const LINK_MERGE_CLIENT_ACTOR_ID = '1237c0bf-5dc5-46cd-ab26-951ddfb49949'
const LINK_CONFLICT_CLIENT_ACTOR_ID = '2237c0bf-5dc5-46cd-ab26-951ddfb49949'
const LINK_MERGE_CANONICAL_CLIENT_ID = '3237c0bf-5dc5-46cd-ab26-951ddfb49949'
const LINK_CONFLICT_CANONICAL_CLIENT_ID = '4237c0bf-5dc5-46cd-ab26-951ddfb49949'
const LINK_MERGE_WORKOUT_ID = '5237c0bf-5dc5-46cd-ab26-951ddfb49949'
const LINK_MERGE_OPERATION_ID = '6237c0bf-5dc5-46cd-ab26-951ddfb49949'
const LINK_CONFLICT_OPERATION_ID = '7237c0bf-5dc5-46cd-ab26-951ddfb49949'
const QUICK_OWN_RECOVERY_ACTOR_ID = '8237c0bf-5dc5-46cd-ab26-951ddfb49949'
const QUICK_OWN_RECOVERY_SOURCE_ID = '9237c0bf-5dc5-46cd-ab26-951ddfb49949'
const QUICK_OWN_RECOVERY_CANONICAL_ID = 'a237c0bf-5dc5-46cd-ab26-951ddfb49949'
const ROOT_CUSTOM_EXERCISE_ID = 'b27d65d0-6221-47cb-91a0-8dfcc0a2ceba'
const MEMBER_CUSTOM_EXERCISE_ID = '3127663e-4395-4100-8dd1-7b784d90917a'
const ROOT_WORKOUT_ID = '12acc6d6-7ca8-43cd-b124-b4224c917fae'
const QUICK_START_CLIENT_ID = '10a21ee8-718e-4f74-b4ed-d7bea41ac1a7'
const QUICK_START_ACTOR_ID = '20a21ee8-718e-4f74-b4ed-d7bea41ac1a7'
const QUICK_START_OPERATION_IDS = {
  trainer: '30a21ee8-718e-4f74-b4ed-d7bea41ac1a7',
  client: '40a21ee8-718e-4f74-b4ed-d7bea41ac1a7',
  second: '50a21ee8-718e-4f74-b4ed-d7bea41ac1a7',
  finish: '60a21ee8-718e-4f74-b4ed-d7bea41ac1a7',
  clientSecond: '70a21ee8-718e-4f74-b4ed-d7bea41ac1a7',
  trainerSecond: '80a21ee8-718e-4f74-b4ed-d7bea41ac1a7',
} as const
const MEMBER_WORKOUT_ID = 'd3cff30a-7aa2-4407-b62d-0683167cf4c8'
const CLIENT_WORKOUT_ID = '6e2d8d63-7c3a-4301-b9ba-76d875210f1f'
const POST_WORKOUT_ID = 'cd691fd5-86ee-4740-838c-b37166df7e71'
const ASSISTANT_TURN_ID = 'a16c6f9e-86ee-4740-838c-b37166df7e71'
const ASSISTANT_ACTION_ID = 'ea691fd5-86ee-4740-838c-b37166df7e71'
const CLIENT_ASSISTANT_TURN_ID = 'a26c6f9e-86ee-4740-838c-b37166df7e71'
const CLIENT_ASSISTANT_ACTION_ID = 'eb691fd5-86ee-4740-838c-b37166df7e71'
const CLIENT_ASSISTANT_FORBIDDEN_TURN_ID = 'a36c6f9e-86ee-4740-838c-b37166df7e71'
const CLIENT_ASSISTANT_FORBIDDEN_ACTION_ID = 'ec691fd5-86ee-4740-838c-b37166df7e71'
const CLIENT_ASSISTANT_WORKOUT_REQUEST_ID = 'ed691fd5-86ee-4740-838c-b37166df7e71'
const CLIENT_ASSISTANT_PROGRAM_TURN_ID = 'a46c6f9e-86ee-4740-838c-b37166df7e71'
const CLIENT_ASSISTANT_PROGRAM_ACTION_ID = 'ee691fd5-86ee-4740-838c-b37166df7e71'
const CLIENT_PROGRAM_JOB_ID = 'f1691fd5-86ee-4740-838c-b37166df7e71'
const CLIENT_PROGRAM_JOB_LEASE_ID = 'f2691fd5-86ee-4740-838c-b37166df7e71'
const CLIENT_PROGRAM_JOB_OTHER_LEASE_ID = 'f3691fd5-86ee-4740-838c-b37166df7e71'
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
const BOOTSTRAP_LINK_ACTOR_ID = 'f3f04352-32ac-4a8c-86d1-46cc8e8a6b13'
const BOOTSTRAP_LINK_SUBJECT_HASH = '8'.repeat(64)
const NATIVE_TRAINER_SUBJECT_HASH = '9'.repeat(64)
const NATIVE_CLIENT_SUBJECT_HASH = '0'.repeat(64)
const LINK_ACTOR: ExistingActor = {
  profile: {
    id: LINK_ACTOR_ID,
    firstName: 'Link actor',
    lastName: null,
    timezone: 'Europe/Moscow',
    accountRole: 'client',
    createdAt: '2026-08-01T10:00:00.000Z',
    updatedAt: '2026-08-02T10:00:00.000Z',
  },
}
const BOOTSTRAP_LINK_ACTOR: ExistingActor = {
  profile: {
    id: BOOTSTRAP_LINK_ACTOR_ID,
    firstName: 'Bootstrap actor',
    lastName: null,
    timezone: 'Europe/Moscow',
    accountRole: 'trainer',
    createdAt: '2026-09-01T10:00:00.000Z',
    updatedAt: '2026-09-02T10:00:00.000Z',
  },
  trainer: {
    profileId: BOOTSTRAP_LINK_ACTOR_ID,
    createdAt: '2026-09-01T10:00:00.000Z',
    updatedAt: '2026-09-01T10:00:00.000Z',
  },
}
const RUNTIME_PASSWORD = 'fit-api-test-only'
const READER_ROLE = 'fit_ops_reader_test'
const READER_PASSWORD = 'fit-ops-reader-test-only'
const DATALENS_ROLE = 'fit_datalens'
const DATALENS_PASSWORD = 'fit-datalens-test-only'
const migrationsDirectory = fileURLToPath(
  new URL('../../db/migrations', import.meta.url),
)

interface ActorRow extends QueryResultRow {
  actor_id: string | null
}

interface ProfileRow extends QueryResultRow {
  first_name: string | null
  schedule_density?: 'comfortable' | 'compact'
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

interface WorkoutExecutionAuditRow extends QueryResultRow {
  started_by: string | null
  completed_by: string | null
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

// Both real PostgreSQL transactions must observe the missing row before either
// can insert it. No sleeps or assumptions about the query scheduler are needed.
function synchronizeFirstProfileReads(pool: DatabasePool, participants: number): DatabasePool {
  let arrivals = 0
  let releaseBarrier = () => {}
  const barrier = new Promise<void>((resolve) => { releaseBarrier = resolve })
  return {
    connect: async () => {
      const connection = await pool.connect()
      return {
        query: async <Row extends QueryResultRow = QueryResultRow>(text: string, values?: readonly unknown[]) => {
          const rows = await connection.query<Row>(text, values)
          if (text.includes('from public.trainer_professional_profiles')
            && text.includes('for update') && arrivals < participants) {
            expect(rows).toHaveLength(0)
            arrivals += 1
            if (arrivals === participants) releaseBarrier()
            await barrier
          }
          return rows
        },
        release: () => connection.release(),
      }
    },
    end: () => pool.end(),
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
      await ownerPool.query(`
        do $$
        begin
          if not exists (select 1 from pg_roles where rolname = '${DATALENS_ROLE}') then
            create role ${DATALENS_ROLE} login password '${DATALENS_PASSWORD}';
          else
            alter role ${DATALENS_ROLE} login password '${DATALENS_PASSWORD}';
          end if;
        end
        $$;
        alter role ${DATALENS_ROLE} set default_transaction_read_only = on;
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

      // The local PostgreSQL volume survives repeated verification runs. A
      // developer may therefore create fit_datalens after migration 000036 was
      // already recorded; restore the same narrow grants that a clean CI/stage
      // run receives from that migration.
      await ownerPool.query(`
        grant usage on schema analytics to ${DATALENS_ROLE};
        grant select on all tables in schema analytics to ${DATALENS_ROLE};
      `)

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
      await ownerPool.query(
        'delete from public.trainers where profile_id = $1',
        [STAGE_TRAINER_PROFILE_SMOKE_PROFILE_ID],
      )
      await ownerPool.query(
        'delete from public.profiles where id = $1',
        [STAGE_TRAINER_PROFILE_SMOKE_PROFILE_ID],
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
        [[APP_ACTOR_ID, LINK_ACTOR_ID, BOOTSTRAP_LINK_ACTOR_ID]],
      )
      await ownerPool.query(
        `delete from public.trainers
         where profile_id in (
           select identity.profile_id
           from app_private.auth_identities identity
           where identity.provider = 'yandex'
             and identity.provider_subject_sha256 = any($1::text[])
         )`,
        [[NATIVE_TRAINER_SUBJECT_HASH, NATIVE_CLIENT_SUBJECT_HASH]],
      )
      await ownerPool.query(
        `delete from public.profiles
         where id in (
           select identity.profile_id
           from app_private.auth_identities identity
           where identity.provider = 'yandex'
             and identity.provider_subject_sha256 = any($1::text[])
         )`,
        [[NATIVE_TRAINER_SUBJECT_HASH, NATIVE_CLIENT_SUBJECT_HASH]],
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
          [
            APP_SUBJECT_HASH,
            LINK_SUBJECT_HASH,
            OTHER_LINK_SUBJECT_HASH,
            BOOTSTRAP_LINK_SUBJECT_HASH,
            NATIVE_TRAINER_SUBJECT_HASH,
            NATIVE_CLIENT_SUBJECT_HASH,
          ],
          [APP_ACTOR_ID, LINK_ACTOR_ID, BOOTSTRAP_LINK_ACTOR_ID],
        ],
      )
      await ownerPool.query(
        'delete from app_private.profile_rollout_assignments where profile_id = any($1::uuid[])',
        [[APP_ACTOR_ID, LINK_ACTOR_ID, BOOTSTRAP_LINK_ACTOR_ID]],
      )
      await ownerPool.query(
        'delete from public.trainers where profile_id = $1',
        [BOOTSTRAP_LINK_ACTOR_ID],
      )
      await ownerPool.query(
        'delete from public.profiles where id = any($1::uuid[])',
        [[APP_ACTOR_ID, LINK_ACTOR_ID, BOOTSTRAP_LINK_ACTOR_ID]],
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
            id, trainer_id, created_by, name, muscle_group, input_kind
          ) values
            ($1, $3, $3, 'Тяга саней', 'legs', 'strength'),
            ($2, $4, $4, 'Темповый бег', 'cardio', 'duration')
          on conflict (id) do update set
            trainer_id = excluded.trainer_id,
            created_by = excluded.created_by,
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

    describe('workout position index migration', () => {
      const migrationUrl = new URL('../../db/migrations/000125_drop_duplicate_workout_position_indexes.sql', import.meta.url)

      it('removes only redundant indexes and retains deferrable unique constraints', async () => {
        if (ownerPool === undefined) throw new Error('owner pool is not initialized')
        const result = await ownerPool.query(`
          select conname, condeferrable, condeferred, convalidated,
            index.indisunique, index.indisvalid, index.indisready
          from pg_constraint constraint_record
          join pg_index index on index.indexrelid = constraint_record.conindid
          where conname in ('workout_exercises_position_unique', 'workout_sets_position_unique')
            and connamespace = 'public'::regnamespace
          order by conname
        `)
        expect(result.rows).toEqual([
          { conname: 'workout_exercises_position_unique', condeferrable: true, condeferred: false,
            convalidated: true, indisunique: true, indisvalid: true, indisready: true },
          { conname: 'workout_sets_position_unique', condeferrable: true, condeferred: false,
            convalidated: true, indisunique: true, indisvalid: true, indisready: true },
        ])
        const indexes = await ownerPool.query(`
          select to_regclass('public.workout_exercises_workout_position_idx') exercises,
            to_regclass('public.workout_sets_exercise_position_idx') sets
        `)
        expect(indexes.rows).toEqual([{ exercises: null, sets: null }])
      })

      it('preserves ordered reads through unique indexes after a down and up roundtrip', async () => {
        if (ownerPool === undefined) throw new Error('owner pool is not initialized')
        const [up, down] = (await readFile(migrationUrl, 'utf8')).split('-- Down Migration')
        if (up === undefined || down === undefined) throw new Error('migration sections are missing')
        const connection = await ownerPool.connect()
        try {
          await connection.query('begin')
          await connection.query(down)
          const cases = [
            { sql: 'select id, position from public.workout_exercises where workout_id = any($1::uuid[]) order by workout_id, position, id',
              parentId: ROOT_WORKOUT_ID, index: 'workout_exercises_position_unique' },
            { sql: 'select id, position from public.workout_sets where workout_exercise_id = any($1::uuid[]) order by workout_exercise_id, position, id',
              parentId: ROOT_WORKOUT_EXERCISE_ID, index: 'workout_sets_position_unique' },
          ]
          const before: QueryResultRow[][] = []
          for (const testCase of cases) {
            before.push((await connection.query<QueryResultRow>(testCase.sql, [[testCase.parentId]])).rows)
          }
          await connection.query(up)
          // Tiny fixtures normally prefer a sequential scan. This proves the
          // ordered index path remains available, not a production cost claim.
          await connection.query('set local enable_seqscan = off; set local enable_bitmapscan = off')
          for (const [index, testCase] of cases.entries()) {
            expect((await connection.query(testCase.sql, [[testCase.parentId]])).rows).toEqual(before[index])
            const plan = await connection.query(`explain (format json) ${testCase.sql}`, [[testCase.parentId]])
            expect(JSON.stringify(plan.rows)).toContain(testCase.index)
          }
        } finally {
          await connection.query('rollback')
          connection.release()
        }
      })

      it('rejects catalog drift before dropping either index', async () => {
        if (ownerPool === undefined) throw new Error('owner pool is not initialized')
        const [up, down] = (await readFile(migrationUrl, 'utf8')).split('-- Down Migration')
        if (up === undefined || down === undefined) throw new Error('migration sections are missing')
        const connection = await ownerPool.connect()
        try {
          await connection.query('begin')
          await connection.query(down)
          await connection.query(`
            drop index public.workout_sets_exercise_position_idx;
            create index workout_sets_exercise_position_idx
              on public.workout_sets (workout_exercise_id, position desc)
          `)
          await connection.query('savepoint guarded_migration')
          await expect(connection.query(up)).rejects.toMatchObject({
            message: 'workout_position_index_catalog_mismatch: workout_sets_exercise_position_idx',
          })
          await connection.query('rollback to savepoint guarded_migration')
          const remaining = await connection.query(`
            select to_regclass('public.workout_exercises_workout_position_idx') is not null exercises,
              to_regclass('public.workout_sets_exercise_position_idx') is not null sets
          `)
          expect(remaining.rows).toEqual([{ exercises: true, sets: true }])
        } finally {
          await connection.query('rollback')
          connection.release()
        }
      })

      it('times out on an active reader without removing either index', async () => {
        if (ownerPool === undefined) throw new Error('owner pool is not initialized')
        const [up, down] = (await readFile(migrationUrl, 'utf8')).split('-- Down Migration')
        if (up === undefined || down === undefined) throw new Error('migration sections are missing')
        const blockerPool = new Pool({ connectionString: requireLocalTestDatabaseUrl(), max: 1 })
        const blocker = await blockerPool.connect()
        const connection = await ownerPool.connect()
        try {
          await connection.query('begin')
          await connection.query(down)
          await connection.query('commit')
          await blocker.query('begin; lock table public.workout_exercises in access share mode')
          await connection.query('begin')
          await expect(connection.query(up)).rejects.toMatchObject({ code: '55P03' })
          await connection.query('rollback')
          const remaining = await connection.query(`
            select to_regclass('public.workout_exercises_workout_position_idx') is not null exercises,
              to_regclass('public.workout_sets_exercise_position_idx') is not null sets
          `)
          expect(remaining.rows).toEqual([{ exercises: true, sets: true }])
        } finally {
          await blocker.query('rollback')
          blocker.release()
          await blockerPool.end()
          await connection.query('rollback')
          // Restore the schema expected by the other integration scenarios.
          await connection.query('begin')
          await connection.query(up)
          await connection.query('commit')
          connection.release()
        }
      }, 10_000)

      it.each([
        { table: 'workout_exercises', constraint: 'workout_exercises_position_unique',
          columns: 'id, workout_id, trainer_id, client_id, position, exercise_source, exercise_ref, exercise_name, muscle_group, input_kind',
          values: "$1, workout_id, trainer_id, client_id, 1, exercise_source, exercise_ref, exercise_name, muscle_group, input_kind",
          originalId: ROOT_WORKOUT_EXERCISE_ID },
        { table: 'workout_sets', constraint: 'workout_sets_position_unique',
          columns: 'id, workout_exercise_id, trainer_id, client_id, position',
          values: '$1, workout_exercise_id, trainer_id, client_id, 1',
          originalId: ROOT_WORKOUT_SET_ID },
      ])('keeps uniqueness and deferred reordering for $table', async (testCase) => {
        if (ownerPool === undefined) throw new Error('owner pool is not initialized')
        const connection = await ownerPool.connect()
        const extraId = randomUUID()
        try {
          await connection.query('begin')
          await connection.query(`insert into public.${testCase.table} (${testCase.columns})
            select ${testCase.values} from public.${testCase.table} where id = $2`, [extraId, testCase.originalId])
          await connection.query('savepoint duplicate_position')
          await expect(connection.query(`update public.${testCase.table} set position = 0 where id = $1`, [extraId]))
            .rejects.toMatchObject({ code: '23505', constraint: testCase.constraint })
          await connection.query('rollback to savepoint duplicate_position')
          await connection.query(`set constraints public.${testCase.constraint} deferred`)
          await connection.query(`update public.${testCase.table} set position = 1 where id = $1`, [testCase.originalId])
          await connection.query(`update public.${testCase.table} set position = 0 where id = $1`, [extraId])
          await connection.query(`set constraints public.${testCase.constraint} immediate`)
          const reordered = await connection.query(`select position from public.${testCase.table}
            where id = any($1::uuid[]) order by position`, [[extraId, testCase.originalId]])
          expect(reordered.rows).toEqual([{ position: 0 }, { position: 1 }])
        } finally {
          await connection.query('rollback')
          connection.release()
        }
      })
    })

    it.each(['vital-walking-lunge-ex270', 'vital-lunge-forward-ex314', 'vital-reverse-lunge-ex322', 'vital-side-lunge-ex325', 'vital-curtsy-lunge-ex244', 'vital-stepup-ex332'])('updates only editable %s snapshots without changing their sets or history', async (exerciseRef) => {
      if (ownerPool === undefined) throw new Error('owner pool is not initialized')
      const migrationUrl = new URL('../../db/migrations/000128_exercise_load_fields.sql', import.meta.url)
      const up = (await readFile(migrationUrl, 'utf8')).split('-- Down Migration')[0]
      if (up === undefined) throw new Error('migration up section is missing')
      const workoutIds = [randomUUID(), randomUUID(), randomUUID()]
      const exerciseIds = [randomUUID(), randomUUID(), randomUUID(), randomUUID()]
      const setId = randomUUID()
      const connection = await ownerPool.connect()
      try {
        await connection.query('begin')
        await connection.query(`
          insert into public.workouts (
            id, trainer_id, client_id, created_by, workout_date, status, started_at, completed_at
          ) values
            ($1, $4, $5, $4, date '2026-10-01', 'planned', null, null),
            ($2, $4, $5, $4, date '2026-10-02', 'in_progress', now(), null),
            ($3, $4, $5, $4, date '2026-10-03', 'done', null, now())
        `, [...workoutIds, ACTOR_ID, CLIENT_ID])
        await connection.query(`
          insert into public.workout_exercises (
            id, workout_id, trainer_id, client_id, position,
            exercise_source, exercise_ref, exercise_name, muscle_group, input_kind
          ) values
            ($1, $5, $8, $9, 0, 'system', $10, 'Выпады', 'legs', 'reps'),
            ($2, $5, $8, $9, 1, 'system', $10, 'Выпады', 'legs', 'reps'),
            ($3, $6, $8, $9, 0, 'system', $10, 'Выпады', 'legs', 'reps'),
            ($4, $7, $8, $9, 0, 'system', $10, 'Выпады', 'legs', 'reps')
        `, [...exerciseIds, ...workoutIds, ACTOR_ID, CLIENT_ID, exerciseRef])
        await connection.query(`
          insert into public.workout_sets (
            id, workout_exercise_id, trainer_id, client_id, position, plan_reps, fact_reps
          ) values ($1, $2, $3, $4, 0, 10, 10)
        `, [setId, exerciseIds[2], ACTOR_ID, CLIENT_ID])

        await connection.query(up)
        const exercises = await connection.query<{ id: string; input_kind: string }>(`
          select id, input_kind from public.workout_exercises where id = any($1::uuid[])
        `, [exerciseIds])
        const kinds = new Map(exercises.rows.map((row) => [row.id, row.input_kind]))
        expect(exerciseIds.slice(0, 3).map((id) => kinds.get(id))).toEqual(['strength', 'strength', 'strength'])
        expect(kinds.get(exerciseIds[3] ?? '')).toBe('reps')
        const workouts = await connection.query<{ id: string; version: string }>(`
          select id, version::text from public.workouts where id = any($1::uuid[])
        `, [workoutIds])
        const versions = new Map(workouts.rows.map((row) => [row.id, row.version]))
        expect(workoutIds.map((id) => versions.get(id))).toEqual(['2', '2', '1'])
        const sets = await connection.query<{ plan_reps: number; fact_reps: number }>(`
          select plan_reps, fact_reps from public.workout_sets where id = $1
        `, [setId])
        expect(sets.rows).toEqual([{ plan_reps: 10, fact_reps: 10 }])
      } finally {
        await connection.query('rollback')
        connection.release()
      }
    })

    describe('trainer profile first-write concurrency', () => {
      let photoPool: PgDatabasePool
      let profileId: string
      let session: YandexActorSession
      const draft: TrainerProfileDraft = {
        displayName: 'Synthetic trainer', bio: '', specialties: [], city: '',
        metroStationIds: [], customLocations: [], trainingModes: [],
        experienceStartYear: null, education: '', formats: '', price: '',
        acceptingClients: false, avatarDataUrl: null, photos: [], certificates: [],
      }
      const image = {
        bytes: new Uint8Array([0xff, 0xd8, 0xff]), mimeType: 'image/jpeg' as const,
        width: 1, height: 1, sizeBytes: 3,
      }
      const upload = { image, thumbnail: image }

      function storage() {
        return {
          read: vi.fn().mockResolvedValue(undefined),
          stat: vi.fn().mockResolvedValue(undefined),
          write: vi.fn().mockResolvedValue(undefined),
          remove: vi.fn().mockResolvedValue(undefined),
          sign: vi.fn((_namespace, path: string) => Promise.resolve(`https://storage.example/${path}`)),
        } satisfies MediaObjectStorage
      }

      beforeAll(() => {
        const url = new URL(requireLocalTestDatabaseUrl())
        url.username = 'fit_api'
        url.password = RUNTIME_PASSWORD
        photoPool = new PgDatabasePool({ connectionString: url.toString(), max: 4 })
      })

      beforeEach(async () => {
        const subjectHash = 'ac'.repeat(32)
        const registration = await new DatabaseYandexNativeRegistrar(photoPool).register(subjectHash, {
          accountRole: 'trainer', firstName: 'Synthetic trainer', timezone: 'Europe/Moscow',
        })
        profileId = registration.profileId
        await ownerPool?.query('delete from public.trainer_professional_profiles where trainer_id = $1', [profileId])
        const issued = await new DatabaseYandexAppSessionIssuer(photoPool).issue(subjectHash)
        if (issued === undefined) throw new Error('Synthetic session was not issued')
        session = { accessMode: 'read_write', token: issued.session.token }
      })

      afterEach(async () => {
        await ownerPool?.query('delete from public.trainers where profile_id = $1', [profileId])
        await ownerPool?.query('delete from public.profiles where id = $1', [profileId])
      })

      afterAll(async () => { await photoPool.end() })

      it('preserves both simultaneous first uploads', async () => {
        const media = storage()
        const profiles = new DatabasePilotTrainerProfiles(synchronizeFirstProfileReads(photoPool, 2), media)
        const responses = await Promise.all([
          profiles.uploadPhoto(session, draft, upload, false),
          profiles.uploadPhoto(session, draft, upload, false),
        ])
        const saved = await profiles.getOwn(session)
        expect(saved?.draft.photos).toHaveLength(2)
        expect(saved?.version).toBe(2)
        expect(responses.map((response) => response.version).sort()).toEqual([1, 2])
        expect(new Set(saved?.draft.photos.map((photo) => photo.id)).size).toBe(2)
        expect(media.write).toHaveBeenCalledTimes(4)
        expect(media.remove).not.toHaveBeenCalled()
      })

      it('preserves a first upload when a draft is saved concurrently', async () => {
        const profiles = new DatabasePilotTrainerProfiles(synchronizeFirstProfileReads(photoPool, 2), storage())
        await Promise.all([
          profiles.uploadPhoto(session, draft, upload, false),
          profiles.saveDraft(session, { ...draft, bio: 'Concurrent draft' }),
        ])
        expect((await profiles.getOwn(session))?.draft.photos).toHaveLength(1)
      })

      it('enforces the three-photo limit across simultaneous first uploads', async () => {
        const media = storage()
        const profiles = new DatabasePilotTrainerProfiles(synchronizeFirstProfileReads(photoPool, 4), media)
        const results = await Promise.allSettled(Array.from({ length: 4 }, () => (
          profiles.uploadPhoto(session, draft, upload, false)
        )))
        expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(3)
        const rejected = results.filter((result) => result.status === 'rejected')
        expect(rejected).toHaveLength(1)
        expect(rejected[0]).toMatchObject({ reason: { failure: 'limit_reached' } })
        expect((await profiles.getOwn(session))?.draft.photos).toHaveLength(3)
        expect(media.remove).toHaveBeenCalledTimes(2)
      })

      it('rolls back a newly created profile and removes files when metadata update fails', async () => {
        const failingPool: DatabasePool = {
          connect: async () => {
            const connection = await photoPool.connect()
            return {
              query: <Row extends QueryResultRow = QueryResultRow>(text: string, values?: readonly unknown[]) => {
                if (text.includes('update public.trainer_professional_profiles')) {
                  throw new Error('Synthetic metadata failure')
                }
                return connection.query<Row>(text, values)
              },
              release: () => connection.release(),
            }
          },
          end: () => photoPool.end(),
        }
        const media = storage()
        const profiles = new DatabasePilotTrainerProfiles(failingPool, media)
        await expect(profiles.uploadPhoto(session, draft, upload, false)).rejects.toThrow('Synthetic metadata failure')
        expect(await profiles.getOwn(session)).toBeNull()
        expect(media.write).toHaveBeenCalledTimes(2)
        expect(media.remove).toHaveBeenCalledTimes(2)
      })

      it('keeps the first draft version and ignores client-supplied photo references', async () => {
        const profiles = new DatabasePilotTrainerProfiles(photoPool, storage())
        const saved = await profiles.saveDraft(session, {
          ...draft,
          photos: [{
            id: '11111111-1111-4111-8111-111111111111', url: null,
            thumbnailUrl: 'https://untrusted.example/photo.jpg', mimeType: 'image/jpeg', width: 1, height: 1,
          }],
        })
        expect(saved.version).toBe(1)
        expect(saved.draft.photos).toEqual([])
        expect(saved.published).toBeNull()
      })
    })

    it('binds only the native Yandex login for the second Lime trainer', async () => {
      if (ownerPool === undefined) throw new Error('Owner pool is not ready')

      const emailHash = 'a2b96a2c9a67d0a1f70028b5466bf279aa2834149e9a4a0940882e7e1337703f'
      const loginHash = '1a13619899d89af007676a24b698ad3685b9e6a48cc27c84bad16927b7a2d581'
      const firstTrainerHash = '9efabf271d2433836f53f4efad98e31ae12e2283cae536eb9b1d800a2e734b71'
      const subjectHash = randomBytes(32).toString('hex')
      const connection = await ownerPool.connect()
      try {
        await connection.query('begin')
        for (const table of [
          'app_private.trainer_schedule_v2_allowlist',
          'app_private.fit_lime_pilot_allowlist',
        ]) {
          const result = await connection.query<{ login_sha256: string }>(
            `select login_sha256 from ${table} order by login_sha256`,
          )
          expect(result.rows.map((row) => row.login_sha256).sort())
            .toEqual([firstTrainerHash, loginHash].sort())
          expect(result.rows.some((row) => row.login_sha256 === emailHash)).toBe(false)
        }

        const profile = await connection.query<{ id: string }>(
          `insert into public.profiles (account_role)
           values ('trainer') returning id`,
        )
        const profileId = profile.rows[0]?.id
        if (profileId === undefined) throw new Error('Synthetic trainer was not created')
        await connection.query(
          'insert into public.trainers (profile_id) values ($1)',
          [profileId],
        )
        await connection.query(
          `insert into app_private.auth_identities
             (provider, provider_subject_sha256, profile_id)
           values ('yandex', $1, $2)`, [subjectHash, profileId],
        )

        const bind = async (functionName: string, hash: string) => {
          const result = await connection.query<{ bound: boolean }>(
            `select app_private.${functionName}($1, $2) as bound`,
            [subjectHash, hash],
          )
          return result.rows[0]?.bound
        }
        expect(await bind('activate_trainer_schedule_v2_for_yandex_login', emailHash)).toBe(false)
        expect(await bind('bind_fit_lime_for_yandex_login', emailHash)).toBe(false)
        expect(await bind('activate_trainer_schedule_v2_for_yandex_login', loginHash)).toBe(true)
        expect(await bind('bind_fit_lime_for_yandex_login', loginHash)).toBe(true)
        await connection.query(
          `select set_config('request.jwt.claim.sub', $1, true)`, [profileId],
        )
        const flags = await connection.query<{ schedule: boolean; lime: boolean }>(
          `select app_private.trainer_schedule_v2_enabled() as schedule,
                  app_private.fit_lime_enabled() as lime`,
        )
        expect(flags.rows[0]).toEqual({ schedule: true, lime: true })
      } finally {
        await connection.query('rollback')
        connection.release()
      }
    })

    it('binds all three reviewed trainers and isolates other identities, clients and a disabled Lime flag', async () => {
      if (!ownerPool) throw new Error('Owner pool is not ready')
      const connection = await ownerPool.connect()
      const logins = [
        '9efabf271d2433836f53f4efad98e31ae12e2283cae536eb9b1d800a2e734b71',
        '1a13619899d89af007676a24b698ad3685b9e6a48cc27c84bad16927b7a2d581',
        'd'.repeat(64),
      ]
      const profiles = Array.from({ length: 5 }, () => randomUUID())
      const subjects = Array.from({ length: 5 }, () => randomBytes(32).toString('hex'))
      const bind = async (functionName: string, subject: string, login: string) =>
        (await connection.query<{ bound: boolean }>(
          `select app_private.${functionName}($1, $2) as bound`, [subject, login],
        )).rows[0]?.bound
      const flags = async (profileId: string) => {
        await connection.query("select set_config('request.jwt.claim.sub', $1, true)", [profileId])
        return (await connection.query<{ schedule: boolean; lime: boolean }>(
          'select app_private.trainer_schedule_v2_enabled() as schedule, app_private.fit_lime_enabled() as lime',
        )).rows[0]
      }
      try {
        await connection.query('begin')
        await connection.query('savepoint runtime_cannot_extend')
        await connection.query('set local role fit_api')
        await expect(connection.query('select * from app_private.add_reviewed_trainer_lime_login($1)', [logins[2]]))
          .rejects.toMatchObject({ code: '42501' })
        await connection.query('rollback to savepoint runtime_cannot_extend')
        const enroll = () => connection.query<{ approved_rows: number; added: boolean }>('select * from app_private.add_reviewed_trainer_lime_login($1)', [logins[2]])
        expect((await enroll()).rows[0]).toEqual({ approved_rows: 3, added: true })
        expect((await enroll()).rows[0]).toEqual({ approved_rows: 3, added: false })
        await connection.query('savepoint fourth_trainer_blocked')
        await expect(connection.query('select * from app_private.add_reviewed_trainer_lime_login($1)', ['e'.repeat(64)]))
          .rejects.toMatchObject({ code: 'PT409' })
        await connection.query('rollback to savepoint fourth_trainer_blocked')
        for (const [index, profile] of profiles.entries()) {
          await connection.query('insert into public.profiles (id, account_role) values ($1, $2)', [profile, index === 4 ? 'client' : 'trainer'])
          if (index < 4) await connection.query('insert into public.trainers (profile_id) values ($1)', [profile])
          await connection.query("insert into app_private.auth_identities (provider, provider_subject_sha256, profile_id) values ('yandex', $1, $2)", [subjects[index], profile])
        }

        // A client's identity cannot occupy the third trainer's pilot row.
        for (const functionName of ['activate_trainer_schedule_v2_for_yandex_login', 'bind_fit_lime_for_yandex_login']) {
          expect(await bind(functionName, subjects[4]!, logins[2]!)).toBe(false)
          expect(await bind(functionName, subjects[2]!, 'e'.repeat(64))).toBe(false)
          expect(await bind(functionName, subjects[2]!, 'f'.repeat(64))).toBe(false)
        }
        for (const [index, login] of logins.entries()) {
          expect(await bind('activate_trainer_schedule_v2_for_yandex_login', subjects[index]!, login)).toBe(true)
          expect(await bind('bind_fit_lime_for_yandex_login', subjects[index]!, login)).toBe(true)
        }
        for (const profile of profiles.slice(0, 3)) expect(await flags(profile)).toEqual({ schedule: true, lime: true })
        for (const profile of profiles.slice(3)) expect(await flags(profile)).toEqual({ schedule: false, lime: false })
        const count = await connection.query<{ count: number }>("select count(*)::integer as count from app_private.user_experiment_assignments where experiment_key = 'trainer_schedule_v2' and enabled")
        expect(count.rows[0]?.count).toBe(3)

        // A different trainer cannot reuse a bound login or use an unknown key.
        for (const functionName of ['activate_trainer_schedule_v2_for_yandex_login', 'bind_fit_lime_for_yandex_login']) {
          expect(await bind(functionName, subjects[3]!, logins[2]!)).toBe(false)
          expect(await bind(functionName, subjects[3]!, randomBytes(32).toString('hex'))).toBe(false)
        }
        await connection.query('update app_private.fit_lime_pilot_allowlist set enabled = false where login_sha256 = $1', [logins[2]])
        expect((await enroll()).rows[0]).toEqual({ approved_rows: 3, added: false })
        expect(await bind('bind_fit_lime_for_yandex_login', subjects[2]!, logins[2]!)).toBe(true)
        expect(await flags(profiles[2]!)).toEqual({ schedule: true, lime: false })
        for (const profile of profiles.slice(0, 2)) expect(await flags(profile)).toEqual({ schedule: true, lime: true })
      } finally {
        await connection.query('rollback')
        connection.release()
      }
    })

    it('binds Client Lime only to the verified native login and keeps rollback and trainer isolation', async () => {
      if (!ownerPool) throw new Error('Owner pool is not ready')
      const connection = await ownerPool.connect()
      const login = 'c04908d54f928f24a1d3d2d53b666a78546a4e0ab6306a250b48863fc463a488'
      const clientProfile = randomUUID()
      const otherProfile = randomUUID()
      const subject = randomBytes(32).toString('hex')
      const otherSubject = randomBytes(32).toString('hex')
      try {
        await connection.query('begin')
        await connection.query(`insert into public.profiles (id, account_role) values ($1, 'client'), ($2, 'client')`, [clientProfile, otherProfile])
        await connection.query(`insert into public.clients (trainer_id, auth_user_id, full_name) values ($1, $2, 'Client Lime fixture'), ($1, $3, 'Other fixture')`, [ACTOR_ID, clientProfile, otherProfile])
        await connection.query(`insert into app_private.auth_identities (provider, provider_subject_sha256, profile_id) values ('yandex', $1, $2), ('yandex', $3, $4)`, [subject, clientProfile, otherSubject, otherProfile])
        const bind = async (subjectHash: string, loginHash: string) => (await connection.query<{ bound: boolean }>(
          'select app_private.bind_client_lime_for_yandex_login($1, $2) bound', [subjectHash, loginHash],
        )).rows[0]?.bound
        expect(await bind(subject, 'a'.repeat(64))).toBe(false)
        expect(await bind(PILOT_SUBJECT_HASH, login)).toBe(false) // trainer role
        expect(await bind(subject, login)).toBe(true)
        expect(await bind(otherSubject, login)).toBe(false) // no reassignment
        await connection.query(`select set_config('request.jwt.claim.sub', $1, true)`, [clientProfile])
        await connection.query('set local role fit_api')
        const flags = await connection.query<{ client: boolean; trainer: boolean }>(
          'select app_private.client_lime_enabled() client, app_private.fit_lime_enabled() trainer',
        )
        expect(flags.rows[0]).toEqual({ client: true, trainer: false })
        await connection.query('reset role')
        await connection.query(`select set_config('request.jwt.claim.sub', $1, true)`, [otherProfile])
        expect((await connection.query<{ enabled: boolean }>('select app_private.client_lime_enabled() enabled')).rows[0]?.enabled).toBe(false)
        await connection.query('update app_private.client_lime_pilot_allowlist set enabled = false')
        expect(await bind(subject, login)).toBe(true)
        await connection.query(`select set_config('request.jwt.claim.sub', $1, true)`, [clientProfile])
        expect((await connection.query<{ enabled: boolean }>('select app_private.client_lime_enabled() enabled')).rows[0]?.enabled).toBe(false)
        expect((await connection.query<{ count: number }>('select count(*)::int count from app_private.client_lime_pilot_allowlist')).rows[0]?.count).toBe(1)
      } finally {
        await connection.query('rollback')
        connection.release()
      }
    })

    it('binds assistant feature links to only the reviewed Yandex login and supports an immediate kill switch', async () => {
      if (!ownerPool) throw new Error('Owner pool is not ready')
      const connection = await ownerPool.connect()
      const reviewedLogin = 'f0afe245c0ed9fd6c2447048feb3b620175e5a887c7a7c50283aba9408139904'
      const mistypedLogin = 'cb34df8e58e7ee2b8e26a5adf3244394f3a599616f5d7a607fd4a38b0ae754e3'
      const profileId = randomUUID()
      const otherProfileId = randomUUID()
      const subject = randomBytes(32).toString('hex')
      const otherSubject = randomBytes(32).toString('hex')
      try {
        await connection.query('begin')
        await connection.query(
          `insert into public.profiles (id, account_role)
           values ($1, 'client'), ($2, 'client')`,
          [profileId, otherProfileId],
        )
        await connection.query(
          `insert into app_private.auth_identities
             (provider, provider_subject_sha256, profile_id)
           values ('yandex', $1, $2), ('yandex', $3, $4)`,
          [subject, profileId, otherSubject, otherProfileId],
        )
        const bind = async (subjectHash: string, loginHash: string) => (await connection.query<{ bound: boolean }>(
          'select app_private.bind_assistant_feature_links_for_yandex_login($1, $2) bound',
          [subjectHash, loginHash],
        )).rows[0]?.bound

        expect(await bind(subject, mistypedLogin)).toBe(false)
        expect(await bind(subject, 'a'.repeat(64))).toBe(false)
        expect(await bind(subject, reviewedLogin)).toBe(true)
        expect(await bind(otherSubject, reviewedLogin)).toBe(false)

        await connection.query(`select set_config('request.jwt.claim.sub', $1, true)`, [profileId])
        await connection.query('set local role fit_api')
        expect((await connection.query<{ enabled: boolean }>(
          'select app_private.assistant_feature_links_enabled() enabled',
        )).rows[0]?.enabled).toBe(true)
        await connection.query('reset role')

        await connection.query('update app_private.assistant_feature_links_pilot_allowlist set enabled = false')
        await connection.query('set local role fit_api')
        expect((await connection.query<{ enabled: boolean }>(
          'select app_private.assistant_feature_links_enabled() enabled',
        )).rows[0]?.enabled).toBe(false)
      } finally {
        await connection.query('rollback')
        connection.release()
      }
    })

    it('seeds exactly two isolated calendars once, enforces actor RLS and protects edited fixtures', async () => {
      if (!ownerPool || !enrollmentPool || !runtimePool) throw new Error('Pools not ready')
      const pilotIds = [randomUUID(), randomUUID()]
      const tables = ['app_private.fit_lime_pilot_allowlist', 'app_private.trainer_schedule_v2_allowlist']
      const saved: Array<Array<{ login_sha256: string; profile_id: string | null; enabled: boolean }>> = []
      for (const table of tables) saved.push((await ownerPool.query<{ login_sha256: string; profile_id: string | null; enabled: boolean }>(`select login_sha256, profile_id, ${table.includes('fit_lime') ? 'enabled' : 'true as enabled'} from ${table}`)).rows)
      const manager = new DatabaseFitLimeCalendarManager(enrollmentPool)
      try {
        for (const table of tables) await ownerPool.query(`update ${table} set profile_id = null`)
        await expect(manager.apply('seed')).rejects.toBeInstanceOf(FitLimeCalendarNotReadyError)
        expect((await ownerPool.query<{ count: number }>('select count(*)::int count from app_private.fit_lime_calendar_batches')).rows[0]?.count).toBe(0)
        for (const [index, id] of pilotIds.entries()) {
          await ownerPool.query(`insert into public.profiles(id, first_name, account_role, timezone) values ($1, 'Calendar fixture owner', 'trainer', 'Europe/Moscow')`, [id])
          await ownerPool.query('insert into public.trainers(profile_id) values ($1)', [id])
          for (const table of tables) await ownerPool.query(`update ${table} set profile_id = $1${table.includes('fit_lime') ? ', enabled = true' : ''} where login_sha256 = $2`, [id, FIT_LIME_CALENDAR_LOGINS[index]])
          await ownerPool.query(`insert into app_private.user_experiment_assignments (profile_id, experiment_key, enabled) values ($1, 'trainer_schedule_v2', true)`, [id])
        }
        const metricsSql = `select to_jsonb(a) - 'refreshed_at' result from analytics.trainer_overview a where trainer_id = any($1::uuid[]) order by trainer_id`
        const beforeMetrics = (await ownerPool.query(metricsSql, [pilotIds])).rows
        const result = await manager.apply('seed')
        expect(result.created).toBe(true)
        expect(result.isolated).toBe(true)
        expect(result.trainers).toHaveLength(2)
        for (const item of result.trainers) expect(item).toMatchObject({ clients: 15, workouts: 60, visible: 60, active: 1, cleaned: false })
        expect((await ownerPool.query(metricsSql, [pilotIds])).rows).toEqual(beforeMetrics)
        expect((await manager.apply('seed')).created).toBe(false)
        const seedClients = (await ownerPool.query<{ client_id: string }>('select client_id from app_private.fit_lime_calendar_clients')).rows.map((item) => item.client_id)
        for (const id of pilotIds) {
          const roster = await withActorTransaction(runtimePool, id, readAccessibleClients)
          expect(roster.clients).toHaveLength(15)
          expect(roster.clients.every((item) => !item.hasAccount && !/демо|тест/i.test(item.fullName))).toBe(true)
          const data = await withActorTransaction(runtimePool, id, readAccessibleTrainingData)
          expect(data.workouts).toHaveLength(60)
          expect(data.workouts.every((item) => item.trainerId === id)).toBe(true)
          expect(data.workouts.some((item) => item.exercises.length > 0)).toBe(true)
          expect(data.workouts.some((item) => item.exercises.length === 0)).toBe(true)
        }
        const other = await withActorTransaction(runtimePool, ACTOR_ID, readAccessibleClients)
        expect(other.clients.some((item) => seedClients.includes(item.id))).toBe(false)
        await expect(withActorTransaction(runtimePool, ACTOR_ID, (client) => client.query('select * from app_private.fit_lime_calendar_clients'))).rejects.toThrow()
        await expect(ownerPool.query('update public.clients set auth_user_id = $1 where id = $2', [OTHER_ACTOR_ID, seedClients[0]])).rejects.toThrow('synthetic_client_identity_is_fixed')
        const seededWorkout = (await ownerPool.query<{ id: string; client_id: string; trainer_id: string }>(`select w.id, w.client_id, w.trainer_id from public.workouts w join app_private.fit_lime_calendar_workouts f on f.workout_id = w.id limit 1`)).rows[0]!
        await expect(ownerPool.query('update public.workouts set client_id = $1 where id = $2', [seedClients.find((id) => id !== seededWorkout.client_id), seededWorkout.id])).rejects.toThrow('synthetic_workout_partition_is_fixed')
        await ownerPool.query(`update public.workouts set title = 'Сохранённая пользовательская правка', version = version + 1 where id = $1`, [seededWorkout.id])
        expect((await manager.apply('seed')).created).toBe(false)
        expect((await ownerPool.query<{ title: string }>('select title from public.workouts where id = $1', [seededWorkout.id])).rows[0]?.title).toBe('Сохранённая пользовательская правка')
        await expect(manager.apply('cleanup')).rejects.toBeInstanceOf(FitLimeCalendarNotReadyError)
        expect((await manager.apply('inspect')).trainers.every((item) => item.visible === 60)).toBe(true)
        await ownerPool.query('update public.workouts set version = 1 where id = $1', [seededWorkout.id])
        expect((await manager.apply('cleanup')).trainers.every((item) => item.visible === 0 && item.cleaned)).toBe(true)
        expect((await manager.apply('cleanup')).trainers.every((item) => item.cleaned)).toBe(true)
        await expect(manager.apply('seed')).rejects.toBeInstanceOf(FitLimeCalendarNotReadyError)
      } finally {
        // Only this test's two newly generated owner IDs in a localhost-only DB.
        await ownerPool.query(`delete from app_private.fit_lime_calendar_workouts f using public.workouts w where w.id = f.workout_id and w.trainer_id = any($1::uuid[])`, [pilotIds])
        await ownerPool.query('delete from public.workouts where trainer_id = any($1::uuid[])', [pilotIds])
        await ownerPool.query('delete from app_private.fit_lime_calendar_clients where trainer_id = any($1::uuid[])', [pilotIds])
        await ownerPool.query('delete from app_private.fit_lime_calendar_batches where trainer_id = any($1::uuid[])', [pilotIds])
        await ownerPool.query('delete from public.client_trainer_relationships where trainer_id = any($1::uuid[])', [pilotIds])
        await ownerPool.query('delete from public.clients where trainer_id = any($1::uuid[])', [pilotIds])
        for (const [index, table] of tables.entries()) {
          await ownerPool.query(`update ${table} set profile_id = null`)
          for (const row of saved[index] ?? []) {
            if (table.includes('fit_lime')) await ownerPool.query(`update ${table} set profile_id = $1, enabled = $2 where login_sha256 = $3`, [row.profile_id, row.enabled, row.login_sha256])
            else await ownerPool.query(`update ${table} set profile_id = $1 where login_sha256 = $2`, [row.profile_id, row.login_sha256])
          }
        }
        await ownerPool.query('delete from public.trainers where profile_id = any($1::uuid[])', [pilotIds])
        await ownerPool.query('delete from public.profiles where id = any($1::uuid[])', [pilotIds])
      }
    })

    it('recovers after PostgreSQL terminates an idle pooled connection', async () => {
      if (ownerPool === undefined) throw new Error('Database pool is not ready')
      const pool = new PgDatabasePool({
        connectionString: requireLocalTestDatabaseUrl(),
        max: 1,
        idleTimeoutMillis: 0,
      })
      let reportError: (message: string) => void = () => undefined
      const idleError = new Promise<string>((resolve) => { reportError = resolve })
      const warn = vi.spyOn(console, 'warn').mockImplementation((message: unknown) => {
        if (typeof message === 'string') reportError(message)
      })
      try {
        const connection = await pool.connect()
        const rows = await connection.query<{ pid: number }>('select pg_backend_pid() as pid')
        connection.release()
        const pid = rows[0]?.pid
        if (pid === undefined) throw new Error('Missing backend PID')

        const terminated = await ownerPool.query<{ terminated: boolean }>(
          'select pg_terminate_backend($1) as terminated', [pid],
        )
        expect(terminated.rows[0]?.terminated).toBe(true)
        expect(JSON.parse(await idleError)).toMatchObject({
          event: 'database_pool_idle_error',
          databaseErrorCode: '57P01',
        })

        const recovered = await pool.connect()
        try {
          const result = await recovered.query<{ pid: number; value: number }>(
            'select pg_backend_pid() as pid, 1 as value',
          )
          expect(result[0]?.value).toBe(1)
          expect(result[0]?.pid).not.toBe(pid)
        } finally {
          recovered.release()
        }
      } finally {
        warn.mockRestore()
        await pool.end()
      }
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

    it('keeps legal acceptance and deletion requests idempotent and actor-scoped', async () => {
      if (ownerPool === undefined || runtimePool === undefined) {
        throw new Error('Database pools are not ready')
      }
      await ownerPool.query(
        'delete from public.account_deletion_requests where user_id = any($1::uuid[])',
        [[ACTOR_ID, OTHER_ACTOR_ID]],
      )
      await ownerPool.query(
        'delete from public.user_legal_acceptances where user_id = any($1::uuid[])',
        [[ACTOR_ID, OTHER_ACTOR_ID]],
      )

      try {
        await expect(withActorTransaction(runtimePool, ACTOR_ID, (client) =>
          readLegalAcceptance(client, CURRENT_TERMS_VERSION, CURRENT_PRIVACY_VERSION)))
          .resolves.toEqual({ accepted: false, acceptedAt: null })

        const acceptedAt = await withActorTransaction(runtimePool, ACTOR_ID, (client) =>
          acceptLegalDocuments(
            client,
            CURRENT_TERMS_VERSION,
            CURRENT_PRIVACY_VERSION,
            'existing_user',
          ))
        await expect(withActorTransaction(runtimePool, ACTOR_ID, (client) =>
          acceptLegalDocuments(
            client,
            CURRENT_TERMS_VERSION,
            CURRENT_PRIVACY_VERSION,
            'existing_user',
          ))).resolves.toBe(acceptedAt)

        const acceptanceCount = await ownerPool.query<CountRow>(
          `select count(*)::integer count
           from public.user_legal_acceptances
           where user_id = $1 and terms_version = $2 and privacy_version = $3`,
          [ACTOR_ID, CURRENT_TERMS_VERSION, CURRENT_PRIVACY_VERSION],
        )
        expect(acceptanceCount.rows[0]?.count).toBe(1)
        await expect(withActorTransaction(runtimePool, OTHER_ACTOR_ID, (client) =>
          readLegalAcceptance(client, CURRENT_TERMS_VERSION, CURRENT_PRIVACY_VERSION)))
          .resolves.toEqual({ accepted: false, acceptedAt: null })
        await expect(withActorTransaction(runtimePool, OTHER_ACTOR_ID, (client) =>
          client.query(
            `insert into public.user_legal_acceptances (
               user_id, terms_version, privacy_version, source
             ) values ($1, $2, $3, 'existing_user')`,
            [ACTOR_ID, CURRENT_TERMS_VERSION, CURRENT_PRIVACY_VERSION],
          ))).rejects.toMatchObject({ code: '42501' })

        const deletionRequestId = await withActorTransaction(
          runtimePool,
          ACTOR_ID,
          requestAccountDeletion,
        )
        await expect(withActorTransaction(runtimePool, ACTOR_ID, requestAccountDeletion))
          .resolves.toBe(deletionRequestId)
        await expect(withActorTransaction(runtimePool, ACTOR_ID, readAccountDeletionRequest))
          .resolves.toMatchObject({ id: deletionRequestId, status: 'requested' })
        await expect(withActorTransaction(runtimePool, OTHER_ACTOR_ID, readAccountDeletionRequest))
          .resolves.toBeNull()

        await withActorTransaction(runtimePool, ACTOR_ID, cancelAccountDeletionRequest)
        await expect(withActorTransaction(runtimePool, ACTOR_ID, readAccountDeletionRequest))
          .resolves.toBeNull()
        const cancelled = await ownerPool.query<{ status: string } & QueryResultRow>(
          'select status from public.account_deletion_requests where id = $1',
          [deletionRequestId],
        )
        expect(cancelled.rows).toEqual([{ status: 'cancelled' }])
      } finally {
        await ownerPool.query(
          'delete from public.account_deletion_requests where user_id = any($1::uuid[])',
          [[ACTOR_ID, OTHER_ACTOR_ID]],
        )
        await ownerPool.query(
          'delete from public.user_legal_acceptances where user_id = any($1::uuid[])',
          [[ACTOR_ID, OTHER_ACTOR_ID]],
        )
      }
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

      const issuer = new DatabaseYandexAppSessionIssuer(runtimePool)
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

      await expect(issuer.issue(PILOT_SUBJECT_HASH)).resolves.toMatchObject({
        accessMode: 'read_write',
        profile: { id: ACTOR_ID },
      })
      await ownerPool.query(
        `update app_private.profile_rollout_assignments
         set target_backend = 'yandex', access_mode = 'read_only', enabled = true
         where profile_id = $1`,
        [ACTOR_ID],
      )
      expect(await readActor(runtimePool)).toBeNull()
    })

    it('registers native trainer and client accounts atomically and idempotently', async () => {
      if (ownerPool === undefined || runtimePool === undefined) {
        throw new Error('Database pools are not ready')
      }

      const registrar = new DatabaseYandexNativeRegistrar(runtimePool)
      const issuer = new DatabaseYandexAppSessionIssuer(runtimePool)
      const trainer = await registrar.register(NATIVE_TRAINER_SUBJECT_HASH, {
        accountRole: 'trainer',
        firstName: 'Нативный тренер',
        timezone: 'Europe/Moscow',
      })
      const repeated = await registrar.register(NATIVE_TRAINER_SUBJECT_HASH, {
        accountRole: 'client',
        firstName: 'Не перезаписывать',
        timezone: 'Asia/Yekaterinburg',
      })
      const client = await registrar.register(NATIVE_CLIENT_SUBJECT_HASH, {
        accountRole: 'client',
        firstName: 'Нативный клиент',
        timezone: 'Asia/Yekaterinburg',
      })

      expect(repeated).toEqual(trainer)
      expect(client.profileId).not.toBe(trainer.profileId)
      await expect(issuer.issue(NATIVE_TRAINER_SUBJECT_HASH)).resolves.toMatchObject({
        accessMode: 'read_write',
        profile: { id: trainer.profileId, accountRole: 'trainer' },
      })
      await expect(issuer.issue(NATIVE_CLIENT_SUBJECT_HASH)).resolves.toMatchObject({
        accessMode: 'read_write',
        profile: { id: client.profileId, accountRole: 'client', client: null },
      })

      const accounts = await ownerPool.query<{
        account_role: string
        first_name: string
        identity_origin: string
        rollout_access_mode: string
        rollout_enabled: boolean
        rollout_target_backend: string
        trainer_exists: boolean
        client_card_exists: boolean
        acceptance_count: number
        acceptance_privacy_version: string
        acceptance_terms_version: string
      } & QueryResultRow>(
        `select profile.account_role, profile.first_name,
           identity.identity_origin,
           rollout.access_mode rollout_access_mode,
           rollout.target_backend rollout_target_backend,
           rollout.enabled rollout_enabled,
           exists (
             select 1 from public.trainers trainer
             where trainer.profile_id = profile.id
           ) trainer_exists,
           exists (
             select 1 from public.clients client
             where client.auth_user_id = profile.id
           ) client_card_exists,
           (
             select count(*)::int
             from public.user_legal_acceptances acceptance
             where acceptance.user_id = profile.id
               and acceptance.source = 'registration'
           ) acceptance_count
           ,(
             select acceptance.terms_version
             from public.user_legal_acceptances acceptance
             where acceptance.user_id = profile.id
               and acceptance.source = 'registration'
             order by acceptance.accepted_at desc
             limit 1
           ) acceptance_terms_version
           ,(
             select acceptance.privacy_version
             from public.user_legal_acceptances acceptance
             where acceptance.user_id = profile.id
               and acceptance.source = 'registration'
             order by acceptance.accepted_at desc
             limit 1
           ) acceptance_privacy_version
         from public.profiles profile
         join app_private.auth_identities identity
           on identity.profile_id = profile.id and identity.provider = 'yandex'
         join app_private.profile_rollout_assignments rollout
           on rollout.profile_id = profile.id
         where profile.id = any($1::uuid[])
         order by profile.account_role desc`,
        [[trainer.profileId, client.profileId]],
      )
      expect(accounts.rows).toEqual([
        {
          account_role: 'trainer',
          first_name: 'Нативный тренер',
          identity_origin: 'native',
          rollout_access_mode: 'read_write',
          rollout_enabled: true,
          rollout_target_backend: 'yandex',
          trainer_exists: true,
          client_card_exists: false,
          acceptance_count: 1,
          acceptance_privacy_version: CURRENT_PRIVACY_VERSION,
          acceptance_terms_version: CURRENT_TERMS_VERSION,
        },
        {
          account_role: 'client',
          first_name: 'Нативный клиент',
          identity_origin: 'native',
          rollout_access_mode: 'read_write',
          rollout_enabled: true,
          rollout_target_backend: 'yandex',
          trainer_exists: false,
          client_card_exists: false,
          acceptance_count: 1,
          acceptance_privacy_version: CURRENT_PRIVACY_VERSION,
          acceptance_terms_version: CURRENT_TERMS_VERSION,
        },
      ])
      expect(await readActor(runtimePool)).toBeNull()
    })

    it('does not turn an existing linked identity into a native account', async () => {
      if (ownerPool === undefined || runtimePool === undefined) {
        throw new Error('Database pools are not ready')
      }

      await ownerPool.query(
        'update app_private.profile_rollout_assignments set enabled = false where profile_id = $1',
        [APP_ACTOR_ID],
      )
      try {
        const registrar = new DatabaseYandexNativeRegistrar(runtimePool)
        await expect(registrar.register(APP_SUBJECT_HASH, {
          accountRole: 'trainer',
          firstName: 'Не менять',
          timezone: 'Europe/Moscow',
        })).rejects.toMatchObject({ failure: 'conflict' })
        const rollout = await ownerPool.query<{ enabled: boolean } & QueryResultRow>(
          'select enabled from app_private.profile_rollout_assignments where profile_id = $1',
          [APP_ACTOR_ID],
        )
        expect(rollout.rows).toEqual([{ enabled: false }])
      } finally {
        await ownerPool.query(
          'update app_private.profile_rollout_assignments set enabled = true where profile_id = $1',
          [APP_ACTOR_ID],
        )
      }
    })

    it('atomically links and enables a migrated domain-ready profile after recovery', async () => {
      if (ownerPool === undefined || runtimePool === undefined) {
        throw new Error('Database pools are not ready')
      }
      const migratedProfileId = 'd05d1bb4-4da0-4846-a8c7-e3f1dd1ee821'
      const subjectHash = 'd'.repeat(64)
      const handoff = new DatabaseYandexAuthHandoffService(runtimePool)
      await ownerPool.query('delete from public.trainers where profile_id = $1', [migratedProfileId])
      await ownerPool.query('delete from public.profiles where id = $1', [migratedProfileId])
      await ownerPool.query(
        `insert into public.profiles (id, first_name, timezone, account_role)
         values ($1, 'Перенесённый тренер', 'Europe/Moscow', 'trainer')`,
        [migratedProfileId],
      )
      await ownerPool.query(
        'insert into public.trainers (profile_id) values ($1)',
        [migratedProfileId],
      )

      try {
        const rolloutBefore = await ownerPool.query<CountRow>(
          `select count(*)::int as count
           from app_private.profile_rollout_assignments
           where profile_id = $1`,
          [migratedProfileId],
        )
        expect(rolloutBefore.rows).toEqual([{ count: 0 }])

        const issued = await handoff.issue(subjectHash)
        expect(issued?.token).toMatch(/^[A-Za-z0-9_-]{43}$/)
        const stored = await ownerPool.query<{ token_sha256: string } & QueryResultRow>(
          `select token_sha256 from app_private.yandex_auth_handoffs
           where subject_sha256 = $1`,
          [subjectHash],
        )
        expect(stored.rows).toHaveLength(1)
        expect(stored.rows[0]?.token_sha256).not.toBe(issued?.token)
        await handoff.recordRecoveryAttempt(issued?.token ?? '')
        const attempts = await ownerPool.query<{ recovery_attempt_count: number } & QueryResultRow>(
          `select recovery_attempt_count from app_private.yandex_auth_handoffs
           where subject_sha256 = $1`,
          [subjectHash],
        )
        expect(attempts.rows).toEqual([{ recovery_attempt_count: 1 }])

        const session = await handoff.recoverExisting(issued?.token ?? '', {
          profile: {
            id: migratedProfileId,
            firstName: 'Перенесённый тренер',
            lastName: null,
            timezone: 'Europe/Moscow',
            accountRole: 'trainer',
            createdAt: '2026-09-01T00:00:00.000Z',
            updatedAt: '2026-09-01T00:00:00.000Z',
          },
          trainer: {
            profileId: migratedProfileId,
            createdAt: '2026-09-01T00:00:00.000Z',
            updatedAt: '2026-09-01T00:00:00.000Z',
          },
        })
        expect(session.profile.id).toBe(migratedProfileId)
        expect(session.profile.accountRole).toBe('trainer')
        expect(session.accessMode).toBe('read_write')
        expect(session.session.token).toMatch(/^[A-Za-z0-9_-]{43}$/)
        const rolloutAfter = await ownerPool.query<{
          access_mode: string
          enabled: boolean
          target_backend: string
        } & QueryResultRow>(
          `select target_backend, access_mode, enabled
           from app_private.profile_rollout_assignments
           where profile_id = $1`,
          [migratedProfileId],
        )
        expect(rolloutAfter.rows).toEqual([{
          target_backend: 'yandex',
          access_mode: 'read_write',
          enabled: true,
        }])
        const storedSessionHash = hashPilotSessionToken(session.session.token)
        expect(storedSessionHash).toMatch(/^[0-9a-f]{64}$/)
        const storedSession = await ownerPool.query<CountRow>(
          `select count(*)::int as count
           from app_private.yandex_app_sessions
           where token_sha256 = $1 and profile_id = $2`,
          [storedSessionHash, migratedProfileId],
        )
        expect(storedSession.rows).toEqual([{ count: 1 }])
        await expect(handoff.recoverExisting(issued?.token ?? '', {
          profile: {
            id: migratedProfileId,
            firstName: 'Перенесённый тренер',
            lastName: null,
            timezone: 'Europe/Moscow',
            accountRole: 'trainer',
            createdAt: '2026-09-01T00:00:00.000Z',
            updatedAt: '2026-09-01T00:00:00.000Z',
          },
          trainer: {
            profileId: migratedProfileId,
            createdAt: '2026-09-01T00:00:00.000Z',
            updatedAt: '2026-09-01T00:00:00.000Z',
          },
        })).rejects.toMatchObject({ failure: 'expired' })
      } finally {
        await ownerPool.query('delete from public.trainers where profile_id = $1', [migratedProfileId])
        await ownerPool.query('delete from public.profiles where id = $1', [migratedProfileId])
      }
    })

    it('does not enable recovery for an incomplete migrated role root', async () => {
      if (ownerPool === undefined || runtimePool === undefined) {
        throw new Error('Database pools are not ready')
      }
      const migratedProfileId = 'd05d1bb4-4da0-4846-a8c7-e3f1dd1ee822'
      const subjectHash = 'a'.repeat(64)
      const handoff = new DatabaseYandexAuthHandoffService(runtimePool)
      await ownerPool.query('delete from public.profiles where id = $1', [migratedProfileId])
      await ownerPool.query(
        `insert into public.profiles (id, first_name, timezone, account_role)
         values ($1, 'Неполный перенос', 'Europe/Moscow', 'client')`,
        [migratedProfileId],
      )

      try {
        const issued = await handoff.issue(subjectHash)
        await expect(handoff.recoverExisting(issued?.token ?? '', {
          profile: {
            id: migratedProfileId,
            firstName: 'Неполный перенос',
            lastName: null,
            timezone: 'Europe/Moscow',
            accountRole: 'client',
            createdAt: '2026-09-01T00:00:00.000Z',
            updatedAt: '2026-09-01T00:00:00.000Z',
          },
        })).rejects.toMatchObject({ failure: 'conflict' })
        const rollout = await ownerPool.query<CountRow>(
          `select count(*)::int as count
           from app_private.profile_rollout_assignments
           where profile_id = $1`,
          [migratedProfileId],
        )
        const identity = await ownerPool.query<CountRow>(
          `select count(*)::int as count
           from app_private.auth_identities
           where provider = 'yandex'
             and provider_subject_sha256 = $1`,
          [subjectHash],
        )
        const sessions = await ownerPool.query<CountRow>(
          `select count(*)::int as count
           from app_private.yandex_app_sessions
           where profile_id = $1`,
          [migratedProfileId],
        )
        expect(rollout.rows).toEqual([{ count: 0 }])
        expect(identity.rows).toEqual([{ count: 0 }])
        expect(sessions.rows).toEqual([{ count: 0 }])
      } finally {
        await ownerPool.query(
          'delete from app_private.yandex_auth_handoffs where subject_sha256 = $1',
          [subjectHash],
        )
        await ownerPool.query('delete from public.profiles where id = $1', [migratedProfileId])
      }
    })

    it('links Yandex ID to the current FIT actor without granting rollout access', async () => {
      if (ownerPool === undefined || runtimePool === undefined) {
        throw new Error('Database pools are not ready')
      }

      const linker = new DatabaseYandexAccountLinker(runtimePool)

      await expect(linker.readStatus(LINK_ACTOR)).resolves.toEqual({ linked: false })

      await expect(
        linker.linkActor(LINK_ACTOR, LINK_SUBJECT_HASH),
      ).resolves.toEqual({ profileId: LINK_ACTOR_ID })
      await expect(
        linker.linkActor(LINK_ACTOR, LINK_SUBJECT_HASH),
      ).resolves.toEqual({ profileId: LINK_ACTOR_ID })
      await expect(linker.readStatus(LINK_ACTOR)).resolves.toEqual({ linked: true })

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
        linker.linkActor({
          profile: {
            ...LINK_ACTOR.profile,
            id: OTHER_ACTOR_ID,
            accountRole: 'client',
          },
        }, LINK_SUBJECT_HASH),
      ).rejects.toBeInstanceOf(YandexAccountLinkError)
      await expect(
        linker.linkActor(LINK_ACTOR, OTHER_LINK_SUBJECT_HASH),
      ).rejects.toBeInstanceOf(YandexAccountLinkError)
      expect(await readActor(runtimePool)).toBeNull()
    })

    it('promotes a linked profile to read-write while issuing its session', async () => {
      if (ownerPool === undefined || runtimePool === undefined) {
        throw new Error('Database pools are not ready')
      }

      const issuer = new DatabaseYandexAppSessionIssuer(runtimePool)
      await ownerPool.query(
        `insert into app_private.auth_identities (
           provider, provider_subject_sha256, profile_id, identity_origin
         ) values ('yandex', $1, $2, 'linked')
         on conflict (provider, provider_subject_sha256) do update set
           profile_id = excluded.profile_id,
           identity_origin = excluded.identity_origin`,
        [LINK_SUBJECT_HASH, LINK_ACTOR_ID],
      )
      await ownerPool.query(
        'delete from app_private.profile_rollout_assignments where profile_id = $1',
        [LINK_ACTOR_ID],
      )
      try {
        await expect(issuer.issue(LINK_SUBJECT_HASH)).resolves.toMatchObject({
          accessMode: 'read_write',
          profile: { id: LINK_ACTOR_ID, accountRole: 'client' },
        })
        const rollout = await ownerPool.query<{
          access_mode: string
          enabled: boolean
          target_backend: string
        } & QueryResultRow>(
          `select target_backend, access_mode, enabled
           from app_private.profile_rollout_assignments
           where profile_id = $1`,
          [LINK_ACTOR_ID],
        )
        expect(rollout.rows).toEqual([{
          access_mode: 'read_write',
          enabled: true,
          target_backend: 'yandex',
        }])

        await ownerPool.query(
          `update app_private.profile_rollout_assignments
           set target_backend = 'supabase', access_mode = 'read_only', enabled = true
           where profile_id = $1`,
          [LINK_ACTOR_ID],
        )
        await expect(issuer.issue(LINK_SUBJECT_HASH)).resolves.toMatchObject({
          accessMode: 'read_write',
          profile: { id: LINK_ACTOR_ID, accountRole: 'client' },
        })
        const repairedRollout = await ownerPool.query<{
          access_mode: string
          enabled: boolean
          target_backend: string
        } & QueryResultRow>(
          `select target_backend, access_mode, enabled
           from app_private.profile_rollout_assignments
           where profile_id = $1`,
          [LINK_ACTOR_ID],
        )
        expect(repairedRollout.rows).toEqual([{
          access_mode: 'read_write',
          enabled: true,
          target_backend: 'yandex',
        }])
      } finally {
        await ownerPool.query(
          'delete from app_private.yandex_app_sessions where profile_id = $1',
          [LINK_ACTOR_ID],
        )
        await ownerPool.query(
          'delete from app_private.profile_rollout_assignments where profile_id = $1',
          [LINK_ACTOR_ID],
        )
      }
    })

    it('bootstraps the exact current FIT profile before linking Yandex ID', async () => {
      if (ownerPool === undefined || runtimePool === undefined) {
        throw new Error('Database pools are not ready')
      }

      const linker = new DatabaseYandexAccountLinker(runtimePool)
      await expect(
        linker.linkActor(BOOTSTRAP_LINK_ACTOR, BOOTSTRAP_LINK_SUBJECT_HASH),
      ).resolves.toEqual({ profileId: BOOTSTRAP_LINK_ACTOR_ID })

      const profiles = await ownerPool.query<{
        account_role: string
        created_at: Date
        first_name: string | null
        last_name: string | null
        timezone: string
        updated_at: Date
      } & QueryResultRow>(
        `select first_name, last_name, timezone, account_role, created_at, updated_at
         from public.profiles where id = $1`,
        [BOOTSTRAP_LINK_ACTOR_ID],
      )
      expect(profiles.rows).toHaveLength(1)
      expect(profiles.rows[0]).toMatchObject({
        first_name: BOOTSTRAP_LINK_ACTOR.profile.firstName,
        last_name: BOOTSTRAP_LINK_ACTOR.profile.lastName,
        timezone: BOOTSTRAP_LINK_ACTOR.profile.timezone,
        account_role: BOOTSTRAP_LINK_ACTOR.profile.accountRole,
      })
      expect(profiles.rows[0]?.created_at.toISOString())
        .toBe(BOOTSTRAP_LINK_ACTOR.profile.createdAt)
      expect(profiles.rows[0]?.updated_at.toISOString())
        .toBe(BOOTSTRAP_LINK_ACTOR.profile.updatedAt)

      const trainers = await ownerPool.query<{
        created_at: Date
        profile_id: string
        updated_at: Date
      } & QueryResultRow>(
        `select profile_id, created_at, updated_at
         from public.trainers where profile_id = $1`,
        [BOOTSTRAP_LINK_ACTOR_ID],
      )
      expect(trainers.rows).toHaveLength(1)
      expect(trainers.rows[0]?.profile_id).toBe(BOOTSTRAP_LINK_ACTOR_ID)
      expect(trainers.rows[0]?.created_at.toISOString())
        .toBe(BOOTSTRAP_LINK_ACTOR.trainer?.createdAt)
      expect(trainers.rows[0]?.updated_at.toISOString())
        .toBe(BOOTSTRAP_LINK_ACTOR.trainer?.updatedAt)

      const identities = await ownerPool.query<CountRow>(
        `select count(*)::int as count
         from app_private.auth_identities
         where provider = 'yandex'
           and provider_subject_sha256 = $1
           and profile_id = $2`,
        [BOOTSTRAP_LINK_SUBJECT_HASH, BOOTSTRAP_LINK_ACTOR_ID],
      )
      expect(identities.rows).toEqual([{ count: 1 }])
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

        const ownPreferenceUpdate = await client.query<ProfileRow>(
          `
            update public.profiles
            set schedule_density = 'compact'
            where id = $1
            returning schedule_density
          `,
          [ACTOR_ID],
        )
        expect(ownPreferenceUpdate).toEqual([{ schedule_density: 'compact' }])

        const hiddenPreferenceUpdate = await client.query<ProfileRow>(
          `
            update public.profiles
            set schedule_density = 'compact'
            where id = $1
            returning schedule_density
          `,
          [OTHER_ACTOR_ID],
        )
        expect(hiddenPreferenceUpdate).toEqual([])

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

    it('isolates trainer finance and derives balances from active payments', async () => {
      if (ownerPool === undefined || runtimePool === undefined) {
        throw new Error('Database pools are not ready')
      }
      await ownerPool.query('delete from public.trainer_finance_events where client_id = $1', [CLIENT_ID])
      await ownerPool.query('delete from public.trainer_finance_payments where client_id = $1', [CLIENT_ID])
      await ownerPool.query('delete from public.trainer_finance_sessions where client_id = $1', [CLIENT_ID])
      await ownerPool.query('delete from public.trainer_finance_packages where client_id = $1', [CLIENT_ID])
      try {
        const created = await withActorTransaction(runtimePool, ACTOR_ID, (client) =>
          client.query<JsonResultRow>(
            `select public.create_trainer_finance_service(
              $1, 'session_pack', 'Персональные тренировки', 10, 2, 2500000, 1000000,
              date '2026-09-01', date '2026-11-30', date '2026-09-10', 'Внутренняя заметка'
            ) as result`,
            [CLIENT_ID],
          ))
        expect(created[0]?.result).toMatchObject({
          clientId: CLIENT_ID,
          trainerId: ACTOR_ID,
          kind: 'session_pack',
          sessionsTotal: 10,
          sessionsUsed: 2,
          sessionsRemaining: 8,
          priceCents: 2500000,
          paidCents: 1000000,
          dueCents: 1500000,
          paymentStatus: 'overdue',
        })
        const packageId = (created[0]?.result as { id?: unknown }).id
        expect(typeof packageId).toBe('string')

        const payment = await withActorTransaction(runtimePool, ACTOR_ID, (client) =>
          client.query<JsonResultRow>(
            `select public.add_trainer_finance_payment(
              $1, 1500000, date '2026-09-02', 'Доплата'
            ) as result`,
            [packageId],
          ))
        expect(payment[0]?.result).toMatchObject({ amountCents: 1500000, source: 'manual' })

        const bundle = await withActorTransaction(runtimePool, ACTOR_ID, (client) =>
          client.query<JsonResultRow>(
            'select public.list_trainer_finance_client_v2($1) as result',
            [CLIENT_ID],
          ))
        expect(bundle[0]?.result).toMatchObject({
          clientId: CLIENT_ID,
          packages: [expect.objectContaining({ paidCents: 2500000, dueCents: 0, paymentStatus: 'paid' })],
        })

        const clientFinance = await withActorTransaction(runtimePool, OTHER_ACTOR_ID, (client) =>
          client.query<JsonResultRow>('select public.list_client_finance_self_v2() as result'))
        expect(clientFinance[0]?.result).toMatchObject({
          trainers: [{
            trainerId: ACTOR_ID,
            trainerName: 'Updated actor',
            packages: [expect.objectContaining({
              id: packageId,
              title: 'Персональные тренировки',
              sessionsRemaining: 8,
              paidCents: 2500000,
              dueCents: 0,
            })],
          }],
        })
        const serializedClientFinance = JSON.stringify(clientFinance[0]?.result)
        expect(serializedClientFinance).toContain('"amountCents":1000000')
        expect(serializedClientFinance).toContain('"amountCents":1500000')
        expect(serializedClientFinance).not.toContain('Внутренняя заметка')
        expect(serializedClientFinance).not.toContain('Доплата')

        const unrelatedClient = await withActorTransaction(runtimePool, LINK_ACTOR_ID, (client) =>
          client.query<JsonResultRow>('select public.list_client_finance_self_v2() as result'))
        expect(unrelatedClient[0]?.result).toEqual({ trainers: [] })

        await expect(withActorTransaction(runtimePool, ACTOR_ID, (client) =>
          client.query('select public.list_client_finance_self_v2()')))
          .rejects.toThrow('trainer_finance_forbidden')

        const overview = await withActorTransaction(runtimePool, ACTOR_ID, (client) =>
          client.query<JsonResultRow>(
            `select public.list_trainer_finance_overview_v2(date '2026-09-01') as result`,
          ))
        expect(overview[0]?.result).toMatchObject({
          month: '2026-09', receivedCents: 2500000, dueCents: 0,
          attentionCount: 0,
        })
        const overviewClients = (overview[0]?.result as { clients?: unknown[] }).clients
        expect(overviewClients).toContainEqual(expect.objectContaining({
          clientId: CLIENT_ID, fullName: 'Shared client', activePackageCount: 1, upcomingPackageCount: 0,
          sessionsRemaining: 8, overdue: false, unassignedSessions: 0,
        }))

        const events = await withActorTransaction(runtimePool, ACTOR_ID, (client) =>
          client.query<{ entity_type: string; event_type: string }>(
            `select entity_type, event_type
             from public.trainer_finance_events
             order by id`,
          ))
        expect(events).toEqual([
          { entity_type: 'package', event_type: 'created' },
          { entity_type: 'payment', event_type: 'created' },
          { entity_type: 'payment', event_type: 'created' },
        ])

        await expect(withActorTransaction(runtimePool, OUTSIDE_TRAINER_ID, (client) =>
          client.query(
            `select public.create_trainer_finance_service(
              $1, 'session_pack', 'Чужой пакет', 1, 0, 1000, 0,
              date '2026-09-01', null, null, null
            )`,
            [CLIENT_ID],
          ))).rejects.toThrow('trainer_finance_client_not_found')
        await expect(withActorTransaction(runtimePool, OTHER_ACTOR_ID, (client) =>
          client.query('select public.list_trainer_finance_client_v2($1)', [CLIENT_ID])))
          .rejects.toThrow('trainer_finance_forbidden')

        const hidden = await withActorTransaction(runtimePool, MEMBER_TRAINER_ID, (client) =>
          client.query('select id from public.trainer_finance_packages'))
        expect(hidden).toEqual([])
        const hiddenEvents = await withActorTransaction(runtimePool, MEMBER_TRAINER_ID, (client) =>
          client.query('select id from public.trainer_finance_events'))
        expect(hiddenEvents).toEqual([])
      } finally {
        await ownerPool.query('delete from public.trainer_finance_events where client_id = $1', [CLIENT_ID])
        await ownerPool.query('delete from public.trainer_finance_payments where client_id = $1', [CLIENT_ID])
        await ownerPool.query('delete from public.trainer_finance_sessions where client_id = $1', [CLIENT_ID])
        await ownerPool.query('delete from public.trainer_finance_packages where client_id = $1', [CLIENT_ID])
      }
    })

    it('keeps online coaching period-based and never consumes it on workout completion', async () => {
      if (ownerPool === undefined || runtimePool === undefined) {
        throw new Error('Database pools are not ready')
      }
      let workoutId: string | undefined
      await ownerPool.query('delete from public.trainer_finance_events where client_id = $1', [CLIENT_ID])
      await ownerPool.query('delete from public.trainer_finance_payments where client_id = $1', [CLIENT_ID])
      await ownerPool.query('delete from public.trainer_finance_sessions where client_id = $1', [CLIENT_ID])
      await ownerPool.query('delete from public.trainer_finance_packages where client_id = $1', [CLIENT_ID])
      try {
        const created = await withActorTransaction(runtimePool, ACTOR_ID, (client) =>
          client.query<JsonResultRow>(
            `select public.create_trainer_finance_service(
              $1, 'online_coaching', 'Онлайн-сопровождение', 0, 0, 1200000, 0,
              date '2026-10-01', date '2026-10-31', null, null
            ) as result`,
            [CLIENT_ID],
          ))
        expect(created[0]?.result).toMatchObject({
          clientId: CLIENT_ID, trainerId: ACTOR_ID, kind: 'online_coaching',
          sessionsTotal: 0, sessionsUsed: 0, sessionsRemaining: 0,
          startsOn: '2026-10-01', endsOn: '2026-10-31',
        })

        const clientFinance = await withActorTransaction(runtimePool, OTHER_ACTOR_ID, (client) =>
          client.query<JsonResultRow>('select public.list_client_finance_self_v2() as result'))
        expect(clientFinance[0]?.result).toMatchObject({ trainers: [{
          trainerId: ACTOR_ID,
          packages: [expect.objectContaining({ kind: 'online_coaching', title: 'Онлайн-сопровождение' })],
        }] })

        const workout = await ownerPool.query<{ id: string }>(
          `insert into public.workouts (
             trainer_id, client_id, created_by, workout_date, status, completed_at, notes, training_format
           ) values ($1, $2, $1, date '2026-10-15', 'done', now(), 'Онлайн без списания', 'with_trainer')
           returning id`,
          [ACTOR_ID, CLIENT_ID],
        )
        workoutId = workout.rows[0]!.id
        const sessionCount = await ownerPool.query<{ count: string }>(
          'select count(*) from public.trainer_finance_sessions where workout_id = $1',
          [workoutId],
        )
        expect(sessionCount.rows[0]?.count).toBe('0')

        await expect(withActorTransaction(runtimePool, OUTSIDE_TRAINER_ID, (client) =>
          client.query('select public.list_trainer_finance_client_v2($1)', [CLIENT_ID])))
          .rejects.toThrow('trainer_finance_client_not_found')
      } finally {
        await ownerPool.query('delete from public.trainer_finance_events where client_id = $1', [CLIENT_ID])
        await ownerPool.query('delete from public.trainer_finance_payments where client_id = $1', [CLIENT_ID])
        await ownerPool.query('delete from public.trainer_finance_sessions where client_id = $1', [CLIENT_ID])
        await ownerPool.query('delete from public.trainer_finance_packages where client_id = $1', [CLIENT_ID])
        if (workoutId) await ownerPool.query('delete from public.workouts where id = $1', [workoutId])
      }
    })

    it('charges the author service across client-owned partitions and stops after disconnect', async () => {
      if (!ownerPool || !runtimePool) throw new Error('Database pools are not ready')
      const clientId = randomUUID()
      await ownerPool.query(`insert into public.clients (id, trainer_id, auth_user_id, full_name)
        values ($1, $2, null, 'Finance author fixture')`, [clientId, OTHER_ACTOR_ID])
      await ownerPool.query(`insert into public.client_trainers (client_id, trainer_id)
        values ($1, $2), ($1, $3)`, [clientId, ACTOR_ID, MEMBER_TRAINER_ID])
      try {
        for (const actor of [ACTOR_ID, MEMBER_TRAINER_ID]) {
          await withActorTransaction(runtimePool, actor, (client) => client.query(
            `select public.create_trainer_finance_service($1, 'session_pack', 'Author package',
              5, 0, 100000, 0, date '2026-10-01', date '2026-10-31', null, null)`, [clientId]))
        }
        const draft: PlannedWorkoutDraft = { id: null, requestId: randomUUID(), clientId,
          workoutDate: '2026-10-02', startTime: null, endTime: null, notes: null, exercises: [] }
        const saved = await withActorTransaction(runtimePool, ACTOR_ID, (client) => saveCompletedWorkout(client, draft, null))
        const sessions = await ownerPool.query<{id: string; trainer_id: string; package_trainer: string}>(
          `select session.id, session.trainer_id, package.trainer_id as package_trainer
           from public.trainer_finance_sessions session join public.trainer_finance_packages package
           on package.id=session.package_id where session.workout_id=$1 and session.voided_at is null`, [saved.id])
        expect(sessions.rows).toHaveLength(1)
        expect(sessions.rows[0]?.trainer_id).toBe(ACTOR_ID)
        expect(sessions.rows[0]?.package_trainer).toBe(ACTOR_ID)
        await expect(withActorTransaction(runtimePool, MEMBER_TRAINER_ID, (client) => client.query(
          `select public.update_trainer_finance_session_details_v2($1,1,'free',null,null,date '2026-10-02')`,
          [sessions.rows[0]!.id]))).rejects.toThrow('trainer_finance_session_not_found')
        await withActorTransaction(runtimePool, ACTOR_ID, (client) => client.query(
          `select public.update_trainer_finance_session_details_v2($1,1,'free',null,null,date '2026-10-02')`,
          [sessions.rows[0]!.id]))
        const self = await withActorTransaction(runtimePool, ACTOR_ID, (client) => saveCompletedWorkout(client,
          {...draft, requestId: randomUUID(), trainingFormat: 'self'}, null))
        expect((await ownerPool.query('select id from public.trainer_finance_sessions where workout_id=$1 and voided_at is null', [self.id])).rowCount).toBe(0)
        const planned = await withActorTransaction(runtimePool, ACTOR_ID, (client) => savePlannedWorkout(client,
          {...draft, requestId: randomUUID(), trainingFormat: 'with_trainer'}, null))
        await ownerPool.query('delete from public.client_trainers where client_id=$1 and trainer_id=$2',[clientId, ACTOR_ID])
        await ownerPool.query("update public.workouts set status='done', completed_at=now() where id=$1",[planned.id])
        expect((await ownerPool.query('select id from public.trainer_finance_sessions where workout_id=$1', [planned.id])).rowCount).toBe(0)
        expect((await ownerPool.query('select id from public.trainer_finance_sessions where workout_id=$1', [saved.id])).rowCount).toBe(1)
      } finally {
        await ownerPool.query('delete from public.trainer_finance_events where client_id=$1',[clientId])
        await ownerPool.query('delete from public.trainer_finance_sessions where client_id=$1',[clientId])
        await ownerPool.query('delete from public.trainer_finance_payments where client_id=$1',[clientId])
        await ownerPool.query('delete from public.trainer_finance_packages where client_id=$1',[clientId])
        await ownerPool.query('delete from public.workouts where client_id=$1',[clientId])
        await ownerPool.query('delete from public.client_trainers where client_id=$1',[clientId])
        await ownerPool.query('delete from public.clients where id=$1',[clientId])
      }
    })

    it('saves manual accounting atomically and replays without losing the last slot', async () => {
      if (!ownerPool || !runtimePool) throw new Error('Database pools are not ready')
      const clientId = randomUUID()
      await ownerPool.query(`insert into public.clients(id,trainer_id,full_name) values($1,$2,'Manual finance fixture')`, [clientId, ACTOR_ID])
      const call = (requestId: string, disposition: string, packageId: string | null, actor = ACTOR_ID) =>
        withActorTransaction(runtimePool!, actor, (client) => client.query<{ session: { id: string; workoutId: string; disposition: string; comment: string; source: string } }>(
          `select public.create_trainer_finance_manual_session($1,$2,date '2026-10-02',$3,$4,'Занятие вне Fit') as session`,
          [clientId,requestId,disposition,packageId]))
      try {
        const requestId = randomUUID()
        const [first, replay] = await Promise.all([call(requestId,'unassigned',null),call(requestId,'unassigned',null)])
        expect(first).toEqual(replay)
        expect(first[0]?.session).toMatchObject({disposition:'unassigned',comment:'Занятие вне Fit',source:'manual'})
        await expect(call(requestId,'free',null)).rejects.toThrow('trainer_finance_conflict')
        await expect(call(randomUUID(),'free',null,OTHER_ACTOR_ID)).rejects.toThrow()
        await withActorTransaction(runtimePool,ACTOR_ID,(client)=>client.query(
          `select public.create_trainer_finance_service($1,'online_coaching','Онлайн',0,0,10000,0,date '2026-10-01',date '2026-10-31',null,null)`,[clientId]))
        for (const disposition of ['free','trial','unassigned']) {
          expect((await call(randomUUID(),disposition,null))[0]?.session.disposition).toBe(disposition)
        }
        const before = await ownerPool.query('select id from public.workouts where client_id=$1',[clientId])
        const failedRequest = randomUUID()
        await expect(call(failedRequest,'charged',randomUUID())).rejects.toThrow('trainer_finance_invalid')
        expect((await ownerPool.query('select id from public.workouts where client_id=$1',[clientId])).rowCount).toBe(before.rowCount)
        expect((await ownerPool.query('select * from app_private.finance_manual_requests where request_id=$1',[failedRequest])).rowCount).toBe(0)
        const pack = await withActorTransaction(runtimePool,ACTOR_ID,(client)=>client.query<{item:{id:string}}>(
          `select public.create_trainer_finance_service($1,'session_pack','Последнее занятие',1,0,10000,0,date '2026-10-01',date '2026-10-31',null,null) as item`,[clientId]))
        const chargedId = randomUUID()
        const charged = await call(chargedId,'charged',pack[0]!.item.id)
        expect((await call(chargedId,'charged',pack[0]!.item.id))).toEqual(charged)
        expect(charged[0]?.session.disposition).toBe('charged')
        // A regular completed-workout retry must preserve a defaulted last slot too.
        await ownerPool.query('update public.trainer_finance_packages set closed_at=now() where client_id=$1',[clientId])
        await withActorTransaction(runtimePool,ACTOR_ID,(client)=>client.query(
          `select public.create_trainer_finance_service($1,'session_pack','Один',1,0,10000,0,date '2026-10-01',date '2026-10-31',null,null)`,[clientId]))
        const draft: PlannedWorkoutDraft = {id:null,requestId:randomUUID(),clientId,workoutDate:'2026-10-02',startTime:null,endTime:null,notes:null,actualDurationSec:3000,exercises:[]}
        const saved = await withActorTransaction(runtimePool,ACTOR_ID,(client)=>saveCompletedWorkout(client,draft,null))
        const repeated = await withActorTransaction(runtimePool,ACTOR_ID,(client)=>saveCompletedWorkout(client,draft,null))
        expect(repeated).toEqual(saved)
        expect((await ownerPool.query<{actual_duration_sec:number;training_format:string}>(
          'select actual_duration_sec,training_format from public.workouts where id=$1',[saved.id])).rows).toEqual([{actual_duration_sec:3000,training_format:'with_trainer'}])
        expect((await ownerPool.query("select disposition from public.trainer_finance_sessions where workout_id=$1 and voided_at is null",[saved.id])).rows).toEqual([{disposition:'charged'}])
      } finally {
        await ownerPool.query("delete from app_private.finance_manual_requests where payload->>'clientId'=$1",[clientId])
        for (const table of ['trainer_finance_events','trainer_finance_sessions','trainer_finance_payments','trainer_finance_packages','workouts']) {
          await ownerPool.query(`delete from public.${table} where client_id=$1`,[clientId])
        }
        await ownerPool.query('delete from public.clients where id=$1',[clientId])
      }
    })

    it('revalidates completed dates without choosing another package or charging a plan', async () => {
      if (!ownerPool || !runtimePool) throw new Error('Database pools are not ready')
      const clientId = randomUUID()
      await ownerPool.query(`insert into public.clients(id,trainer_id,full_name) values($1,$2,'Finance dates fixture')`,[clientId,ACTOR_ID])
      try {
        const packs: string[] = []
        for (const [starts,ends] of [['2026-10-01','2026-10-31'],['2026-11-01','2026-11-30']]) {
          const rows = await withActorTransaction(runtimePool,ACTOR_ID,(client)=>client.query<{item:{id:string}}>(
            `select public.create_trainer_finance_service($1,'session_pack','Пакет',5,0,10000,0,$2,$3,null,null) as item`,[clientId,starts,ends]))
          packs.push(rows[0]!.item.id)
        }
        const created = await withActorTransaction(runtimePool,ACTOR_ID,(client)=>client.query<{s:{id:string;workoutId:string;version:number}}>(
          `select public.create_trainer_finance_manual_session($1,$2,date '2026-10-02','charged',$3,'Комментарий') as s`,[clientId,randomUUID(),packs[0]]))
        const session = created[0]!.s
        await ownerPool.query("update public.workouts set workout_date=date '2026-10-03' where id=$1",[session.workoutId])
        expect((await ownerPool.query('select package_id,version from public.trainer_finance_sessions where id=$1',[session.id])).rows[0]).toEqual({package_id:packs[0],version:String(session.version)})
        await ownerPool.query("update public.workouts set workout_date=date '2026-11-01' where id=$1",[session.workoutId])
        expect((await ownerPool.query('select package_id,disposition,comment from public.trainer_finance_sessions where id=$1',[session.id])).rows[0]).toEqual({package_id:null,disposition:'unassigned',comment:'Комментарий'})
        const details = await withActorTransaction(runtimePool,ACTOR_ID,(client)=>client.query<{s:{disposition:string;packageId:string}}>(
          `select public.update_trainer_finance_session_details_v2($1,$2,'charged',$3,'Комментарий',date '2026-11-02') as s`,[session.id,session.version+1,packs[1]]))
        expect(details[0]?.s).toMatchObject({disposition:'charged',packageId:packs[1]})
        const dateEdit = await withActorTransaction(runtimePool,ACTOR_ID,(client)=>client.query<{s:{disposition:string;packageId:null}}>(
          `select public.update_trainer_finance_session_details_v2($1,$2,'charged',$3,'Комментарий',date '2026-12-02') as s`,[session.id,session.version+2,packs[1]]))
        expect(dateEdit[0]?.s).toMatchObject({disposition:'unassigned',packageId:null})
        const planned = await withActorTransaction(runtimePool,ACTOR_ID,(client)=>savePlannedWorkout(client,{
          id:null,clientId,workoutDate:'2026-10-02',trainingFormat:'with_trainer',startTime:null,endTime:null,notes:null,exercises:[],
        },null))
        await ownerPool.query("update public.workouts set workout_date=date '2026-11-03' where id=$1",[planned.id])
        expect((await ownerPool.query('select id from public.trainer_finance_sessions where workout_id=$1',[planned.id])).rowCount).toBe(0)
      } finally {
        await ownerPool.query("delete from app_private.finance_manual_requests where payload->>'clientId'=$1",[clientId])
        for (const table of ['trainer_finance_events','trainer_finance_sessions','trainer_finance_payments','trainer_finance_packages','workouts']) {
          await ownerPool.query(`delete from public.${table} where client_id=$1`,[clientId])
        }
        await ownerPool.query('delete from public.clients where id=$1',[clientId])
      }
    })

    it('defaults the workout format from services and reverses finance on format changes', async () => {
      if (ownerPool === undefined || runtimePool === undefined) {
        throw new Error('Database pools are not ready')
      }
      const workoutIds: string[] = []
      await ownerPool.query('delete from public.trainer_finance_events where client_id = $1', [CLIENT_ID])
      await ownerPool.query('delete from public.trainer_finance_sessions where client_id = $1', [CLIENT_ID])
      await ownerPool.query('delete from public.trainer_finance_payments where client_id = $1', [CLIENT_ID])
      await ownerPool.query('delete from public.trainer_finance_packages where client_id = $1', [CLIENT_ID])
      try {
        await withActorTransaction(runtimePool, ACTOR_ID, (client) => client.query(
          `select public.create_trainer_finance_service(
            $1, 'session_pack', 'Абонемент', 5, 0, 500000, 0,
            date '2026-10-01', date '2026-10-31', null, null
          )`, [CLIENT_ID]))
        const workout = await ownerPool.query<{ id: string }>(
          `insert into public.workouts (trainer_id, client_id, created_by, workout_date, status)
           values ($1, $2, $1, date '2026-10-10', 'planned') returning id`,
          [ACTOR_ID, CLIENT_ID],
        )
        const workoutId = workout.rows[0]!.id
        workoutIds.push(workoutId)
        const defaulted = await withActorTransaction(runtimePool, ACTOR_ID, (client) =>
          client.query<{ version: string }>(
            `select public.set_workout_training_format($1, null, 1, true) as version`,
            [workoutId],
          ))
        expect(defaulted[0]?.version).toBe('2')
        expect((await ownerPool.query<{ training_format: string }>(
          'select training_format from public.workouts where id = $1', [workoutId],
        )).rows[0]?.training_format).toBe('with_trainer')

        await ownerPool.query(`update public.workouts set status = 'done', completed_at = now() where id = $1`, [workoutId])
        expect((await ownerPool.query<{ count: string }>(
          'select count(*) from public.trainer_finance_sessions where workout_id = $1 and voided_at is null', [workoutId],
        )).rows[0]?.count).toBe('1')
        const selfVersion = await withActorTransaction(runtimePool, ACTOR_ID, (client) =>
          client.query<{ version: string }>(
            `select public.set_workout_training_format($1, 'self', 2, false) as version`, [workoutId],
          ))
        expect(selfVersion[0]?.version).toBe('3')
        expect((await ownerPool.query<{ count: string }>(
          'select count(*) from public.trainer_finance_sessions where workout_id = $1 and voided_at is null', [workoutId],
        )).rows[0]?.count).toBe('0')
        await withActorTransaction(runtimePool, ACTOR_ID, (client) => client.query(
          `select public.set_workout_training_format($1, 'with_trainer', 3, false)`, [workoutId],
        ))
        expect((await ownerPool.query<{ count: string }>(
          'select count(*) from public.trainer_finance_sessions where workout_id = $1 and voided_at is null', [workoutId],
        )).rows[0]?.count).toBe('1')

        await withActorTransaction(runtimePool, ACTOR_ID, (client) => client.query(
          `select public.create_trainer_finance_service(
            $1, 'online_coaching', 'Онлайн', 0, 0, 500000, 0,
            date '2026-10-01', date '2026-10-31', null, null
          )`, [CLIENT_ID]))
        const onlineWorkout = await ownerPool.query<{ id: string }>(
          `insert into public.workouts (trainer_id, client_id, created_by, workout_date, status)
           values ($1, $2, $1, date '2026-10-11', 'planned') returning id`,
          [ACTOR_ID, CLIENT_ID],
        )
        workoutIds.push(onlineWorkout.rows[0]!.id)
        await withActorTransaction(runtimePool, ACTOR_ID, (client) => client.query(
          `select public.set_workout_training_format($1, null, 1, true)`, [onlineWorkout.rows[0]!.id],
        ))
        expect((await ownerPool.query<{ training_format: string }>(
          'select training_format from public.workouts where id = $1', [onlineWorkout.rows[0]!.id],
        )).rows[0]?.training_format).toBe('self')

        const clientWorkout = await ownerPool.query<{ id: string }>(
          `insert into public.workouts (trainer_id, client_id, created_by, workout_date, status)
           values ($1, $2, $3, date '2026-10-12', 'planned') returning id`,
          [ACTOR_ID, CLIENT_ID, OTHER_ACTOR_ID],
        )
        workoutIds.push(clientWorkout.rows[0]!.id)
        await withActorTransaction(runtimePool, OTHER_ACTOR_ID, (client) => client.query(
          `select public.set_workout_training_format($1, 'with_trainer', 1, false)`, [clientWorkout.rows[0]!.id],
        ))
        expect((await ownerPool.query<{ training_format: string }>(
          'select training_format from public.workouts where id = $1', [clientWorkout.rows[0]!.id],
        )).rows[0]?.training_format).toBe('self')
      } finally {
        await ownerPool.query('delete from public.trainer_finance_events where client_id = $1', [CLIENT_ID])
        await ownerPool.query('delete from public.trainer_finance_sessions where client_id = $1', [CLIENT_ID])
        await ownerPool.query('delete from public.trainer_finance_payments where client_id = $1', [CLIENT_ID])
        await ownerPool.query('delete from public.trainer_finance_packages where client_id = $1', [CLIENT_ID])
        if (workoutIds.length > 0) await ownerPool.query('delete from public.workouts where id = any($1::uuid[])', [workoutIds])
      }
    })

    it('consumes completed trainer workouts once and leaves ambiguous sessions for review', async () => {
      if (ownerPool === undefined || runtimePool === undefined) {
        throw new Error('Database pools are not ready')
      }
      const workoutIds: string[] = []
      await ownerPool.query('delete from public.trainer_finance_events where client_id = $1', [CLIENT_ID])
      await ownerPool.query('delete from public.trainer_finance_payments where client_id = $1', [CLIENT_ID])
      await ownerPool.query('delete from public.trainer_finance_sessions where client_id = $1', [CLIENT_ID])
      await ownerPool.query('delete from public.trainer_finance_packages where client_id = $1', [CLIENT_ID])
      try {
        const firstPackage = await withActorTransaction(runtimePool, ACTOR_ID, (client) =>
          client.query<JsonResultRow>(
            `select public.create_trainer_finance_service(
              $1, 'session_pack', 'Абонемент 1', 2, 0, 1000000, 0,
              date '2026-09-01', date '2026-09-30', null, null
            ) as result`,
            [CLIENT_ID],
          ))
        const firstPackageId = (firstPackage[0]?.result as { id: string }).id

        const completed = await ownerPool.query<{ id: string }>(
          `insert into public.workouts (
             trainer_id, client_id, created_by, workout_date, status,
             completed_at, notes, training_format
           ) values ($1, $2, $1, date '2026-09-15', 'done', now(), 'Финансы: автосписание', 'with_trainer')
           returning id`,
          [ACTOR_ID, CLIENT_ID],
        )
        const completedId = completed.rows[0]!.id
        workoutIds.push(completedId)
        const charged = await ownerPool.query<{
          disposition: string
          package_id: string | null
          source: string
          version: string
        }>(
          `select disposition, package_id, source, version
           from public.trainer_finance_sessions where workout_id = $1`,
          [completedId],
        )
        expect(charged.rows).toEqual([{
          disposition: 'charged', package_id: firstPackageId,
          source: 'automatic', version: '1',
        }])

        await ownerPool.query(
          `update public.workouts set status = 'done' where id = $1`,
          [completedId],
        )
        const idempotent = await ownerPool.query<{ count: string }>(
          'select count(*) from public.trainer_finance_sessions where workout_id = $1 and voided_at is null',
          [completedId],
        )
        expect(idempotent.rows[0]?.count).toBe('1')

        const selfLed = await ownerPool.query<{ id: string }>(
          `insert into public.workouts (
             trainer_id, client_id, created_by, workout_date, status,
             completed_at, notes
           ) values ($1, $2, $3, date '2026-09-16', 'done', now(), 'Финансы: самостоятельная')
           returning id`,
          [ACTOR_ID, CLIENT_ID, OTHER_ACTOR_ID],
        )
        workoutIds.push(selfLed.rows[0]!.id)
        const selfLedCount = await ownerPool.query<{ count: string }>(
          'select count(*) from public.trainer_finance_sessions where workout_id = $1',
          [selfLed.rows[0]!.id],
        )
        expect(selfLedCount.rows[0]?.count).toBe('0')

        await withActorTransaction(runtimePool, ACTOR_ID, (client) =>
          client.query(
            `select public.create_trainer_finance_service(
              $1, 'session_pack', 'Абонемент 2', 2, 0, 1000000, 0,
              date '2026-09-01', date '2026-09-30', null, null
            )`,
            [CLIENT_ID],
          ))
        const ambiguous = await ownerPool.query<{ id: string }>(
          `insert into public.workouts (
             trainer_id, client_id, created_by, workout_date, status,
             completed_at, notes, training_format
           ) values ($1, $2, $1, date '2026-09-17', 'done', now(), 'Финансы: неоднозначное', 'with_trainer')
           returning id`,
          [ACTOR_ID, CLIENT_ID],
        )
        const ambiguousId = ambiguous.rows[0]!.id
        workoutIds.push(ambiguousId)
        const pending = await ownerPool.query<{
          id: string
          disposition: string
          package_id: string | null
          version: string
        }>(
          `select id, disposition, package_id, version
           from public.trainer_finance_sessions where workout_id = $1`,
          [ambiguousId],
        )
        expect(pending.rows[0]).toMatchObject({
          disposition: 'unassigned', package_id: null, version: '1',
        })

        const corrected = await withActorTransaction(runtimePool, ACTOR_ID, (client) =>
          client.query<JsonResultRow>(
            `select public.update_trainer_finance_session(
              $1, 1, 'charged', $2, null
            ) as result`,
            [pending.rows[0]!.id, firstPackageId],
          ))
        expect(corrected[0]?.result).toMatchObject({
          disposition: 'charged', packageId: firstPackageId, version: 2,
        })

        await ownerPool.query(
          'update public.workouts set deleted_at = now() where id = $1',
          [completedId],
        )
        const voided = await ownerPool.query<{ void_reason: string | null }>(
          'select void_reason from public.trainer_finance_sessions where workout_id = $1',
          [completedId],
        )
        expect(voided.rows[0]?.void_reason).toBe('Тренировка больше не завершена')
      } finally {
        await ownerPool.query('delete from public.trainer_finance_events where client_id = $1', [CLIENT_ID])
        await ownerPool.query('delete from public.trainer_finance_payments where client_id = $1', [CLIENT_ID])
        await ownerPool.query('delete from public.trainer_finance_sessions where client_id = $1', [CLIENT_ID])
        await ownerPool.query('delete from public.trainer_finance_packages where client_id = $1', [CLIENT_ID])
        if (workoutIds.length > 0) {
          await ownerPool.query('delete from public.workouts where id = any($1::uuid[])', [workoutIds])
        }
      }
    })

    it('uses the active relationship for trainer and chat lists', async () => {
      if (ownerPool === undefined || runtimePool === undefined) {
        throw new Error('Database pools are not ready')
      }

      await ownerPool.query(
        `insert into public.client_trainer_relationships (
           client_id, trainer_id, connected_by
         ) values ($1, $2, $3)`,
        [CLIENT_ID, ACTOR_ID, OTHER_ACTOR_ID],
      )

      try {
        const connections = await withActorTransaction(
          runtimePool,
          OTHER_ACTOR_ID,
          readAccessibleConnections,
        )
        expect(connections.memberships).toEqual([
          expect.objectContaining({ clientId: CLIENT_ID, trainerId: ACTOR_ID }),
        ])

        const threads = await withActorTransaction(
          runtimePool,
          OTHER_ACTOR_ID,
          (client) => client.query<{
            trainer_id: string
            active_connection: boolean
            conversation_id: string | null
          }>('select trainer_id, active_connection, conversation_id from public.list_chat_threads()'),
        )
        expect(threads).toEqual([{
          trainer_id: ACTOR_ID,
          active_connection: true,
          conversation_id: null,
        }])
      } finally {
        await ownerPool.query(
          'delete from public.client_trainer_relationships where client_id = $1',
          [CLIENT_ID],
        )
      }
    })

    it.each([
      ['read_only', 'from public.workouts workout'],
      ['read_write', 'from public.workouts workout'],
      ['read_only', 'from public.workout_exercises'],
      ['read_write', 'from public.workout_exercises'],
    ] as const)('keeps one training snapshot for %s after %s', async (accessMode, boundary) => {
      if (ownerPool === undefined || runtimePool === undefined) {
        throw new Error('Database pools are not ready')
      }
      const db = runtimePool
      const url = new URL(requireLocalTestDatabaseUrl())
      url.username = 'fit_api'
      url.password = RUNTIME_PASSWORD
      const snapshotPool = new PgDatabasePool({ connectionString: url.toString(), max: 1 })
      const draft: PlannedWorkoutDraft = {
        id: null, clientId: CLIENT_ID, workoutDate: '2026-10-05',
        startTime: '10:00', endTime: '11:00', notes: 'Snapshot before',
        exercises: [{
          position: 0, source: 'system', ref: 'running', customExerciseId: null,
          name: 'Snapshot before', muscleGroup: 'cardio', inputKind: 'distance',
          blockId: randomUUID(), blockType: 'single', blockPreset: 'set', blockRounds: 1,
          restBetweenExercisesSec: 0, restBetweenRoundsSec: 90, restBetweenSetsSec: 90,
          trainerComment: null,
          sets: [{ position: 0, weightKg: null, reps: null, durationMin: 30,
            durationSec: 1800, distanceKm: 5, rpe: 7 }],
        }],
      }
      const created = await withActorTransaction(db, ACTOR_ID,
        (client) => savePlannedWorkout(client, draft, null))
      let tokenHash: string | undefined
      let saved = false
      try {
        await ownerPool.query(
          'update app_private.profile_rollout_assignments set access_mode = $2 where profile_id = $1',
          [ACTOR_ID, accessMode],
        )
        const issued = accessMode === 'read_write'
          ? await new DatabaseYandexAppSessionIssuer(db).issue(PILOT_SUBJECT_HASH)
          : await new DatabasePilotSessionIssuer(db).issue(PILOT_SUBJECT_HASH)
        if (issued === undefined) throw new Error('Fixture session was not issued')
        tokenHash = hashPilotSessionToken(issued.session.token)
        const pool: DatabasePool = {
          async connect() {
            const connection = await snapshotPool.connect()
            return {
              async query<Row extends QueryResultRow = QueryResultRow>(text: string, values?: readonly unknown[]) {
                const rows = await connection.query<Row>(text, values)
                if (!saved && text.includes(boundary)) {
                  saved = true
                  const exercise = draft.exercises[0]
                  const set = exercise?.sets[0]
                  if (exercise === undefined || set === undefined) throw new Error('Missing fixture exercise')
                  // Commit an actual aggregate replacement between the reader's SELECTs.
                  await withActorTransaction(db, ACTOR_ID, (client) => savePlannedWorkout(client, {
                    ...draft, id: created.id, notes: 'Snapshot after',
                    exercises: [{ ...exercise, name: 'Snapshot after', sets: [{ ...set, distanceKm: 8 }] }],
                  }, created.version))
                }
                return rows
              },
              release() { connection.release() },
            }
          },
          end: () => snapshotPool.end(),
        }
        const session: YandexActorSession = { accessMode, token: issued.session.token }
        const reader = new DatabasePilotTrainingDataReader(pool)
        const during = await reader.readTrainingData(session)
        expect(saved).toBe(true)
        expect(during.workouts.find((item) => item.id === created.id)).toMatchObject({
          version: 1, notes: 'Snapshot before',
          exercises: [{ name: 'Snapshot before', sets: [{ plan: { distanceKm: 5 } }] }],
        })
        expect(during.workouts.some((item) => item.id === MEMBER_WORKOUT_ID)).toBe(false)
        const after = await reader.readTrainingData(session)
        expect(after.workouts.find((item) => item.id === created.id)).toMatchObject({
          version: 2, notes: 'Snapshot after',
          exercises: [{ name: 'Snapshot after', sets: [{ plan: { distanceKm: 8 } }] }],
        })
        expect(await readActor(snapshotPool)).toBeNull()
        const connection = await snapshotPool.connect()
        try {
          const settings = await connection.query<{
            isolation: string
            read_only: string
          }>(`select current_setting('transaction_isolation') as isolation,
            current_setting('transaction_read_only') as read_only`)
          expect(settings).toEqual([{ isolation: 'read committed', read_only: 'off' }])
        } finally {
          connection.release()
        }
      } finally {
        await snapshotPool.end()
        await ownerPool.query('delete from public.workouts where id = $1', [created.id])
        if (tokenHash !== undefined) {
          await ownerPool.query('delete from app_private.yandex_app_sessions where token_sha256 = $1', [tokenHash])
          await ownerPool.query('delete from app_private.yandex_pilot_sessions where token_sha256 = $1', [tokenHash])
        }
        await ownerPool.query(
          "update app_private.profile_rollout_assignments set access_mode = 'read_only' where profile_id = $1",
          [ACTOR_ID],
        )
      }
    })

    it('aggregates client stats over more than 100 roots without reading exercises or sets', async () => {
      if (ownerPool === undefined || runtimePool === undefined) throw new Error('Database pools are not ready')
      const fixtureClientId = 'c8000000-0000-4000-8000-000000000001'
      const db = runtimePool
      await ownerPool.query(`insert into public.clients (id, trainer_id, full_name)
        values ($1, $2, 'Stats fixture')`, [fixtureClientId, ACTOR_ID])
      await ownerPool.query(`insert into public.client_trainers (client_id, trainer_id) values ($1, $2)`, [fixtureClientId, ACTOR_ID])
      const read = (today: string) => withActorTransaction(db, ACTOR_ID,
        (client) => readClientWorkoutStats(client, fixtureClientId, today))
      try {
        expect(await read('2026-10-06')).toEqual({ doneCount: 0, completionPercent: null, lastWorkoutDate: null, daysInWork: null, needsAttention: false })
        await ownerPool.query(`insert into public.workouts (trainer_id, client_id, created_by, workout_date, status)
          values ($1,$2,$1,'2026-10-07','planned')`, [ACTOR_ID, fixtureClientId])
        expect(await read('2026-10-06')).toEqual({ doneCount: 0, completionPercent: null, lastWorkoutDate: null, daysInWork: 0, needsAttention: false })
        await ownerPool.query(`insert into public.workouts (trainer_id, client_id, created_by, workout_date, status, completed_at)
          select $1, $2, $1, date '2026-09-01', 'done', '2026-09-01T10:00:00Z'::timestamptz
          from generate_series(1, 120)`, [ACTOR_ID, fixtureClientId])
        await ownerPool.query(`insert into public.workouts (trainer_id, client_id, created_by, workout_date, status, deleted_at, started_at, completed_at)
          values ($1,$2,$1,'2026-09-02','planned',null,null,null),
            ($1,$2,$1,'2026-10-06','planned',null,null,null), ($1,$2,$1,'2026-10-07','planned',null,null,null),
            ($1,$2,$1,'2026-10-07','cancelled',null,null,null),
            ($1,$2,$1,'2026-09-03','in_progress',null,'2026-09-03T10:00:00Z',null),
            ($1,$2,$1,'2020-01-01','done',now(),null,'2020-01-01T10:00:00Z')`, [ACTOR_ID, fixtureClientId])
        const statements: string[] = []
        const stats = await withActorTransaction(db, ACTOR_ID, (client) => readClientWorkoutStats({
          query(text, values) {
            statements.push(text)
            return client.query(text, values)
          },
        }, fixtureClientId, '2026-10-06'))
        expect(stats).toEqual({ doneCount: 120, completionPercent: 98, lastWorkoutDate: '2026-09-01', daysInWork: 35, needsAttention: true })
        expect(statements).toHaveLength(1)
        expect(statements[0]).not.toMatch(/workout_exercises|workout_sets/)
        expect(await read('2026-09-14')).toMatchObject({ needsAttention: false })
        expect(await read('2026-09-15')).toMatchObject({ needsAttention: true })
        await expect(withActorTransaction(runtimePool, OUTSIDE_TRAINER_ID,
          (client) => readClientWorkoutStats(client, fixtureClientId, '2026-10-06'))).rejects.toMatchObject({ failure: 'not_found' })
      } finally {
        await ownerPool.query('delete from public.workouts where client_id = $1', [fixtureClientId])
        await ownerPool.query('delete from public.client_trainers where client_id = $1', [fixtureClientId])
        await ownerPool.query('delete from public.clients where id = $1', [fixtureClientId])
      }
    })

    it('keeps client stats scoped to workout author and client RLS', async () => {
      if (runtimePool === undefined) throw new Error('Runtime pool is not ready')
      const db = runtimePool
      for (const actorId of [ACTOR_ID, MEMBER_TRAINER_ID, OTHER_ACTOR_ID]) {
        const summaries = await withActorTransaction(db, actorId, (client) => client.query<{ workout_date: string; status: string } & QueryResultRow>(`
          select workout_date::text, status from public.workouts where client_id = $1 and deleted_at is null`, [CLIENT_ID]))
        const expectedDone = summaries.filter((item) => item.status === 'done')
        const expectedMissed = summaries.filter((item) => item.status === 'cancelled' || (item.status === 'planned' && item.workout_date < '2026-10-06'))
        const stats = await withActorTransaction(db, actorId, (client) => readClientWorkoutStats(client, CLIENT_ID, '2026-10-06'))
        expect(stats.doneCount).toBe(expectedDone.length)
        expect(stats.completionPercent).toBe(expectedDone.length + expectedMissed.length === 0 ? null
          : Math.round(expectedDone.length / (expectedDone.length + expectedMissed.length) * 100))
      }
    })

    it('pages filtered workout history beyond 100 rows without loading metadata or deleted roots', async () => {
      if (ownerPool === undefined || runtimePool === undefined) throw new Error('Database pools are not ready')
      const ids = Array.from({ length: 103 }, (_, index) =>
        `c5000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`)
      const otherClientId = 'c7000000-0000-4000-8000-000000000001'
      const otherWorkoutId = 'c7000000-0000-4000-8000-000000000002'
      await ownerPool.query(`
        insert into public.clients (id, trainer_id, full_name)
        values ($1, $2, 'Pagination fixture')
      `, [otherClientId, ACTOR_ID])
      await ownerPool.query(`insert into public.client_trainers (client_id, trainer_id) values ($1, $2)`,
        [otherClientId, ACTOR_ID])
      await ownerPool.query(`
        insert into public.workouts (id, trainer_id, client_id, created_by, workout_date, status)
        values ($1, $2, $3, $2, date '2026-02-01', 'planned')
      `, [otherWorkoutId, ACTOR_ID, otherClientId])
      await ownerPool.query(`
        insert into public.workouts (id, trainer_id, client_id, created_by, workout_date, status, deleted_at)
        select id, $2::uuid, $3::uuid, $2::uuid, date '2026-01-01' + (position::int - 1),
          'planned', case when position = 103 then now() else null end
        from unnest($1::uuid[]) with ordinality as fixture(id, position)
      `, [ids, ACTOR_ID, CLIENT_ID])
      try {
        const db = runtimePool
        const otherDetail = await withActorTransaction(db, ACTOR_ID,
          (client) => readAccessibleTrainingData(client, { limit: 1, offset: 0, workoutId: otherWorkoutId }))
        expect(otherDetail.workouts.map((item) => item.id)).toEqual([otherWorkoutId])
        const readPage = (offset: number) => withActorTransaction(db, ACTOR_ID,
          (client) => readAccessibleTrainingData(client, {
            limit: 20, offset, clientId: CLIENT_ID, from: '2026-01-01', to: '2026-04-30', scope: 'workouts',
          }))
        const first = await readPage(0)
        const second = await readPage(20)
        const last = await readPage(100)
        const beyond = await readPage(120)
        expect(first.workouts.map((item) => item.id)).toEqual(ids.slice(82, 102).reverse())
        expect(second.workouts.map((item) => item.id)).toEqual(ids.slice(62, 82).reverse())
        expect(first).toMatchObject({
          totalWorkouts: 102, hasMoreWorkouts: true, customExercises: [], attention: [], attentionPreferences: [],
        })
        expect(last.workouts.map((item) => item.id)).toEqual(ids.slice(0, 2).reverse())
        expect(last).toMatchObject({ totalWorkouts: 102, hasMoreWorkouts: false })
        expect(beyond).toMatchObject({ workouts: [], totalWorkouts: 102, hasMoreWorkouts: false })
        const old = await withActorTransaction(db, ACTOR_ID, (client) => readAccessibleTrainingData(client, {
          limit: 1, offset: 0, workoutId: ids[0]!, scope: 'workouts',
        }))
        expect(old.workouts.map((item) => item.id)).toEqual([ids[0]])
        const sameDay = await withActorTransaction(db, ACTOR_ID, (client) => readAccessibleTrainingData(client, {
          limit: 20, offset: 0, clientId: CLIENT_ID, from: '2026-01-01', to: '2026-01-01', scope: 'workouts',
        }))
        expect(sameDay.workouts.map((item) => item.id)).toEqual([ids[0]])
        const deleted = await withActorTransaction(db, ACTOR_ID, (client) => readAccessibleTrainingData(client, {
          limit: 1, offset: 0, workoutId: ids[102]!, scope: 'workouts',
        }))
        expect(deleted.workouts).toEqual([])
      } finally {
        await ownerPool.query('delete from public.workouts where id = any($1::uuid[])', [ids])
        await ownerPool.query('delete from public.workouts where id = $1', [otherWorkoutId])
        await ownerPool.query('delete from public.client_trainers where client_id = $1', [otherClientId])
        await ownerPool.query('delete from public.clients where id = $1', [otherClientId])
      }
    })

    it('preserves author and tenant RLS for filtered lists and direct workout IDs', async () => {
      if (runtimePool === undefined) throw new Error('Runtime pool is not ready')
      for (const actorId of [MEMBER_TRAINER_ID, OUTSIDE_TRAINER_ID]) {
        const detail = await withActorTransaction(runtimePool, actorId,
          (client) => readAccessibleTrainingData(client, {
            limit: 1, offset: 0, clientId: CLIENT_ID, workoutId: ROOT_WORKOUT_ID, scope: 'workouts',
          }))
        expect(detail).toMatchObject({ workouts: [], totalWorkouts: 0, hasMoreWorkouts: false })
      }
      const clientDetail = await withActorTransaction(runtimePool, OTHER_ACTOR_ID,
        (client) => readAccessibleTrainingData(client, {
          limit: 1, offset: 0, workoutId: ROOT_WORKOUT_ID, scope: 'workouts',
        }))
      expect(clientDetail.workouts[0]).toMatchObject({
        id: ROOT_WORKOUT_ID, exercises: [{ ref: 'running', sets: [{ plan: { distanceKm: 5 } }] }],
      })
    })

    it('reads metadata without selecting workout roots or their children', async () => {
      if (runtimePool === undefined) throw new Error('Runtime pool is not ready')
      const statements: string[] = []
      const metadata = await withActorTransaction(runtimePool, ACTOR_ID, (client) => readAccessibleTrainingData({
        query: <Row extends QueryResultRow>(text: string, values?: readonly unknown[]) => {
          statements.push(text)
          return client.query<Row>(text, values)
        },
      }, { limit: 1, offset: 0, scope: 'metadata' }))
      expect(metadata.workouts).toEqual([])
      expect(metadata.customExercises).toMatchObject([{ id: ROOT_CUSTOM_EXERCISE_ID }])
      expect(statements.some((text) => text.includes('from public.workouts workout')
        || text.includes('from public.workout_exercises') || text.includes('from public.workout_sets'))).toBe(false)
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
      expect(clientData.customExercises).toMatchObject([
        {
          id: ROOT_CUSTOM_EXERCISE_ID,
          name: 'Тяга саней',
          createdBy: ACTOR_ID,
        },
      ])
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

    it('preserves client ownership for custom exercises in a shared partition', async () => {
      if (ownerPool === undefined || runtimePool === undefined) {
        throw new Error('Database pools are not ready')
      }
      const draft = {
        name: 'Клиентская тяга блока',
        muscleGroup: 'back' as const,
        inputKind: 'strength' as const,
      }
      const exercise = await withActorTransaction(
        runtimePool,
        OTHER_ACTOR_ID,
        (client) => createCustomExercise(client, draft),
      )
      try {
        const stored = await ownerPool.query<{
          created_by: string
          trainer_id: string
        } & QueryResultRow>(
          'select created_by, trainer_id from public.custom_exercises where id = $1',
          [exercise.id],
        )
        expect(stored.rows).toEqual([{
          created_by: OTHER_ACTOR_ID,
          trainer_id: ACTOR_ID,
        }])

        const updated = await withActorTransaction(
          runtimePool,
          OTHER_ACTOR_ID,
          (client) => updateCustomExercise(
            client,
            exercise.id,
            { ...draft, name: 'Клиентская тяга блока с паузой' },
            1,
          ),
        )
        expect(updated).toMatchObject({
          name: 'Клиентская тяга блока с паузой',
          version: 2,
        })

        for (const actorId of [ACTOR_ID, MEMBER_TRAINER_ID, OTHER_ACTOR_ID]) {
          const data = await withActorTransaction(
            runtimePool,
            actorId,
            readAccessibleTrainingData,
          )
          expect(data.customExercises).toEqual(expect.arrayContaining([
            expect.objectContaining({
              id: exercise.id,
              createdBy: OTHER_ACTOR_ID,
            }),
          ]))
        }
        const outside = await withActorTransaction(
          runtimePool,
          OUTSIDE_TRAINER_ID,
          readAccessibleTrainingData,
        )
        expect(outside.customExercises.some((item) => item.id === exercise.id)).toBe(false)
        await expect(withActorTransaction(
          runtimePool,
          OUTSIDE_TRAINER_ID,
          (client) => updateCustomExercise(client, exercise.id, draft, 2),
        )).rejects.toMatchObject({ failure: 'forbidden' })

        const archived = await withActorTransaction(
          runtimePool,
          OTHER_ACTOR_ID,
          (client) => setCustomExerciseArchived(client, exercise.id, true, 2),
        )
        expect(archived).toMatchObject({ version: 3 })
        expect(archived.archivedAt).not.toBeNull()
      } finally {
        await ownerPool.query(
          'delete from public.custom_exercises where id = $1',
          [exercise.id],
        )
      }
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

    it('recovers the canonical own client instead of returning a create conflict', async () => {
      if (ownerPool === undefined || runtimePool === undefined) {
        throw new Error('Database pools are not ready')
      }

      await ownerPool.query(
        `
          insert into public.profiles (id, first_name, account_role)
          values ($1, 'Quick own recovery', 'client')
        `,
        [QUICK_OWN_RECOVERY_ACTOR_ID],
      )
      await ownerPool.query(
        `
          insert into public.clients (id, trainer_id, full_name)
          values ($1, $2, 'Canonical own client')
        `,
        [QUICK_OWN_RECOVERY_CANONICAL_ID, ACTOR_ID],
      )
      await ownerPool.query(
        `
          insert into public.clients (
            id, trainer_id, auth_user_id, full_name, archived_at, merged_into_client_id
          ) values ($1, $2, $2, 'Stale merged own client', now(), $3)
        `,
        [
          QUICK_OWN_RECOVERY_SOURCE_ID,
          QUICK_OWN_RECOVERY_ACTOR_ID,
          QUICK_OWN_RECOVERY_CANONICAL_ID,
        ],
      )

      try {
        const recovered = await withActorTransaction(
          runtimePool,
          QUICK_OWN_RECOVERY_ACTOR_ID,
          (client) => createQuickOwnClientCard(client, 'Quick own recovery'),
        )
        expect(recovered).toEqual({
          id: QUICK_OWN_RECOVERY_CANONICAL_ID,
          version: 2,
          membershipVersion: 1,
        })

        await expect(withActorTransaction(
          runtimePool,
          QUICK_OWN_RECOVERY_ACTOR_ID,
          (client) => createQuickOwnClientCard(client, 'Ignored retry name'),
        )).resolves.toEqual(recovered)

        const linked = await ownerPool.query<{
          id: string
          auth_user_id: string | null
          archived_at: Date | null
        }>(
          `
            select id, auth_user_id, archived_at
            from public.clients
            where id in ($1, $2)
            order by id
          `,
          [QUICK_OWN_RECOVERY_SOURCE_ID, QUICK_OWN_RECOVERY_CANONICAL_ID],
        )
        expect(linked.rows).toEqual(expect.arrayContaining([
          expect.objectContaining({
            id: QUICK_OWN_RECOVERY_SOURCE_ID,
            auth_user_id: null,
          }),
          expect.objectContaining({
            id: QUICK_OWN_RECOVERY_CANONICAL_ID,
            auth_user_id: QUICK_OWN_RECOVERY_ACTOR_ID,
            archived_at: null,
          }),
        ]))

        await ownerPool.query(
          'update public.clients set archived_at = now() where id = $1',
          [QUICK_OWN_RECOVERY_CANONICAL_ID],
        )
        await expect(withActorTransaction(
          runtimePool,
          QUICK_OWN_RECOVERY_ACTOR_ID,
          (client) => createQuickOwnClientCard(client, 'Restore own client'),
        )).resolves.toMatchObject({
          id: QUICK_OWN_RECOVERY_CANONICAL_ID,
          version: 3,
        })

        const accessible = await withActorTransaction(
          runtimePool,
          QUICK_OWN_RECOVERY_ACTOR_ID,
          (client) => readAccessibleClients(client),
        )
        expect(accessible.clients.map((client) => client.id))
          .toEqual([QUICK_OWN_RECOVERY_CANONICAL_ID])
      } finally {
        await ownerPool.query(
          'delete from public.clients where id = $1',
          [QUICK_OWN_RECOVERY_SOURCE_ID],
        )
        await ownerPool.query(
          'delete from public.clients where id = $1',
          [QUICK_OWN_RECOVERY_CANONICAL_ID],
        )
        await ownerPool.query(
          'delete from public.profiles where id = $1',
          [QUICK_OWN_RECOVERY_ACTOR_ID],
        )
      }
    })

    it('creates and claims a client link atomically through the Yandex database', async () => {
      if (ownerPool === undefined || runtimePool === undefined) {
        throw new Error('Database pools are not ready')
      }

      await ownerPool.query(
        `
          insert into public.profiles (id, first_name, account_role)
          values ($1, 'Link merge client', 'client')
          on conflict (id) do update set account_role = excluded.account_role
        `,
        [LINK_MERGE_CLIENT_ACTOR_ID],
      )
      await ownerPool.query(
        `
          insert into public.clients (id, trainer_id, auth_user_id, full_name)
          values ($1, $2, $2, 'Canonical link client')
          on conflict (id) do update set
            trainer_id = excluded.trainer_id,
            auth_user_id = excluded.auth_user_id,
            archived_at = null,
            merged_into_client_id = null
        `,
        [LINK_MERGE_CANONICAL_CLIENT_ID, LINK_MERGE_CLIENT_ACTOR_ID],
      )

      let sourceClientId: string | undefined
      try {
        const created = await withActorTransaction(
          runtimePool,
          ACTOR_ID,
          (client) => createNewClientInvitationShare(
            client,
            'Карточка от тренера',
            LINK_MERGE_OPERATION_ID,
          ),
        )
        sourceClientId = created.clientId

        await expect(withActorTransaction(
          runtimePool,
          ACTOR_ID,
          (client) => createNewClientInvitationShare(
            client,
            'Карточка от тренера',
            LINK_MERGE_OPERATION_ID,
          ),
        )).resolves.toEqual(created)

        const cardAndInvitation = await ownerPool.query<{
          card_count: string
          invitation_count: string
        }>(
          `
            select
              (select count(*) from public.clients where id = $1)::text as card_count,
              (select count(*) from public.client_invitations
               where client_id = $1 and link_token_hash is not null)::text as invitation_count
          `,
          [sourceClientId],
        )
        expect(cardAndInvitation.rows[0]).toEqual({ card_count: '1', invitation_count: '1' })

        await ownerPool.query(
          `
            insert into public.workouts (
              id, trainer_id, client_id, created_by, workout_date, status
            ) values ($1, $2, $3, $2, date '2026-10-01', 'planned')
          `,
          [LINK_MERGE_WORKOUT_ID, ACTOR_ID, sourceClientId],
        )

        await expect(withActorTransaction(
          runtimePool,
          LINK_MERGE_CLIENT_ACTOR_ID,
          (client) => claimClientInvitationLink(client, created.share.token),
        )).resolves.toBe(LINK_MERGE_CANONICAL_CLIENT_ID)
        await expect(withActorTransaction(
          runtimePool,
          LINK_MERGE_CLIENT_ACTOR_ID,
          (client) => claimClientInvitationLink(client, created.share.token),
        )).resolves.toBe(LINK_MERGE_CANONICAL_CLIENT_ID)

        const merged = await ownerPool.query<{
          archived_at: Date | null
          merged_into_client_id: string | null
        }>('select archived_at, merged_into_client_id from public.clients where id = $1', [sourceClientId])
        expect(merged.rows[0]?.archived_at).not.toBeNull()
        expect(merged.rows[0]?.merged_into_client_id).toBe(LINK_MERGE_CANONICAL_CLIENT_ID)

        const workout = await ownerPool.query<{ client_id: string }>(
          'select client_id from public.workouts where id = $1',
          [LINK_MERGE_WORKOUT_ID],
        )
        expect(workout.rows[0]?.client_id).toBe(LINK_MERGE_CANONICAL_CLIENT_ID)
      } finally {
        await ownerPool.query('delete from public.workouts where id = $1', [LINK_MERGE_WORKOUT_ID])
        await ownerPool.query(
          'delete from public.client_merge_operations where actor_id = $1',
          [LINK_MERGE_CLIENT_ACTOR_ID],
        )
        await ownerPool.query(
          'delete from public.client_trainer_relationships where client_id = $1',
          [LINK_MERGE_CANONICAL_CLIENT_ID],
        )
        await ownerPool.query(
          'delete from public.client_trainers where client_id = any($1::uuid[])',
          [[LINK_MERGE_CANONICAL_CLIENT_ID, sourceClientId].filter(Boolean)],
        )
        if (sourceClientId !== undefined) {
          await ownerPool.query('delete from public.clients where id = $1', [sourceClientId])
        }
        await ownerPool.query(
          'delete from public.clients where id = $1',
          [LINK_MERGE_CANONICAL_CLIENT_ID],
        )
        await ownerPool.query(
          'delete from public.profiles where id = $1',
          [LINK_MERGE_CLIENT_ACTOR_ID],
        )
      }
    })

    it('keeps the link untouched when the client must disconnect a trainer first', async () => {
      if (ownerPool === undefined || runtimePool === undefined) {
        throw new Error('Database pools are not ready')
      }

      await ownerPool.query(
        `
          insert into public.profiles (id, first_name, account_role)
          values ($1, 'Link conflict client', 'client')
          on conflict (id) do update set account_role = excluded.account_role
        `,
        [LINK_CONFLICT_CLIENT_ACTOR_ID],
      )
      await ownerPool.query(
        `
          insert into public.clients (id, trainer_id, auth_user_id, full_name)
          values ($1, $2, $2, 'Conflict link client')
          on conflict (id) do update set
            trainer_id = excluded.trainer_id,
            auth_user_id = excluded.auth_user_id,
            archived_at = null,
            merged_into_client_id = null
        `,
        [LINK_CONFLICT_CANONICAL_CLIENT_ID, LINK_CONFLICT_CLIENT_ACTOR_ID],
      )
      await ownerPool.query(
        `
          insert into public.client_trainer_relationships (
            client_id, trainer_id, connected_by
          ) values ($1, $2, $3)
        `,
        [LINK_CONFLICT_CANONICAL_CLIENT_ID, OUTSIDE_TRAINER_ID, LINK_CONFLICT_CLIENT_ACTOR_ID],
      )

      let sourceClientId: string | undefined
      try {
        const created = await withActorTransaction(
          runtimePool,
          ACTOR_ID,
          (client) => createNewClientInvitationShare(
            client,
            'Новая карточка без потерь',
            LINK_CONFLICT_OPERATION_ID,
          ),
        )
        sourceClientId = created.clientId

        await expect(withActorTransaction(
          runtimePool,
          LINK_CONFLICT_CLIENT_ACTOR_ID,
          (client) => claimClientInvitationLink(client, created.share.token),
        )).rejects.toMatchObject({ failure: 'trainer_disconnect_required' })

        const unchanged = await ownerPool.query<{
          archived_at: Date | null
          claimed_at: Date | null
        }>(
          `
            select client.archived_at, invitation.claimed_at
            from public.clients client
            join public.client_invitations invitation on invitation.client_id = client.id
            where client.id = $1 and invitation.id = $2
          `,
          [sourceClientId, created.share.id],
        )
        expect(unchanged.rows[0]).toEqual({ archived_at: null, claimed_at: null })
      } finally {
        await ownerPool.query(
          'delete from public.client_trainer_relationships where client_id = $1',
          [LINK_CONFLICT_CANONICAL_CLIENT_ID],
        )
        if (sourceClientId !== undefined) {
          await ownerPool.query('delete from public.clients where id = $1', [sourceClientId])
        }
        await ownerPool.query(
          'delete from public.clients where id = $1',
          [LINK_CONFLICT_CANONICAL_CLIENT_ID],
        )
        await ownerPool.query(
          'delete from public.profiles where id = $1',
          [LINK_CONFLICT_CLIENT_ACTOR_ID],
        )
      }
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
      expect(first.trainerProfileSessionToken).toMatch(/^[A-Za-z0-9_-]{43}$/)
      expect(first.trainerProfileSessionExpiresAt).toBe(expectedExpiry.toISOString())

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
            primaryMuscleDetail: 'Широчайшие',
            equipment: 'Сани',
            description: 'Сохраняйте нейтральное положение спины.',
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
            origin: 'manual',
            favoriteTitle: null,
            title: null,
            trainingFormat: 'self',
            startedBy: null,
            completedBy: null,
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
            actualDurationSec: null,
            activeCaloriesKcal: null,
            calorieEstimateVersion: null,
            calorieEstimateBasis: null,
            calorieEstimateNotice: 'Для оценки нужен вес на дату тренировки.',
            version: 1,
            stageId: null,
            stageTitle: null,
            hasPr: false,
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
                clientNote: null,
                sets: [
                  {
                    id: smokeIds.strengthSetId,
                    position: 0,
                    metricSources: { duration: 'unknown', distance: 'unknown', rpe: 'unknown' },
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
                clientNote: null,
                sets: [
                  {
                    id: smokeIds.runningSetId,
                    position: 0,
                    metricSources: { duration: 'unknown', distance: 'unknown', rpe: 'unknown' },
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

    it('keeps original pilot plans while anchoring new executions and retries to actual start dates', async () => {
      if (!ownerPool || !runtimePool) throw new Error('Database pools are not ready')
      const db = runtimePool
      const pilotHash = '2'.repeat(64)
      const exercises: PlannedWorkoutDraft['exercises'] = [{
        position: 0, source: 'custom', ref: `custom:${ROOT_CUSTOM_EXERCISE_ID}`, customExerciseId: ROOT_CUSTOM_EXERCISE_ID,
        name: 'Тяга саней', muscleGroup: 'legs', inputKind: 'strength', blockId: randomUUID(),
        blockType: 'single', blockPreset: 'set', blockRounds: 1, restBetweenExercisesSec: 0,
        restBetweenRoundsSec: 0, restBetweenSetsSec: 0, trainerComment: null,
        sets: [{ position: 0, weightKg: 20, reps: 10, durationMin: null, durationSec: null, distanceKm: null, rpe: null }],
      }]
      await ownerPool.query('insert into app_private.fit_lime_pilot_allowlist (login_sha256, profile_id, enabled) values ($1,$2,true)', [pilotHash, ACTOR_ID])
      const ids: string[] = []
      try {
        const dates = await ownerPool.query<{ today: string; past: string; future: string }>(
          "select app_private.client_today($1)::text as today, (app_private.client_today($1)-2)::text as past, (app_private.client_today($1)+2)::text as future", [CLIENT_ID])
        const datesRow = dates.rows[0]!
        for (const planDate of [datesRow.past, datesRow.today, datesRow.future]) {
          const saved = await withActorTransaction(db, ACTOR_ID, (client) => savePlannedWorkout(client, {
            id: null, requestId: randomUUID(), clientId: CLIENT_ID, title: 'Проверка даты',
            workoutDate: planDate, startTime: '12:00', endTime: '13:00', notes: null, exercises,
          }, null))
          ids.push(saved.id)
          const operation = randomUUID()
          await expect(withActorTransaction(db, OUTSIDE_TRAINER_ID, (client) => startLiveWorkout(client, saved.id, saved.version, randomUUID()))).rejects.toThrow()
          const started = await withActorTransaction(db, ACTOR_ID, (client) => startLiveWorkout(client, saved.id, saved.version, operation))
          await expect(withActorTransaction(db, ACTOR_ID, (client) => startLiveWorkout(client, saved.id, saved.version, operation))).resolves.toEqual({ ...started, replayed: true })
          await withActorTransaction(db, ACTOR_ID, (client) => finishLiveWorkout(client, saved.id, started.version, randomUUID()))
          const read = await withActorTransaction(db, ACTOR_ID, readAccessibleTrainingData)
          expect(read.workouts.find((item) => item.id === saved.id)).toMatchObject({
            status: 'done', workoutDate: datesRow.today, plannedDate: planDate,
            plannedStartTime: '12:00:00', plannedEndTime: '13:00:00', endTime: null,
          })
          const regularity = await withActorTransaction(db, ACTOR_ID, (client) =>
            client.query<{ result: Array<{ periodStart: string; periodEnd: string; completedCount: number }> }>('select public.get_workout_regularity($1) result', [CLIENT_ID]))
          for (const period of regularity[0]!.result) {
            expect(period.completedCount).toBe(read.workouts.filter((item) => item.clientId === CLIENT_ID
              && item.status === 'done' && item.workoutDate >= period.periodStart && item.workoutDate <= period.periodEnd).length)
          }
        }
        // Same date rule either side of Moscow midnight; completion cannot
        // overwrite the start-day anchor.
        const midnight = await ownerPool.query<{ before: string; after: string }>(
          "select app_private.workout_client_local_time($1,'2026-10-03 20:59:59Z')::date::text as before, app_private.workout_client_local_time($1,'2026-10-03 21:00:01Z')::date::text as after", [CLIENT_ID])
        expect(midnight.rows[0]).toEqual({ before: '2026-10-03', after: '2026-10-04' })
        const late = await withActorTransaction(db, ACTOR_ID, (client) => savePlannedWorkout(client, {
          id: null, requestId: randomUUID(), clientId: CLIENT_ID, title: 'Через полночь',
          workoutDate: datesRow.future, startTime: '12:00', endTime: '13:00', notes: null, exercises,
        }, null))
        ids.push(late.id)
        // Owner-only synthetic clock fixture, never a production clock override.
        await ownerPool.query('begin')
        try {
          await ownerPool.query("select set_config('request.jwt.claim.sub',$1,true)", [ACTOR_ID])
          await ownerPool.query("update public.workouts set status='in_progress', started_at='2026-10-03 20:59:59Z', started_by=$2, version=version+1 where id=$1", [late.id, ACTOR_ID])
          await ownerPool.query("update public.workouts set status='done', completed_at='2026-10-03 21:10:00Z', completed_by=$2, version=version+1 where id=$1", [late.id, ACTOR_ID])
          await ownerPool.query('commit')
        } catch (cause) { await ownerPool.query('rollback'); throw cause }
        const lateRead = await withActorTransaction(db, ACTOR_ID, readAccessibleTrainingData)
        expect(lateRead.workouts.find((item) => item.id === late.id)).toMatchObject({
          workoutDate: '2026-10-03', startTime: '23:59:59', plannedDate: datesRow.future,
          completedAt: '2026-10-03T21:10:00.000Z', status: 'done',
        })
        const control = await withActorTransaction(db, ACTOR_ID, (client) => savePlannedWorkout(client, {
          id: null, requestId: randomUUID(), clientId: CLIENT_ID, title: 'Контроль без флага',
          workoutDate: datesRow.future, startTime: '12:00', endTime: '13:00', notes: null, exercises,
        }, null))
        ids.push(control.id)
        await ownerPool.query('update app_private.fit_lime_pilot_allowlist set enabled=false where login_sha256=$1', [pilotHash])
        const started = await withActorTransaction(db, ACTOR_ID, (client) => startLiveWorkout(client, control.id, control.version, randomUUID()))
        await withActorTransaction(db, ACTOR_ID, (client) => finishLiveWorkout(client, control.id, started.version, randomUUID()))
        const legacy = await withActorTransaction(db, ACTOR_ID, readAccessibleTrainingData)
        const workout = legacy.workouts.find((item) => item.id === control.id)
        expect(workout).toMatchObject({ workoutDate: datesRow.future, startTime: '12:00:00', endTime: '13:00:00' })
        expect(workout).not.toHaveProperty('plannedDate')
      } finally {
        await ownerPool.query('delete from public.workouts where id=any($1::uuid[])', [ids])
        await ownerPool.query('delete from app_private.fit_lime_pilot_allowlist where login_sha256=$1', [pilotHash])
      }
    })

    it('keeps Lime plan titles, empty creation and retry receipts actor-scoped', async () => {
      if (!ownerPool || !runtimePool) throw new Error('Database pools are not ready')
      const db = runtimePool
      const pilotHash = '1'.repeat(64)
      await ownerPool.query(`insert into app_private.fit_lime_pilot_allowlist
        (login_sha256, profile_id, enabled) values ($1, $2, true)`, [pilotHash, ACTOR_ID])
      const draft: PlannedWorkoutDraft = {
        id: null, requestId: randomUUID(), clientId: CLIENT_ID, title: 'Всё тело',
        workoutDate: '2026-09-24', startTime: '12:00', endTime: null,
        notes: null, exercises: [],
      }
      let savedId: string | undefined
      try {
        const saved = await withActorTransaction(db, ACTOR_ID, (client) => savePlannedWorkout(client, draft, null))
        savedId = saved.id
        const read = await withActorTransaction(db, ACTOR_ID, readAccessibleTrainingData)
        expect(read.workouts.find((item) => item.id === saved.id)).toMatchObject({ title: 'Всё тело', status: 'planned', exercises: [] })
        const edited = await withActorTransaction(db, ACTOR_ID, (client) => savePlannedWorkout(client, { ...draft, id: saved.id, title: 'Ноги' }, saved.version))
        const replay = await withActorTransaction(db, ACTOR_ID, (client) => savePlannedWorkout(client, draft, null))
        expect(replay).toEqual(edited)
        const afterRetry = await withActorTransaction(db, ACTOR_ID, readAccessibleTrainingData)
        expect(afterRetry.workouts.find((item) => item.id === saved.id)?.title).toBe('Ноги')
        const oldClientDraft = { ...draft }
        delete oldClientDraft.title
        const preserved = await withActorTransaction(db, ACTOR_ID, (client) => savePlannedWorkout(client, { ...oldClientDraft, id: saved.id }, edited.version))
        const readPreserved = await withActorTransaction(db, ACTOR_ID, readAccessibleTrainingData)
        expect(readPreserved.workouts.find((item) => item.id === saved.id)?.title).toBe('Ноги')
        await expect(withActorTransaction(db, ACTOR_ID, (client) => savePlannedWorkout(client, { ...draft, id: saved.id }, saved.version))).rejects.toThrow()
        await expect(withActorTransaction(db, OTHER_ACTOR_ID, (client) => savePlannedWorkout(client, { ...draft, id: saved.id }, preserved.version))).rejects.toThrow()
        await withActorTransaction(db, ACTOR_ID, (client) => savePlannedWorkout(client, { ...draft, id: saved.id, title: null }, preserved.version))
        const cleared = await withActorTransaction(db, ACTOR_ID, readAccessibleTrainingData)
        expect(cleared.workouts.find((item) => item.id === saved.id)?.title).toBeNull()
        await ownerPool.query('update app_private.fit_lime_pilot_allowlist set enabled=false where login_sha256=$1', [pilotHash])
        await expect(withActorTransaction(db, ACTOR_ID, (client) => savePlannedWorkout(client, { ...draft, requestId: randomUUID() }, null))).rejects.toThrow()
      } finally {
        if (savedId) await ownerPool.query('delete from public.workouts where id=$1', [savedId])
        await ownerPool.query('delete from app_private.fit_lime_pilot_allowlist where login_sha256=$1', [pilotHash])
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

    it('snapshots a favorite title at creation and never touches it again', async () => {
      if (ownerPool === undefined || runtimePool === undefined) {
        throw new Error('Database pools are not ready')
      }

      const draft: PlannedWorkoutDraft = {
        id: null,
        clientId: CLIENT_ID,
        workoutDate: '2026-08-26',
        startTime: null,
        endTime: null,
        notes: null,
        favoriteTitle: ' Ноги и спина ',
        exercises: [{
          position: 0,
          source: 'custom',
          ref: `custom:${ROOT_CUSTOM_EXERCISE_ID}`,
          customExerciseId: ROOT_CUSTOM_EXERCISE_ID,
          name: 'Тяга саней',
          muscleGroup: 'legs',
          inputKind: 'strength',
          blockId: 'bd2c5ddb-5dc8-4cdb-b463-8b0f03f8f2cc',
          blockType: 'single',
          blockPreset: 'set',
          blockRounds: 1,
          restBetweenExercisesSec: 0,
          restBetweenRoundsSec: 90,
          restBetweenSetsSec: 90,
          trainerComment: null,
          sets: [{
            position: 0, weightKg: 40, reps: 10, durationMin: null, durationSec: null, distanceKm: null, rpe: 7,
          }],
        }],
      }

      const created = await withActorTransaction(
        runtimePool,
        ACTOR_ID,
        (client) => savePlannedWorkout(client, draft, null),
      )

      const afterCreate = await ownerPool.query<{ favorite_title: string | null } & QueryResultRow>(
        'select favorite_title from public.workouts where id = $1',
        [created.id],
      )
      expect(afterCreate.rows).toEqual([{ favorite_title: 'Ноги и спина' }])

      // A later edit of the same workout must not change the snapshot - the
      // request does not even carry favoriteTitle for an update.
      const updated = await withActorTransaction(
        runtimePool,
        ACTOR_ID,
        (client) => savePlannedWorkout(client, { ...draft, id: created.id, notes: 'Правка плана' }, created.version),
      )
      expect(updated.version).toBe(2)
      const afterUpdate = await ownerPool.query<{ favorite_title: string | null } & QueryResultRow>(
        'select favorite_title from public.workouts where id = $1',
        [created.id],
      )
      expect(afterUpdate.rows).toEqual([{ favorite_title: 'Ноги и спина' }])

      await ownerPool.query('delete from public.workouts where id = $1', [created.id])
    })

    it('corrects only duration for the athlete and accessible trainer history without rewriting the plan', async () => {
      if (!ownerPool || !runtimePool) throw new Error('Database pools are not ready')
      const athleteId = randomUUID()
      const clientId = randomUUID()
      await ownerPool.query("insert into public.profiles(id,first_name,account_role) values($1,'Duration athlete','client')", [athleteId])
      await ownerPool.query("insert into public.clients(id,trainer_id,auth_user_id,full_name) values($1,$2,$3,'Duration fixture')", [clientId, ACTOR_ID, athleteId])
      const draft: PlannedWorkoutDraft = {
        id: null, clientId, workoutDate: '2026-10-02', startTime: '23:30', endTime: '00:30', notes: 'Unchanged plan',
        exercises: [{
          position: 0, source: 'system', ref: 'stationary-bike', customExerciseId: null,
          name: 'Велотренажёр', muscleGroup: 'cardio', inputKind: 'duration',
          blockId: randomUUID(), blockType: 'single', blockPreset: 'set', blockRounds: 1,
          restBetweenExercisesSec: 0, restBetweenRoundsSec: 0, restBetweenSetsSec: 0, trainerComment: 'Unchanged instruction',
          sets: [{ position: 0, weightKg: null, reps: null, durationSec: 1200, durationMin: null,
            distanceKm: 8, rpe: 6, metricSources: { duration: 'entered', distance: 'entered', rpe: 'entered' } }],
        }],
      }
      const created = await withActorTransaction(runtimePool, ACTOR_ID, (client) => saveCompletedWorkout(client, draft, null))
      try {
        const snapshot = async () => (await ownerPool!.query<Record<string, unknown>>(`select workout_date,start_time,end_time,started_at,completed_at,
          notes,created_by,training_format,(select jsonb_agg(to_jsonb(e) order by e.position) from public.workout_exercises e where e.workout_id=w.id) as exercises,
          (select jsonb_agg(to_jsonb(s) order by s.position) from public.workout_sets s join public.workout_exercises e on e.id=s.workout_exercise_id where e.workout_id=w.id) as sets
          from public.workouts w where id=$1`, [created.id])).rows[0]
        const before = await snapshot()
        const correction = (actorId: string, seconds: number | null, version: number) =>
          withActorTransaction(runtimePool!, actorId, (client) => setWorkoutActualDuration(client, created.id, seconds, version))
        await expect(correction(OUTSIDE_TRAINER_ID, 3000, created.version)).rejects.toMatchObject({ failure: 'forbidden' })
        const version = await correction(athleteId, 3000, created.version)
        expect(version).toBe(created.version + 1)
        await expect(correction(athleteId, 3000, created.version)).resolves.toBe(version)
        await expect(correction(ACTOR_ID, 2400, created.version)).rejects.toMatchObject({ failure: 'conflict' })
        await expect(correction(athleteId, 0, version)).rejects.toMatchObject({ failure: 'invalid' })
        await expect(withActorTransaction(runtimePool, athleteId,
          (client) => saveCompletedWorkout(client, { ...draft, id: created.id, notes: 'Not allowed' }, version))).rejects.toMatchObject({ failure: 'forbidden' })
        expect(await snapshot()).toEqual(before)
        const calories = await ownerPool.query<{ actual_duration_sec: number | null; calorie_v2_shadow_details: unknown }>('select actual_duration_sec,calorie_v2_shadow_details from public.workouts where id=$1', [created.id])
        expect(calories.rows[0]).toMatchObject({ actual_duration_sec: 3000, calorie_v2_shadow_details: { elapsedSeconds: 3000 } })
        const cleared = await correction(ACTOR_ID, null, version)
        expect(await snapshot()).toEqual(before)
        expect((await ownerPool.query<{ actual_duration_sec: number | null }>('select actual_duration_sec from public.workouts where id=$1', [created.id])).rows[0]?.actual_duration_sec).toBeNull()
        // A trainer may correct visible athlete-authored history, not another trainer's assignment.
        await ownerPool.query('update public.workouts set created_by=$2 where id=$1', [created.id, athleteId])
        await ownerPool.query('insert into public.client_trainers(client_id,trainer_id) values($1,$2)', [clientId, OUTSIDE_TRAINER_ID])
        const historyVersion = await correction(OUTSIDE_TRAINER_ID, 3600, cleared)
        await ownerPool.query('delete from public.client_trainers where client_id=$1 and trainer_id=$2', [clientId, OUTSIDE_TRAINER_ID])
        await expect(correction(OUTSIDE_TRAINER_ID, 3500, historyVersion)).rejects.toMatchObject({ failure: 'forbidden' })
        await ownerPool.query("update public.workouts set status='planned',started_at=null,completed_at=null where id=$1", [created.id])
        await expect(correction(athleteId, 3500, historyVersion)).rejects.toMatchObject({ failure: 'invalid' })
        await ownerPool.query('update public.workouts set deleted_at=now() where id=$1', [created.id])
        await expect(correction(athleteId, 3500, historyVersion)).rejects.toMatchObject({ failure: 'forbidden' })
      } finally {
        await ownerPool.query('delete from public.workouts where id=$1', [created.id])
        await ownerPool.query('delete from public.client_trainers where client_id=$1', [clientId])
        await ownerPool.query('delete from public.clients where id=$1', [clientId])
        await ownerPool.query('delete from public.profiles where id=$1', [athleteId])
      }
    })

    it('persists actual duration with authorization, replay safety, clearing and calorie recalculation', async () => {
      if (ownerPool === undefined || runtimePool === undefined) throw new Error('Database pools are not ready')
      const draft: PlannedWorkoutDraft = {
        id: null, requestId: 'f6477000-0000-4000-8000-000000000001',
        clientId: CLIENT_ID, workoutDate: '2026-08-20', startTime: '10:00', endTime: null,
        actualDurationSec: 3000, notes: null,
        exercises: [{
          position: 0, source: 'system', ref: 'stationary-bike', customExerciseId: null,
          name: 'Велотренажёр', muscleGroup: 'cardio', inputKind: 'duration',
          blockId: 'f6477000-0000-4000-8000-000000000002', blockType: 'single', blockPreset: 'set', blockRounds: 1,
          restBetweenExercisesSec: 0, restBetweenRoundsSec: 0, restBetweenSetsSec: 0, trainerComment: null,
          sets: [{ position: 0, weightKg: null, reps: null, durationMin: null, durationSec: 3000,
            distanceKm: 22.16, rpe: null, metricSources: { duration: 'entered', distance: 'entered', rpe: 'unknown' } }],
        }],
      }
      const created = await withActorTransaction(runtimePool, ACTOR_ID, (client) => saveCompletedWorkout(client, draft, null))
      try {
        await expect(withActorTransaction(runtimePool, ACTOR_ID,
          (client) => saveCompletedWorkout(client, { ...draft, actualDurationSec: 600 }, null))).resolves.toEqual(created)
        const stored = await ownerPool.query<{ actual_duration_sec: number | null; started_at: Date | null; completed_at: Date | null }>(
          'select actual_duration_sec, started_at, completed_at from public.workouts where id=$1', [created.id])
        expect(stored.rows[0]).toMatchObject({ actual_duration_sec: 3000, started_at: null })
        const distance = await ownerPool.query<{ fact_distance_km: string | null }>(
          'select fact_distance_km from public.workout_sets where workout_exercise_id in (select id from public.workout_exercises where workout_id=$1)', [created.id])
        expect(Number(distance.rows[0]?.fact_distance_km)).toBe(22.16)
        const edited: PlannedWorkoutDraft = { ...draft, id: created.id, actualDurationSec: 3600 }
        delete edited.requestId
        await expect(withActorTransaction(runtimePool, OUTSIDE_TRAINER_ID,
          (client) => saveCompletedWorkout(client, edited, created.version))).rejects.toMatchObject({ failure: 'forbidden' })
        const corrected = await withActorTransaction(runtimePool, ACTOR_ID,
          (client) => saveCompletedWorkout(client, edited, created.version))
        await expect(withActorTransaction(runtimePool, ACTOR_ID,
          (client) => saveCompletedWorkout(client, { ...edited, actualDurationSec: 1200 }, created.version))).rejects.toMatchObject({ failure: 'conflict' })
        const omittedDuration = { ...edited }
        delete omittedDuration.actualDurationSec
        const preserved = await withActorTransaction(runtimePool, ACTOR_ID,
          (client) => saveCompletedWorkout(client, omittedDuration, corrected.version))
        const afterEdit = await ownerPool.query<{ actual_duration_sec: number | null; completed_at: Date | null; calorie_v2_shadow_details: unknown }>(
          'select actual_duration_sec, completed_at, calorie_v2_shadow_details from public.workouts where id=$1', [created.id])
        expect(afterEdit.rows[0]?.actual_duration_sec).toBe(3600)
        expect(afterEdit.rows[0]?.calorie_v2_shadow_details).toMatchObject({ elapsedSeconds: 3600 })
        expect(afterEdit.rows[0]?.completed_at).toEqual(stored.rows[0]?.completed_at)
        const cleared = await withActorTransaction(runtimePool, ACTOR_ID,
          (client) => saveCompletedWorkout(client, { ...edited, actualDurationSec: null }, preserved.version))
        expect(cleared.version).toBeGreaterThan(preserved.version)
        expect((await ownerPool.query<{ actual_duration_sec: number | null }>('select actual_duration_sec from public.workouts where id=$1', [created.id])).rows[0]?.actual_duration_sec).toBeNull()
      } finally {
        await ownerPool.query('delete from app_private.workout_create_requests where request_id=$1', [draft.requestId])
        await ownerPool.query('delete from public.workouts where id=$1', [created.id])
      }
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
        fact_rpe_source: string
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
            workout_set.fact_weight_kg,
            workout_set.fact_rpe_source
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
        fact_rpe_source: 'planned',
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

    it('snapshots an accessible custom exercise across workout partitions', async () => {
      if (ownerPool === undefined || runtimePool === undefined) {
        throw new Error('Database pools are not ready')
      }

      const standaloneActorId = 'bee10000-0000-4000-8000-000000000001'
      const standaloneClientId = 'bee20000-0000-4000-8000-000000000002'
      const requestId = 'bee30000-0000-4000-8000-000000000003'
      const missingExerciseId = 'bee90000-0000-4000-8000-000000000009'
      await ownerPool.query(
        `
          insert into public.profiles (id, first_name, account_role)
          values ($1, 'Standalone client', 'client')
        `,
        [standaloneActorId],
      )
      await ownerPool.query(
        `
          insert into public.clients (
            id, trainer_id, auth_user_id, full_name, gender, age_years,
            height_cm
          ) values ($1, $2, $2, 'Standalone client', 'female', 30, 170)
        `,
        [standaloneClientId, standaloneActorId],
      )
      await ownerPool.query(
        `
          insert into public.client_trainers (client_id, trainer_id)
          values ($1, $2)
        `,
        [standaloneClientId, ACTOR_ID],
      )

      const draft: PlannedWorkoutDraft = {
        id: null,
        requestId,
        clientId: standaloneClientId,
        workoutDate: '2026-08-22',
        startTime: null,
        endTime: null,
        notes: 'Завершённая тренировка со своим упражнением',
        exercises: [{
          position: 0,
          source: 'custom',
          ref: ROOT_CUSTOM_EXERCISE_ID,
          customExerciseId: ROOT_CUSTOM_EXERCISE_ID,
          name: 'Подменённое название',
          muscleGroup: 'other',
          inputKind: 'reps',
          blockId: 'bee40000-0000-4000-8000-000000000004',
          blockType: 'single',
          blockPreset: 'set',
          blockRounds: 1,
          restBetweenExercisesSec: 0,
          restBetweenRoundsSec: 90,
          restBetweenSetsSec: 90,
          trainerComment: null,
          sets: [{
            position: 0,
            weightKg: 20,
            reps: 10,
            durationMin: null,
            durationSec: null,
            distanceKm: null,
            rpe: null,
          }],
        }],
      }

      try {
        const created = await withActorTransaction(
          runtimePool,
          ACTOR_ID,
          (client) => saveCompletedWorkout(client, draft, null),
        )
        await expect(withActorTransaction(
          runtimePool,
          ACTOR_ID,
          (client) => saveCompletedWorkout(client, draft, null),
        )).resolves.toEqual(created)

        const stored = await ownerPool.query<QueryResultRow & {
          custom_exercise_id: string | null
          exercise_name: string
          exercise_ref: string
          exercise_source: string
          input_kind: string
          muscle_group: string
          status: string
        }>(
          `
            select
              workout.status,
              exercise.exercise_source,
              exercise.exercise_ref,
              exercise.custom_exercise_id,
              exercise.exercise_name,
              exercise.muscle_group,
              exercise.input_kind
            from public.workouts workout
            join public.workout_exercises exercise
              on exercise.workout_id = workout.id
            where workout.id = $1
          `,
          [created.id],
        )
        expect(stored.rows).toEqual([{
          status: 'done',
          exercise_source: 'system',
          exercise_ref: `snapshot:custom:${ROOT_CUSTOM_EXERCISE_ID}`,
          custom_exercise_id: null,
          exercise_name: 'Тяга саней',
          muscle_group: 'legs',
          input_kind: 'strength',
        }])

        await expect(withActorTransaction(
          runtimePool,
          ACTOR_ID,
          (client) => saveCompletedWorkout(client, {
            ...draft,
            requestId: 'bee50000-0000-4000-8000-000000000005',
            exercises: [{
              ...draft.exercises[0]!,
              ref: missingExerciseId,
              customExerciseId: missingExerciseId,
            }],
          }, null),
        )).rejects.toMatchObject({ failure: 'not_found' })

        const workouts = await ownerPool.query<QueryResultRow & { count: string }>(
          'select count(*) from public.workouts where client_id = $1',
          [standaloneClientId],
        )
        expect(workouts.rows).toEqual([{ count: '1' }])
      } finally {
        await ownerPool.query(
          'delete from public.workouts where client_id = $1',
          [standaloneClientId],
        )
        await ownerPool.query(
          'delete from public.client_trainers where client_id = $1',
          [standaloneClientId],
        )
        await ownerPool.query(
          'delete from public.clients where id = $1',
          [standaloneClientId],
        )
        await ownerPool.query(
          'delete from public.profiles where id = $1',
          [standaloneActorId],
        )
      }
    })

    it('adds and replaces an accessible cross-partition custom exercise in Live', async () => {
      if (ownerPool === undefined || runtimePool === undefined) {
        throw new Error('Database pools are not ready')
      }

      const standaloneActorId = 'bef10000-0000-4000-8000-000000000001'
      const standaloneClientId = 'bef20000-0000-4000-8000-000000000002'
      const requestId = 'bef30000-0000-4000-8000-000000000003'
      const startOperationId = 'bef40000-0000-4000-8000-000000000004'
      const appendOperationId = 'bef50000-0000-4000-8000-000000000005'
      const replaceOperationId = 'bef60000-0000-4000-8000-000000000006'
      let workoutId: string | undefined
      let customExerciseId: string | undefined

      await ownerPool.query(
        `
          insert into public.profiles (id, first_name, account_role)
          values ($1, 'Live standalone client', 'client')
        `,
        [standaloneActorId],
      )
      await ownerPool.query(
        `
          insert into public.clients (
            id, trainer_id, auth_user_id, full_name, gender, age_years,
            height_cm
          ) values ($1, $2, $2, 'Live standalone client', 'female', 30, 170)
        `,
        [standaloneClientId, standaloneActorId],
      )
      await ownerPool.query(
        `
          insert into public.client_trainers (client_id, trainer_id)
          values ($1, $2)
        `,
        [standaloneClientId, ACTOR_ID],
      )

      const draft: PlannedWorkoutDraft = {
        id: null,
        requestId,
        clientId: standaloneClientId,
        workoutDate: '2026-08-23',
        startTime: null,
        endTime: null,
        notes: 'Live с упражнением из другого раздела данных',
        exercises: [{
          position: 0,
          source: 'system',
          ref: 'running',
          customExerciseId: null,
          name: 'Бег',
          muscleGroup: 'cardio',
          inputKind: 'distance',
          blockId: 'bef70000-0000-4000-8000-000000000007',
          blockType: 'single',
          blockPreset: 'set',
          blockRounds: 1,
          restBetweenExercisesSec: 0,
          restBetweenRoundsSec: 90,
          restBetweenSetsSec: 90,
          trainerComment: null,
          sets: [{
            position: 0,
            weightKg: null,
            reps: null,
            durationMin: 10,
            durationSec: 600,
            distanceKm: 2,
            rpe: null,
          }],
        }],
      }

      try {
        const planned = await withActorTransaction(
          runtimePool,
          ACTOR_ID,
          (client) => savePlannedWorkout(client, draft, null),
        )
        workoutId = planned.id

        await expect(withActorTransaction(
          runtimePool,
          ACTOR_ID,
          (client) => startLiveWorkout(
            client,
            planned.id,
            planned.version,
            startOperationId,
          ),
        )).resolves.toEqual({ version: 2, replayed: false })

        const createdCustomExercise = await withActorTransaction(
          runtimePool,
          ACTOR_ID,
          (client) => createCustomExercise(client, {
            name: 'Halo',
            muscleGroup: 'shoulders',
            inputKind: 'reps',
          }),
        )
        customExerciseId = createdCustomExercise.id
        const customExercise = {
          source: 'custom' as const,
          ref: `custom:${createdCustomExercise.id}`,
          customExerciseId: createdCustomExercise.id,
          name: 'Подменённое название',
          muscleGroup: 'other' as const,
          inputKind: 'reps' as const,
        }
        const appended = await withActorTransaction(
          runtimePool,
          ACTOR_ID,
          (client) => appendLiveExercise(
            client,
            planned.id,
            customExercise,
            2,
            appendOperationId,
          ),
        )
        expect(appended).toMatchObject({ version: 3, replayed: false })

        const originalExercise = await ownerPool.query<{ id: string }>(
          `
            select id
            from public.workout_exercises
            where workout_id = $1 and id <> $2
          `,
          [planned.id, appended.resourceId],
        )
        const originalExerciseId = originalExercise.rows[0]?.id
        if (originalExerciseId === undefined) {
          throw new Error('Original Live exercise is missing')
        }

        await expect(withActorTransaction(
          runtimePool,
          ACTOR_ID,
          (client) => replaceLiveExercise(
            client,
            planned.id,
            originalExerciseId,
            customExercise,
            3,
            replaceOperationId,
          ),
        )).resolves.toEqual({
          resourceId: originalExerciseId,
          version: 4,
          replayed: false,
        })

        const stored = await ownerPool.query<QueryResultRow & {
          custom_exercise_id: string | null
          exercise_name: string
          exercise_ref: string
          exercise_source: string
          input_kind: string
          muscle_group: string
        }>(
          `
            select
              exercise_source,
              exercise_ref,
              custom_exercise_id,
              exercise_name,
              muscle_group,
              input_kind
            from public.workout_exercises
            where workout_id = $1
            order by position
          `,
          [planned.id],
        )
        expect(stored.rows).toEqual(Array.from({ length: 2 }, () => ({
          exercise_source: 'system',
          exercise_ref: `snapshot:custom:${createdCustomExercise.id}`,
          custom_exercise_id: null,
          exercise_name: 'Halo',
          muscle_group: 'shoulders',
          input_kind: 'reps',
        })))
      } finally {
        await ownerPool.query(
          `
            delete from app_private.live_workout_operations
            where actor_id = $1 and operation_id = any($2::uuid[])
          `,
          [ACTOR_ID, [startOperationId, appendOperationId, replaceOperationId]],
        )
        if (workoutId !== undefined) {
          await ownerPool.query(
            'delete from public.workouts where id = $1',
            [workoutId],
          )
        }
        if (customExerciseId !== undefined) {
          await ownerPool.query(
            'delete from public.custom_exercises where id = $1',
            [customExerciseId],
          )
        }
        await ownerPool.query(
          'delete from public.client_trainers where client_id = $1',
          [standaloneClientId],
        )
        await ownerPool.query(
          'delete from public.clients where id = $1',
          [standaloneClientId],
        )
        await ownerPool.query(
          'delete from public.profiles where id = $1',
          [standaloneActorId],
        )
      }
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
            distanceKm: 5.01225,
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
            distanceKm: 5.21234,
            rpe: 8,
            metricSources: { duration: 'entered', distance: 'entered', rpe: 'entered' },
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
        fact_duration_source: string
        fact_distance_source: string
        fact_rpe_source: string
        status: string
      }>(
        `
          select workout.status, workout.client_comment,
            workout_set.plan_distance_km, workout_set.fact_distance_km,
            workout_set.fact_duration_source, workout_set.fact_distance_source,
            workout_set.fact_rpe_source
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
        fact_distance_km: '5.21234',
        plan_distance_km: '5.01225',
        fact_duration_source: 'entered',
        fact_distance_source: 'entered',
        fact_rpe_source: 'entered',
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

    it('keeps the selected quick-start format across replay and resume', async () => {
      if (!ownerPool || !runtimePool) throw new Error('Database pools are not ready')
      const clientId = randomUUID()
      await ownerPool.query(`insert into public.clients(id,trainer_id,full_name) values($1,$2,'Quick format fixture')`,[clientId,ACTOR_ID])
      try {
        for (const format of ['with_trainer','self'] as const) {
          const operationId = randomUUID()
          const first = await withActorTransaction(runtimePool,ACTOR_ID,(client)=>quickStartLiveWorkout(client,clientId,operationId,format))
          const opposite = format === 'self' ? 'with_trainer' : 'self'
          expect(await withActorTransaction(runtimePool,ACTOR_ID,(client)=>quickStartLiveWorkout(client,clientId,operationId,opposite))).toEqual({id:first.id,resumed:true})
          const row = (await ownerPool.query<{training_format:string;version:string}>('select training_format,version from public.workouts where id=$1',[first.id])).rows[0]!
          expect(row.training_format).toBe(format)
          await withActorTransaction(runtimePool,ACTOR_ID,(client)=>cancelEmptyLiveWorkout(client,first.id,Number(row.version)))
        }
      } finally {
        await ownerPool.query('delete from public.workouts where client_id=$1',[clientId])
        await ownerPool.query('delete from public.clients where id=$1',[clientId])
      }
    })

    it('quick-starts atomically, resumes by trainer and client, and rejects empty completion', async () => {
      if (!ownerPool || !runtimePool) throw new Error('Database pools are not ready')
      await ownerPool.query('delete from public.workouts where client_id = $1', [QUICK_START_CLIENT_ID])
      await ownerPool.query('delete from public.clients where id = $1', [QUICK_START_CLIENT_ID])
      await ownerPool.query('delete from public.profiles where id = $1', [QUICK_START_ACTOR_ID])
      await ownerPool.query(
        `insert into public.profiles (id, first_name, account_role)
         values ($1, 'Quick start client', 'client')`, [QUICK_START_ACTOR_ID],
      )
      await ownerPool.query(
        `insert into public.clients (id, trainer_id, auth_user_id, full_name)
         values ($1, $2, $3, 'Quick start fixture')`,
        [QUICK_START_CLIENT_ID, ACTOR_ID, QUICK_START_ACTOR_ID],
      )
      try {
        const first = await withActorTransaction(runtimePool, ACTOR_ID, (client) =>
          quickStartLiveWorkout(client, QUICK_START_CLIENT_ID, QUICK_START_OPERATION_IDS.trainer))
        expect(first.id).toMatch(/^[0-9a-f-]{36}$/)
        expect(first.resumed).toBe(false)
        const replay = await withActorTransaction(runtimePool, ACTOR_ID, (client) =>
          quickStartLiveWorkout(client, QUICK_START_CLIENT_ID, QUICK_START_OPERATION_IDS.trainer))
        expect(replay).toEqual({ id: first.id, resumed: true })
        const resumed = await withActorTransaction(runtimePool, QUICK_START_ACTOR_ID, (client) =>
          quickStartLiveWorkout(client, null, QUICK_START_OPERATION_IDS.client))
        expect(resumed).toEqual({ id: first.id, resumed: true })
        await expect(withActorTransaction(runtimePool, OUTSIDE_TRAINER_ID, (client) =>
          quickStartLiveWorkout(client, QUICK_START_CLIENT_ID, QUICK_START_OPERATION_IDS.second)))
          .rejects.toMatchObject({ failure: 'forbidden' })
        await ownerPool.query(
          'insert into public.client_trainers (client_id, trainer_id) values ($1, $2)',
          [QUICK_START_CLIENT_ID, OUTSIDE_TRAINER_ID],
        )
        await expect(withActorTransaction(runtimePool, OUTSIDE_TRAINER_ID, (client) =>
          quickStartLiveWorkout(client, QUICK_START_CLIENT_ID, QUICK_START_OPERATION_IDS.second)))
          .rejects.toMatchObject({ failure: 'active' })
        const otherTrainerView = await withActorTransaction(runtimePool, OUTSIDE_TRAINER_ID, (client) =>
          client.query<{ id: string }>('select id from public.workouts where id = $1', [first.id]))
        expect(otherTrainerView).toEqual([])
        await expect(withActorTransaction(runtimePool, ACTOR_ID, (client) =>
          finishLiveWorkout(client, first.id, 1, QUICK_START_OPERATION_IDS.finish)))
          .rejects.toMatchObject({ failure: 'invalid' })
        await withActorTransaction(runtimePool, ACTOR_ID, (client) => cancelEmptyLiveWorkout(client, first.id, 1))
        const second = await withActorTransaction(runtimePool, ACTOR_ID, (client) =>
          quickStartLiveWorkout(client, QUICK_START_CLIENT_ID, QUICK_START_OPERATION_IDS.second))
        expect(second.resumed).toBe(false)
        expect(second.id).not.toBe(first.id)
        await withActorTransaction(runtimePool, ACTOR_ID, (client) => cancelEmptyLiveWorkout(client, second.id, 1))
        const clientStarted = await withActorTransaction(runtimePool, QUICK_START_ACTOR_ID, (client) =>
          quickStartLiveWorkout(client, null, QUICK_START_OPERATION_IDS.clientSecond, 'with_trainer'))
        expect((await ownerPool.query<{training_format:string}>('select training_format from public.workouts where id=$1',[clientStarted.id])).rows[0]?.training_format).toBe('self')
        const connectedTrainerView = await withActorTransaction(runtimePool, OUTSIDE_TRAINER_ID, (client) =>
          client.query<{ id: string }>('select id from public.workouts where id = $1', [clientStarted.id]))
        expect(connectedTrainerView).toEqual([{ id: clientStarted.id }])
        const trainerResumed = await withActorTransaction(runtimePool, ACTOR_ID, (client) =>
          quickStartLiveWorkout(client, QUICK_START_CLIENT_ID, QUICK_START_OPERATION_IDS.trainerSecond))
        expect(trainerResumed).toEqual({ id: clientStarted.id, resumed: true })
        const connectedTrainerResumed = await withActorTransaction(runtimePool, OUTSIDE_TRAINER_ID, (client) =>
          quickStartLiveWorkout(client, QUICK_START_CLIENT_ID, QUICK_START_OPERATION_IDS.second))
        expect(connectedTrainerResumed).toEqual({ id: clientStarted.id, resumed: true })
        await expect(withActorTransaction(runtimePool, ACTOR_ID, (client) =>
          finishLiveWorkout(client, clientStarted.id, 1, QUICK_START_OPERATION_IDS.finish)))
          .rejects.toMatchObject({ failure: 'invalid' })
        await expect(withActorTransaction(runtimePool, ACTOR_ID, (client) =>
          cancelEmptyLiveWorkout(client, clientStarted.id, 1)))
          .resolves.toBe(2)
      } finally {
        await ownerPool.query('delete from public.workouts where client_id = $1', [QUICK_START_CLIENT_ID])
        await ownerPool.query('delete from public.clients where id = $1', [QUICK_START_CLIENT_ID])
        await ownerPool.query('delete from public.profiles where id = $1', [QUICK_START_ACTOR_ID])
      }
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
            started_by = null,
            completed_at = null,
            completed_by = null,
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
            started_by = null,
            completed_at = null,
            completed_by = null,
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

        const startedActors = await ownerPool.query<WorkoutExecutionAuditRow>(
          'select started_by, completed_by from public.workouts where id = $1',
          [ROOT_WORKOUT_ID],
        )
        expect(startedActors.rows).toEqual([{
          started_by: OTHER_ACTOR_ID,
          completed_by: null,
        }])

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
          distanceKm: 5.25001,
          rpe: 7.5,
          metricSources: { duration: 'entered' as const, distance: 'entered' as const, rpe: 'entered' as const },
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
              fact_duration_source, fact_distance_source, fact_rpe_source,
              updated_by, version
            from public.workout_sets
            where id = $1
          `,
          [ROOT_WORKOUT_SET_ID],
        )
        expect(setRows.rows).toMatchObject([{
          fact_distance_km: '5.25001',
          fact_duration_sec: 1650,
          fact_rpe: '7.5',
          fact_duration_source: 'entered',
          fact_distance_source: 'entered',
          fact_rpe_source: 'entered',
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
          startedBy: OTHER_ACTOR_ID,
          completedBy: OTHER_ACTOR_ID,
          version: 3,
          exercises: [{
            sets: [{
              fact: { durationSec: 1650, distanceKm: 5.25001, rpe: 7.5 },
              version: 3,
            }],
          }],
        })

        const completedActors = await ownerPool.query<WorkoutExecutionAuditRow>(
          'select started_by, completed_by from public.workouts where id = $1',
          [ROOT_WORKOUT_ID],
        )
        expect(completedActors.rows).toEqual([{
          started_by: OTHER_ACTOR_ID,
          completed_by: OTHER_ACTOR_ID,
        }])

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
              started_by = null,
              completed_at = null,
              completed_by = null,
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
        )).resolves.toEqual({ resourceId: ROOT_WORKOUT_EXERCISE_ID, version: 7, replayed: false })
        await expect(withActorTransaction(
          runtimePool,
          ACTOR_ID,
          (client) => setLiveExerciseComment(
            client,
            ROOT_WORKOUT_EXERCISE_ID,
            'Держи спину прямо',
            7,
            LIVE_STRUCTURE_OPERATION_IDS.comment,
          ),
        )).resolves.toEqual({
          resourceId: ROOT_WORKOUT_EXERCISE_ID,
          version: 8,
          replayed: false,
        })

        const noteRows = await ownerPool.query<{ client_note: string; trainer_comment: string }>(
          'select client_note, trainer_comment from public.workout_exercises where id = $1', [ROOT_WORKOUT_EXERCISE_ID],
        )
        expect(noteRows.rows[0]).toEqual({ client_note: 'Клиент не меняет комментарий тренера', trainer_comment: 'Держи спину прямо' })

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
            8,
            LIVE_STRUCTURE_OPERATION_IDS.reorder,
          ),
        )).resolves.toEqual({
          resourceId: appendedBlockId,
          version: 9,
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
            8,
            LIVE_STRUCTURE_OPERATION_IDS.reorder,
          ),
        )).resolves.toEqual({
          resourceId: appendedBlockId,
          version: 9,
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
        const startedReplacement = {
          source: 'system' as const,
          ref: 'squat',
          customExerciseId: null,
          name: 'Присед',
          muscleGroup: 'legs' as const,
          inputKind: 'strength' as const,
        }
        await expect(withActorTransaction(
          runtimePool,
          OTHER_ACTOR_ID,
          (client) => replaceLiveExercise(
            client,
            ROOT_WORKOUT_ID,
            ROOT_WORKOUT_EXERCISE_ID,
            startedReplacement,
            9,
            LIVE_STRUCTURE_OPERATION_IDS.replaceStarted,
          ),
        )).resolves.toEqual({ resourceId: ROOT_WORKOUT_EXERCISE_ID, version: 10, replayed: false })
        await expect(withActorTransaction(
          runtimePool,
          OUTSIDE_TRAINER_ID,
          (client) => appendLiveSet(
            client,
            ROOT_WORKOUT_EXERCISE_ID,
            10,
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
            10,
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
          {
            exercise_name: 'Присед',
            input_kind: 'strength',
            position: 2,
            trainer_comment: null,
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
          count: 8,
          resource_ids_present: true,
        }])
        const deleteOperation = 'd6740000-0000-4000-8000-000000000001'
        const removalId = appendedExerciseId
        if (removalId === undefined) throw new Error('Live exercise fixture is missing')
        await ownerPool.query(
          `update public.workouts set status='done',completed_at=now() where id=$1`,
          [ROOT_WORKOUT_ID],
        )
        await expect(withActorTransaction(runtimePool, OUTSIDE_TRAINER_ID,
          (client) => removeLiveExercise(client, ROOT_WORKOUT_ID, removalId, 9, deleteOperation),
        )).rejects.toMatchObject({ failure: 'forbidden' })
        await expect(withActorTransaction(runtimePool, OTHER_ACTOR_ID,
          (client) => removeLiveExercise(client, ROOT_WORKOUT_ID, removalId, 8, deleteOperation),
        )).rejects.toMatchObject({ failure: 'conflict' })
        await expect(withActorTransaction(runtimePool, OTHER_ACTOR_ID,
          (client) => removeLiveExercise(client, ROOT_WORKOUT_ID, removalId, 10, deleteOperation),
        )).resolves.toEqual({ resourceId: appendedExerciseId, version: 11, replayed: false })
        await expect(withActorTransaction(runtimePool, OTHER_ACTOR_ID,
          (client) => removeLiveExercise(client, ROOT_WORKOUT_ID, removalId, 10, deleteOperation),
        )).resolves.toEqual({ resourceId: appendedExerciseId, version: 11, replayed: true })
        const remaining = await ownerPool.query<{ exercise_name: string }>(
          'select exercise_name from public.workout_exercises where workout_id=$1 order by position', [ROOT_WORKOUT_ID],
        )
        expect(remaining.rows).toEqual([{ exercise_name: 'Становая тяга' }, { exercise_name: 'Присед' }])
        await ownerPool.query('delete from app_private.live_workout_operations where operation_id=$1', [deleteOperation])
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

    it('groups unfinished adjacent Live exercises without changing recorded sets', async () => {
      if (ownerPool === undefined || runtimePool === undefined) throw new Error('Database pools are not ready')
      const operationIds = [
        'a6945b50-5eb0-4ee4-99d1-39534eb1c001',
        'a6945b50-5eb0-4ee4-99d1-39534eb1c002',
        'a6945b50-5eb0-4ee4-99d1-39534eb1c003',
        'a6945b50-5eb0-4ee4-99d1-39534eb1c004',
        'a6945b50-5eb0-4ee4-99d1-39534eb1c005',
        'a6945b50-5eb0-4ee4-99d1-39534eb1c006',
        'a6945b50-5eb0-4ee4-99d1-39534eb1c007',
      ]
      const rootBlock = await ownerPool.query<{ block_id: string }>(
        'select block_id from public.workout_exercises where id=$1', [ROOT_WORKOUT_EXERCISE_ID],
      )
      const blockId = rootBlock.rows[0]?.block_id
      if (!blockId) throw new Error('Root Live block is missing')
      try {
        await ownerPool.query('delete from public.workout_exercises where workout_id=$1 and id<>$2',
          [ROOT_WORKOUT_ID, ROOT_WORKOUT_EXERCISE_ID])
        await ownerPool.query('delete from public.workout_sets where workout_exercise_id=$1 and id<>$2',
          [ROOT_WORKOUT_EXERCISE_ID, ROOT_WORKOUT_SET_ID])
        await ownerPool.query(`insert into public.workout_sets
          (id,workout_exercise_id,trainer_id,client_id,position,plan_duration_sec)
          values ($1,$2,$3,$4,0,1800) on conflict (id) do nothing`,
          [ROOT_WORKOUT_SET_ID, ROOT_WORKOUT_EXERCISE_ID, ACTOR_ID, CLIENT_ID])
        await ownerPool.query('update public.workout_sets set confirmed_at=null where id=$1', [ROOT_WORKOUT_SET_ID])
        await ownerPool.query(`update public.workout_exercises set position=0,block_type='single',
          block_preset='set',block_rounds=1,rest_between_exercises_sec=0,
          rest_between_rounds_sec=90 where id=$1`, [ROOT_WORKOUT_EXERCISE_ID])
        await ownerPool.query("update public.workouts set status='planned',started_at=null,version=1 where id=$1", [ROOT_WORKOUT_ID])
        await withActorTransaction(runtimePool, ACTOR_ID,
          (client) => startLiveWorkout(client, ROOT_WORKOUT_ID, 1, operationIds[0]!))
        const snapshot = { source: 'system' as const, ref: 'push-up', customExerciseId: null,
          name: 'Отжимания', muscleGroup: 'chest' as const, inputKind: 'reps' as const }
        const appended = await withActorTransaction(runtimePool, ACTOR_ID,
          (client) => appendLiveExercise(client, ROOT_WORKOUT_ID, snapshot, 2, operationIds[1]!))
        await withActorTransaction(runtimePool, ACTOR_ID,
          (client) => appendLiveSet(client, ROOT_WORKOUT_EXERCISE_ID, 3, operationIds[2]!))
        const merged = await withActorTransaction(runtimePool, ACTOR_ID,
          (client) => mergeLiveBlockWithNext(client, ROOT_WORKOUT_ID, blockId, 'circuit', 4, operationIds[3]!))
        expect(merged).toEqual({ resourceId: blockId, version: 5, replayed: false })
        await expect(withActorTransaction(runtimePool, ACTOR_ID,
          (client) => mergeLiveBlockWithNext(client, ROOT_WORKOUT_ID, blockId, 'circuit', 4, operationIds[3]!),
        )).resolves.toEqual({ ...merged, replayed: true })
        const grouped = await ownerPool.query<{ block_id: string; block_type: string; block_preset: string; block_rounds: number; rest_between_exercises_sec: number; rest_between_rounds_sec: number; set_count: string }>(`
          select exercise.block_id, exercise.block_type, exercise.block_preset,
            exercise.block_rounds, exercise.rest_between_exercises_sec,
            exercise.rest_between_rounds_sec, count(workout_set.id)::text as set_count
          from public.workout_exercises exercise
          join public.workout_sets workout_set on workout_set.workout_exercise_id=exercise.id
          where exercise.workout_id=$1
          group by exercise.id order by exercise.position`, [ROOT_WORKOUT_ID])
        expect(grouped.rows).toHaveLength(2)
        for (const row of grouped.rows) expect(row).toMatchObject({
          block_id: blockId, block_type: 'group', block_preset: 'circuit',
          block_rounds: 2, rest_between_exercises_sec: 15,
          rest_between_rounds_sec: 60, set_count: '2',
        })
        const originalSet = await ownerPool.query<{ confirmed_at: string | null }>(
          'select confirmed_at from public.workout_sets where id=$1', [ROOT_WORKOUT_SET_ID])
        expect(originalSet.rows[0]?.confirmed_at).toBeNull()
        await ownerPool.query(`update public.workout_exercises
          set rest_between_exercises_sec=23,rest_between_rounds_sec=77
          where workout_id=$1 and block_id=$2`, [ROOT_WORKOUT_ID, blockId])
        const third = await withActorTransaction(runtimePool, ACTOR_ID,
          (client) => appendLiveExercise(client, ROOT_WORKOUT_ID, snapshot, 5, operationIds[4]!))
        await expect(withActorTransaction(runtimePool, ACTOR_ID,
          (client) => mergeLiveBlockWithNext(client, ROOT_WORKOUT_ID, blockId, 'circuit', 6, operationIds[5]!),
        )).resolves.toMatchObject({ resourceId: blockId, version: 7 })
        const extended = await ownerPool.query<{ block_id: string; rest_between_exercises_sec: number; rest_between_rounds_sec: number }>(
          'select block_id,rest_between_exercises_sec,rest_between_rounds_sec from public.workout_exercises where id=$1',
          [third.resourceId])
        expect(extended.rows[0]).toEqual({ block_id: blockId,
          rest_between_exercises_sec: 23, rest_between_rounds_sec: 77 })
        await ownerPool.query('update public.workout_sets set confirmed_at=now() where id=$1', [ROOT_WORKOUT_SET_ID])
        const fourth = await withActorTransaction(runtimePool, ACTOR_ID,
          (client) => appendLiveExercise(client, ROOT_WORKOUT_ID, snapshot, 7, operationIds[6]!))
        await expect(withActorTransaction(runtimePool, ACTOR_ID,
          (client) => mergeLiveBlockWithNext(client, ROOT_WORKOUT_ID, blockId, 'circuit', 8,
            'a6945b50-5eb0-4ee4-99d1-39534eb1c008'),
        )).rejects.toMatchObject({ failure: 'invalid' })
        const unaffected = await ownerPool.query<{ block_id: string }>(
          'select block_id from public.workout_exercises where id=$1', [fourth.resourceId])
        expect(unaffected.rows[0]?.block_id).not.toBe(blockId)
        expect(appended.resourceId).not.toBe(ROOT_WORKOUT_EXERCISE_ID)
      } finally {
        await ownerPool.query('delete from app_private.live_workout_operations where operation_id=any($1::uuid[])', [operationIds])
        await ownerPool.query('delete from public.workout_exercises where workout_id=$1 and id<>$2', [ROOT_WORKOUT_ID, ROOT_WORKOUT_EXERCISE_ID])
        await ownerPool.query('delete from public.workout_sets where workout_exercise_id=$1 and id<>$2', [ROOT_WORKOUT_EXERCISE_ID, ROOT_WORKOUT_SET_ID])
        await ownerPool.query("update public.workout_sets set confirmed_at=null where id=$1", [ROOT_WORKOUT_SET_ID])
        await ownerPool.query("update public.workout_exercises set block_id=$2,block_type='single',block_preset='set',block_rounds=1,rest_between_exercises_sec=0,rest_between_rounds_sec=90 where id=$1", [ROOT_WORKOUT_EXERCISE_ID, blockId])
        await ownerPool.query("update public.workouts set status='planned',started_at=null,version=1 where id=$1", [ROOT_WORKOUT_ID])
      }
    })

    it('atomically adds one set per superset exercise, replays retries, and protects completed rounds', async () => {
      if (ownerPool === undefined || runtimePool === undefined) throw new Error('Database pools are not ready')
      const operationIds = [
        'a6945b50-5eb0-4ee4-99d1-39534eb1c101',
        'a6945b50-5eb0-4ee4-99d1-39534eb1c102',
        'a6945b50-5eb0-4ee4-99d1-39534eb1c103',
        'a6945b50-5eb0-4ee4-99d1-39534eb1c104',
        'a6945b50-5eb0-4ee4-99d1-39534eb1c105',
        'a6945b50-5eb0-4ee4-99d1-39534eb1c106',
        'a6945b50-5eb0-4ee4-99d1-39534eb1c107',
      ]
      const blockId = (await ownerPool.query<{ block_id: string }>(
        'select block_id from public.workout_exercises where id=$1', [ROOT_WORKOUT_EXERCISE_ID],
      )).rows[0]?.block_id
      if (!blockId) throw new Error('Root Live block is missing')
      try {
        await ownerPool.query('delete from public.workout_exercises where workout_id=$1 and id<>$2',
          [ROOT_WORKOUT_ID, ROOT_WORKOUT_EXERCISE_ID])
        await ownerPool.query('delete from public.workout_sets where workout_exercise_id=$1 and id<>$2',
          [ROOT_WORKOUT_EXERCISE_ID, ROOT_WORKOUT_SET_ID])
        await ownerPool.query('update public.workout_sets set confirmed_at=null,fact_reps=null,plan_reps=12 where id=$1',
          [ROOT_WORKOUT_SET_ID])
        await ownerPool.query("update public.workout_exercises set position=0,block_type='single',block_preset='set',block_rounds=1 where id=$1",
          [ROOT_WORKOUT_EXERCISE_ID])
        await ownerPool.query("update public.workouts set status='planned',started_at=null,version=1 where id=$1", [ROOT_WORKOUT_ID])
        await withActorTransaction(runtimePool, ACTOR_ID,
          (client) => startLiveWorkout(client, ROOT_WORKOUT_ID, 1, operationIds[0]!))
        const second = await withActorTransaction(runtimePool, ACTOR_ID,
          (client) => appendLiveExercise(client, ROOT_WORKOUT_ID,
            { source: 'system', ref: 'push-up', customExerciseId: null,
              name: 'Отжимания', muscleGroup: 'chest', inputKind: 'reps' },
            2, operationIds[1]!))
        await withActorTransaction(runtimePool, ACTOR_ID,
          (client) => mergeLiveBlockWithNext(client, ROOT_WORKOUT_ID, blockId, 'set', 3, operationIds[2]!))
        const added = await withActorTransaction(runtimePool, ACTOR_ID,
          (client) => appendLiveRound(client, ROOT_WORKOUT_ID, blockId, 4, operationIds[3]!))
        expect(added).toEqual({ resourceId: blockId, version: 5, replayed: false })
        await expect(withActorTransaction(runtimePool, ACTOR_ID,
          (client) => appendLiveRound(client, ROOT_WORKOUT_ID, blockId, 4, operationIds[3]!),
        )).resolves.toEqual({ ...added, replayed: true })
        const rounds = await ownerPool.query<{ exercise_id: string; position: number; plan_reps: number | null }>(`
          select exercise.id as exercise_id, workout_set.position, workout_set.plan_reps
          from public.workout_exercises exercise
          join public.workout_sets workout_set on workout_set.workout_exercise_id=exercise.id
          where exercise.workout_id=$1 and exercise.block_id=$2
          order by exercise.position, workout_set.position`, [ROOT_WORKOUT_ID, blockId])
        expect(rounds.rows).toHaveLength(4)
        expect(rounds.rows.filter((row) => row.position === 1)).toHaveLength(2)
        expect(rounds.rows.find((row) => row.exercise_id === ROOT_WORKOUT_EXERCISE_ID && row.position === 1)?.plan_reps).toBe(12)
        await ownerPool.query(`update public.workout_sets set confirmed_at=now()
          where workout_exercise_id=$1 and position=1`, [second.resourceId])
        await expect(withActorTransaction(runtimePool, ACTOR_ID,
          (client) => removeLastLiveRound(client, ROOT_WORKOUT_ID, blockId, 1, 5, operationIds[4]!),
        )).rejects.toMatchObject({ failure: 'invalid' })
        expect((await ownerPool.query<{ version: string }>('select version::text as version from public.workouts where id=$1',
          [ROOT_WORKOUT_ID])).rows[0]?.version).toBe('5')
        await ownerPool.query(`update public.workout_sets set confirmed_at=null
          where workout_exercise_id=$1 and position=1`, [second.resourceId])
        const removed = await withActorTransaction(runtimePool, ACTOR_ID,
          (client) => removeLastLiveRound(client, ROOT_WORKOUT_ID, blockId, 1, 5, operationIds[4]!))
        expect(removed).toEqual({ resourceId: blockId, version: 6, replayed: false })
        await expect(withActorTransaction(runtimePool, ACTOR_ID,
          (client) => removeLastLiveRound(client, ROOT_WORKOUT_ID, blockId, 1, 5, operationIds[4]!),
        )).resolves.toEqual({ ...removed, replayed: true })
        expect((await ownerPool.query<{ count: string }>(`
          select count(*)::text as count from public.workout_sets workout_set
          join public.workout_exercises exercise on exercise.id=workout_set.workout_exercise_id
          where exercise.workout_id=$1 and exercise.block_id=$2 and workout_set.position=1`,
          [ROOT_WORKOUT_ID, blockId])).rows[0]?.count).toBe('0')
        await ownerPool.query('update public.workout_sets set fact_reps=11,confirmed_at=now() where id=$1', [ROOT_WORKOUT_SET_ID])
        await ownerPool.query('update public.workout_exercises set rest_between_sets_sec=55 where id=$1', [ROOT_WORKOUT_EXERCISE_ID])
        await ownerPool.query('update public.workout_exercises set rest_between_sets_sec=70 where id=$1', [second.resourceId])
        const before = await ownerPool.query<{ id: string; workout_exercise_id: string; position: number; fact_reps: number | null; confirmed_at: Date | null }>(`
          select workout_set.id,workout_set.workout_exercise_id,workout_set.position,
            workout_set.fact_reps,workout_set.confirmed_at
          from public.workout_sets workout_set
          join public.workout_exercises exercise on exercise.id=workout_set.workout_exercise_id
          where exercise.workout_id=$1 order by workout_set.id`, [ROOT_WORKOUT_ID])
        await expect(withActorTransaction(runtimePool, OUTSIDE_TRAINER_ID,
          (client) => splitLiveSuperset(client, ROOT_WORKOUT_ID, blockId, 6, operationIds[6]!),
        )).rejects.toMatchObject({ failure: 'forbidden' })
        const split = await withActorTransaction(runtimePool, ACTOR_ID,
          (client) => splitLiveSuperset(client, ROOT_WORKOUT_ID, blockId, 6, operationIds[5]!))
        expect(split).toEqual({ resourceId: blockId, version: 7, replayed: false })
        await expect(withActorTransaction(runtimePool, ACTOR_ID,
          (client) => splitLiveSuperset(client, ROOT_WORKOUT_ID, blockId, 6, operationIds[5]!),
        )).resolves.toEqual({ ...split, replayed: true })
        const after = await ownerPool.query<{ id: string; workout_exercise_id: string; position: number; fact_reps: number | null; confirmed_at: Date | null }>(`
          select workout_set.id,workout_set.workout_exercise_id,workout_set.position,
            workout_set.fact_reps,workout_set.confirmed_at
          from public.workout_sets workout_set
          join public.workout_exercises exercise on exercise.id=workout_set.workout_exercise_id
          where exercise.workout_id=$1 order by workout_set.id`, [ROOT_WORKOUT_ID])
        expect(after.rows).toEqual(before.rows)
        const members = await ownerPool.query<{ id: string; block_id: string; block_type: string; rest_between_sets_sec: number }>(`
          select id,block_id,block_type,rest_between_sets_sec from public.workout_exercises
          where workout_id=$1 order by position`, [ROOT_WORKOUT_ID])
        expect(members.rows.map((row) => row.block_type)).toEqual(['single', 'single'])
        expect(new Set(members.rows.map((row) => row.block_id)).size).toBe(2)
        expect(members.rows.map((row) => row.rest_between_sets_sec)).toEqual([55, 70])
      } finally {
        await ownerPool.query('delete from app_private.live_workout_operations where operation_id=any($1::uuid[])', [operationIds])
        await ownerPool.query('delete from public.workout_exercises where workout_id=$1 and id<>$2', [ROOT_WORKOUT_ID, ROOT_WORKOUT_EXERCISE_ID])
        await ownerPool.query('delete from public.workout_sets where workout_exercise_id=$1 and id<>$2', [ROOT_WORKOUT_EXERCISE_ID, ROOT_WORKOUT_SET_ID])
        await ownerPool.query('update public.workout_sets set confirmed_at=null,fact_reps=null where id=$1', [ROOT_WORKOUT_SET_ID])
        await ownerPool.query("update public.workout_exercises set block_id=$2,block_type='single',block_preset='set',block_rounds=1,rest_between_sets_sec=90 where id=$1",
          [ROOT_WORKOUT_EXERCISE_ID, blockId])
        await ownerPool.query("update public.workouts set status='planned',started_at=null,version=1 where id=$1", [ROOT_WORKOUT_ID])
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
        await ownerPool.query(
          'delete from public.app_feedback where user_id = any($1::uuid[])',
          [[ACTOR_ID, OTHER_ACTOR_ID]],
        )
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

        const dispatchTime = new Date('2026-09-04T12:01:00.000Z')
        const batch = await withActorTransaction(
          runtimePool,
          ACTOR_ID,
          (client) => claimAppFeedbackDeliveries(client, dispatchTime),
        )
        if (batch === null) throw new Error('App feedback batch was not claimed')
        expect(batch.deliveries).toHaveLength(2)
        expect(batch.deliveries.every(
          (delivery) => delivery.sendTracker && delivery.sendTelegram,
        )).toBe(true)

        const results = batch.deliveries.map((delivery, index) => ({
          id: delivery.id,
          tracker: index === 0
            ? { ok: true as const, issueKey: 'YAFIT-42' }
            : { ok: false as const, error: 'tracker_http_503' },
          telegram: { ok: true as const },
        }))
        await expect(withActorTransaction(
          runtimePool,
          ACTOR_ID,
          (client) => finalizeAppFeedbackDeliveries(
            client,
            batch.dispatchToken,
            results.slice(0, 1),
            dispatchTime,
          ),
        )).rejects.toMatchObject({ code: 'PT422' })
        await expect(withActorTransaction(
          runtimePool,
          ACTOR_ID,
          (client) => finalizeAppFeedbackDeliveries(
            client,
            batch.dispatchToken,
            results,
            dispatchTime,
          ),
        )).resolves.toEqual({
          trackerSucceeded: 1,
          trackerFailed: 1,
          trackerDiscarded: 0,
          telegramSucceeded: 2,
          telegramFailed: 0,
          telegramDiscarded: 0,
        })

        const retryBatch = await withActorTransaction(
          runtimePool,
          ACTOR_ID,
          (client) => claimAppFeedbackDeliveries(
            client,
            new Date('2026-09-04T12:02:00.000Z'),
          ),
        )
        if (retryBatch === null) throw new Error('Tracker retry was not claimed')
        expect(retryBatch.deliveries).toEqual([expect.objectContaining({
          id: otherFeedbackId,
          sendTracker: true,
          sendTelegram: false,
        })])
        await withActorTransaction(
          runtimePool,
          ACTOR_ID,
          (client) => finalizeAppFeedbackDeliveries(
            client,
            retryBatch.dispatchToken,
            [{
              id: otherFeedbackId,
              tracker: { ok: true, issueKey: 'YAFIT-43' },
            }],
            new Date('2026-09-04T12:02:00.000Z'),
          ),
        )

        const dataLensUrl = new URL(requireLocalTestDatabaseUrl())
        dataLensUrl.username = DATALENS_ROLE
        dataLensUrl.password = DATALENS_PASSWORD
        const dataLensPool = new Pool({
          connectionString: dataLensUrl.toString(),
          max: 1,
        })
        try {
          await expect(dataLensPool.query(
            'select tracker_issue_key from analytics.app_feedback where id = $1',
            [actorFeedbackId],
          )).resolves.toMatchObject({
            rows: [{ tracker_issue_key: 'YAFIT-42' }],
          })
          await expect(dataLensPool.query('show transaction_read_only'))
            .resolves.toMatchObject({ rows: [{ transaction_read_only: 'on' }] })
          await expect(dataLensPool.query('select id from public.app_feedback'))
            .rejects.toMatchObject({ code: '42501' })
          await expect(dataLensPool.query(
            "update analytics.app_feedback set kind = 'suggestion' where id = $1",
            [actorFeedbackId],
          )).rejects.toMatchObject({ code: '55000' })
        } finally {
          await dataLensPool.end()
        }
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
            chat_message: true,
          },
        })

        await withActorTransaction(runtimePool, ACTOR_ID, (client) =>
          upsertPushSubscription(client, {
            endpoint: 'https://push.example/actor',
            p256dh: 'actor-public-key',
            authKey: 'actor-auth-secret',
          }))
        await withActorTransaction(runtimePool, ACTOR_ID, (client) =>
          upsertPushSubscription(client, {
            endpoint: 'https://push.example/actor-tablet',
            p256dh: 'actor-tablet-public-key',
            authKey: 'actor-tablet-auth-secret',
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
            chat_message: true,
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
            chat_message: true,
          },
        })

        const stored = await ownerPool.query<PushSubscriptionAuditRow>(
          `select user_id, endpoint, p256dh, auth_key
           from public.push_subscriptions
           order by endpoint`,
        )
        expect(stored.rows).toEqual([
          {
            user_id: ACTOR_ID,
            endpoint: 'https://push.example/actor',
            p256dh: 'actor-public-key',
            auth_key: 'actor-auth-secret',
          },
          {
            user_id: ACTOR_ID,
            endpoint: 'https://push.example/actor-tablet',
            p256dh: 'actor-tablet-public-key',
            auth_key: 'actor-tablet-auth-secret',
          },
        ])
        await expect(withActorTransaction(
          runtimePool,
          ACTOR_ID,
          (client) => hasPushSubscription(client, 'https://push.example/actor'),
        )).resolves.toBe(true)
        await expect(withActorTransaction(
          runtimePool,
          OTHER_ACTOR_ID,
          (client) => hasPushSubscription(client, 'https://push.example/actor'),
        )).resolves.toBe(false)

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
          (client) => deletePushSubscription(client, 'https://push.example/actor'),
        )
        await withActorTransaction(
          runtimePool,
          ACTOR_ID,
          (client) => deletePushSubscription(client, 'https://push.example/actor'),
        )
        expect((await ownerPool.query(
          `select endpoint from public.push_subscriptions
           where user_id = $1 order by endpoint`,
          [ACTOR_ID],
        )).rows).toEqual([{ endpoint: 'https://push.example/actor-tablet' }])
        expect((await ownerPool.query(
          `select enabled from public.notification_preferences
           where user_id = $1 and kind = 'workout_reminder'`,
          [ACTOR_ID],
        )).rows).toEqual([{ enabled: false }])
        await withActorTransaction(
          runtimePool,
          ACTOR_ID,
          (client) => deletePushSubscription(
            client,
            'https://push.example/actor-tablet',
          ),
        )
        expect((await ownerPool.query(
          'select user_id from public.push_subscriptions where user_id = $1',
          [ACTOR_ID],
        )).rows).toEqual([])
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
            endpoint: 'https://push.example/yandex-pipeline-phone',
            p256dh: 'pipeline-phone-public-key',
            authKey: 'pipeline-phone-auth-key',
          }))
        await withActorTransaction(runtimePool, OTHER_ACTOR_ID, (client) =>
          upsertPushSubscription(client, {
            endpoint: 'https://push.example/yandex-pipeline-tablet',
            p256dh: 'pipeline-tablet-public-key',
            authKey: 'pipeline-tablet-auth-key',
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
             and data->>'workout_id' = $1::text`,
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
        expect(scheduled.rows).toHaveLength(2)
        for (const notification of scheduled.rows) {
          expect(notification).toMatchObject({
            kind: 'workout_scheduled',
            title: 'Новая тренировка',
          })
          expect(notification.body).toContain(actorName)
        }

        await ownerPool.query(
          `insert into app_private.push_notifications_outbox (
             kind, user_id, title, body, data, attempts, subscription_id
           )
           select
             'retry_limit_test', $1, 'Retry limit', 'Retry limit', $2::jsonb,
             9, subscription.id
           from public.push_subscriptions subscription
           where subscription.user_id = $1
             and subscription.endpoint = 'https://push.example/yandex-pipeline-tablet'`,
          [OTHER_ACTOR_ID, JSON.stringify({ test: 'retry-limit' })],
        )

        const dispatchTime = new Date('2099-01-01T09:02:00.000Z')
        await expect(withActorTransaction(
          runtimePool,
          ACTOR_ID,
          (client) => enqueueWorkoutReminders(client, dispatchTime),
        )).resolves.toBe(2)
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
        expect(batch?.notifications).toHaveLength(5)
        if (batch === null) throw new Error('Push batch was not claimed')
        const results = batch.notifications.map((notification) =>
          notification.title === 'Retry limit'
            ? {
                id: notification.id,
                ok: false as const,
                status: 503,
                error: 'web_push_503',
              }
            : notification.title === 'Тренировка сегодня'
              && notification.subscription.endpoint.endsWith('-phone')
              ? {
                id: notification.id,
                ok: false as const,
                status: 410,
                error: 'web_push_410',
                }
              : { id: notification.id, ok: true as const })
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
        )).resolves.toEqual({ succeeded: 3, failed: 2, discarded: 2 })

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
           order by kind, sent, discarded`,
          [OTHER_ACTOR_ID],
        )
        expect(finalized.rows).toEqual([
          { kind: 'retry_limit_test', sent: false, discarded: true, attempts: 10 },
          { kind: 'workout_reminder', sent: false, discarded: true, attempts: 1 },
          { kind: 'workout_reminder', sent: true, discarded: false, attempts: 0 },
          { kind: 'workout_scheduled', sent: true, discarded: false, attempts: 0 },
          { kind: 'workout_scheduled', sent: true, discarded: false, attempts: 0 },
        ])
        expect((await ownerPool.query(
          `select endpoint from public.push_subscriptions
           where user_id = $1 order by endpoint`,
          [OTHER_ACTOR_ID],
        )).rows).toEqual([{
          endpoint: 'https://push.example/yandex-pipeline-tablet',
        }])
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
        primaryMuscleDetail: 'Квадрицепс',
        equipment: 'Сани',
        description: 'Толкайте сани с устойчивым корпусом.',
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
        )).resolves.toBe(2)

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
            2,
          ),
        )
        expect(updatedVersion).toBe(3)
        await expect(withActorTransaction(
          runtimePool,
          ACTOR_ID,
          (client) => updateClientCard(client, created.id, draft, 2),
        )).rejects.toMatchObject({ failure: 'conflict' })

        const archivedVersion = await withActorTransaction(
          runtimePool,
          ACTOR_ID,
          (client) => setClientArchived(client, created.id, true, 3),
        )
        expect(archivedVersion).toBe(4)
        const archivedClients = await withActorTransaction(
          runtimePool,
          ACTOR_ID,
          (client) => readAccessibleClients(client, true),
        )
        expect(archivedClients.clients).toEqual(expect.arrayContaining([
          expect.objectContaining({ id: created.id, version: 4, canArchive: true }),
        ]))
        const restoredVersion = await withActorTransaction(
          runtimePool,
          ACTOR_ID,
          (client) => setClientArchived(client, created.id, false, 4),
        )
        expect(restoredVersion).toBe(5)

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

        const catalogAfterCreate = await withActorTransaction(
          runtimePool,
          ACTOR_ID,
          readAccessibleTrainingData,
        )
        expect(catalogAfterCreate.customExercises).toEqual(expect.arrayContaining([
          expect.objectContaining({ id: exercise.id, ...exerciseDraft }),
        ]))

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
            {
              ...exerciseDraft,
              name: 'Обновлённая тяга саней',
              equipment: 'Нагруженные сани',
              description: 'Сохраняйте нейтральное положение спины.',
            },
            1,
          ),
        )
        expect(updatedExercise).toMatchObject({
          name: 'Обновлённая тяга саней',
          primaryMuscleDetail: 'Квадрицепс',
          equipment: 'Нагруженные сани',
          description: 'Сохраняйте нейтральное положение спины.',
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
      let exerciseId: string | undefined
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

        const exercise = await withActorTransaction(
          runtimePool,
          DOMAIN_CLIENT_ACTOR_ID,
          (client) => createCustomExercise(client, {
            name: 'Самостоятельная планка',
            muscleGroup: 'core',
            inputKind: 'duration',
          }),
        )
        exerciseId = exercise.id
        const storedExercise = await ownerPool.query<{
          created_by: string
          trainer_id: string
        } & QueryResultRow>(
          'select created_by, trainer_id from public.custom_exercises where id = $1',
          [exercise.id],
        )
        expect(storedExercise.rows).toEqual([{
          created_by: DOMAIN_CLIENT_ACTOR_ID,
          trainer_id: DOMAIN_CLIENT_ACTOR_ID,
        }])
      } finally {
        if (exerciseId !== undefined) {
          await ownerPool.query(
            'delete from public.custom_exercises where id = $1',
            [exerciseId],
          )
        }
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
        canArchive: false,
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
      await expect(withActorTransaction(runtimePool, '42e33d28-312f-4a22-8789-459de8541199', (client) =>
        createAssistantConversation(client, null)))
        .rejects.toMatchObject({ failure: 'forbidden' })
      await expect(withActorTransaction(runtimePool, ACTOR_ID, (client) =>
        client.query(
          `insert into public.assistant_conversations (owner_id)
            values ($1)`,
          [ACTOR_ID],
        ))).rejects.toMatchObject({ code: '42501' })
    })

    it('lets a client use Assistant only for their own workout and validated program', async () => {
      if (ownerPool === undefined || runtimePool === undefined) {
        throw new Error('Database pools are not ready')
      }
      await ownerPool.query(
        'delete from public.assistant_conversations where owner_id = $1',
        [OTHER_ACTOR_ID],
      )
      await ownerPool.query(
        `delete from public.workouts
         where created_by = $1 and notes = 'Клиентская запись из Assistant'`,
        [OTHER_ACTOR_ID],
      )

      const conversation = await withActorTransaction(
        runtimePool,
        OTHER_ACTOR_ID,
        (client) => createAssistantConversation(client, 'Моя тренировка'),
      )
      await withActorTransaction(runtimePool, OTHER_ACTOR_ID, (client) =>
        appendAssistantUserMessage(
          client,
          conversation.id,
          CLIENT_ASSISTANT_TURN_ID,
          'Запиши мою тренировку',
        ))
      await withActorTransaction(runtimePool, OTHER_ACTOR_ID, (client) =>
        persistAssistantResponse(
          client,
          conversation.id,
          CLIENT_ASSISTANT_TURN_ID,
          'Проверьте тренировку',
          {
            id: CLIENT_ASSISTANT_ACTION_ID,
            tool: 'record_workout',
            status: 'proposed',
            title: 'Моя тренировка',
            description: 'Подтвердите сохранение',
            payload: { clientId: CLIENT_ID, step: 'confirm' },
          },
        ))

      const workout = {
        id: null,
        requestId: CLIENT_ASSISTANT_WORKOUT_REQUEST_ID,
        clientId: CLIENT_ID,
        workoutDate: '2026-09-17',
        startTime: null,
        endTime: null,
        notes: 'Клиентская запись из Assistant',
        exercises: [{
          position: 0,
          source: 'system',
          ref: 'barbell-squat',
          customExerciseId: null,
          name: 'Приседания со штангой',
          muscleGroup: 'legs',
          inputKind: 'strength',
          blockId: 'cdf26086-1e3b-4fba-a46c-d3ff6ee9f5ad',
          blockType: 'single',
          blockPreset: 'set',
          blockRounds: 1,
          restBetweenExercisesSec: 0,
          restBetweenRoundsSec: 90,
          restBetweenSetsSec: 90,
          trainerComment: null,
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
      const applied = await withActorTransaction(
        runtimePool,
        OTHER_ACTOR_ID,
        (client) => applyAssistantAction(
          client,
          CLIENT_ASSISTANT_ACTION_ID,
          { workout },
          1,
        ),
      )
      expect(applied).toMatchObject({ status: 'applied', version: 2 })
      const stored = await ownerPool.query<{
        client_id: string
        created_by: string
      } & QueryResultRow>(
        `select client_id, created_by from public.workouts
         where id = $1`,
        [applied.workoutId],
      )
      expect(stored.rows).toEqual([{
        client_id: CLIENT_ID,
        created_by: OTHER_ACTOR_ID,
      }])
      const storedOrigin = await ownerPool.query<{ origin: string } & QueryResultRow>(
        `select origin from public.workouts where id = $1`,
        [applied.workoutId],
      )
      // record_workout dictates an already-done workout, not an AI-authored
      // plan - origin stays manual (see design doc part 1).
      expect(storedOrigin.rows).toEqual([{ origin: 'manual' }])

      // Six sessions is a valid two-week, three-times-per-week program. It
      // guards the flexible generator contract rather than only the legacy
      // 4/8/12-session shapes.
      const programWorkouts = Array.from({ length: 6 }, (_, index) => ({
        ...workout,
        requestId: `ef691fd5-86ee-4740-838c-b37166df7e7${index}`,
        workoutDate: new Date(Date.UTC(2026, 8, 21 + index * 3))
          .toISOString().slice(0, 10),
        notes: 'Клиентская программа из Assistant',
      }))
      // PostgreSQL and the Node test process can differ by a few milliseconds.
      // Keep the synthetic capture safely after the committed workout above.
      const programSourceCapturedAt = new Date(Date.now() + 1_000).toISOString()
      await withActorTransaction(runtimePool, OTHER_ACTOR_ID, (client) =>
        appendAssistantUserMessage(
          client,
          conversation.id,
          CLIENT_ASSISTANT_PROGRAM_TURN_ID,
          'Составь мою программу',
        ))
      await withActorTransaction(runtimePool, OTHER_ACTOR_ID, (client) =>
        persistAssistantResponse(
          client,
          conversation.id,
          CLIENT_ASSISTANT_PROGRAM_TURN_ID,
          'Рекомендованный черновик программы',
          {
            id: CLIENT_ASSISTANT_PROGRAM_ACTION_ID,
            tool: 'create_program_draft',
            status: 'proposed',
            title: 'Программа на четыре недели',
            description: 'Проверьте назначения',
            payload: {
              schemaVersion: 'program-v1',
              clientId: CLIENT_ID,
              sourceCapturedAt: programSourceCapturedAt,
              canonicalWorkouts: programWorkouts,
              step: 'confirm',
            },
          },
        ))
      const programApplied = await withActorTransaction(
        runtimePool,
        OTHER_ACTOR_ID,
        (client) => applyAssistantAction(
          client,
          CLIENT_ASSISTANT_PROGRAM_ACTION_ID,
          { workouts: programWorkouts },
          1,
        ),
      )
      const programAppliedAgain = await withActorTransaction(
        runtimePool,
        OTHER_ACTOR_ID,
        (client) => applyAssistantAction(
          client,
          CLIENT_ASSISTANT_PROGRAM_ACTION_ID,
          {},
          2,
        ),
      )
      expect(programApplied).toMatchObject({ status: 'applied', version: 2 })
      expect(programApplied.workoutIds).toHaveLength(6)
      expect(programAppliedAgain).toMatchObject({ status: 'applied', version: 2 })
      const storedProgram = await ownerPool.query<CountRow>(
        `select count(*)::integer count from public.workouts
         where notes = 'Клиентская программа из Assistant'
           and client_id = $1 and created_by = $2`,
        [CLIENT_ID, OTHER_ACTOR_ID],
      )
      expect(storedProgram.rows[0]?.count).toBe(6)
      const storedProgramOrigin = await ownerPool.query<CountRow>(
        `select count(*)::integer count from public.workouts
         where notes = 'Клиентская программа из Assistant' and origin = 'ai'`,
      )
      expect(storedProgramOrigin.rows[0]?.count).toBe(6)

      await withActorTransaction(runtimePool, OTHER_ACTOR_ID, (client) =>
        appendAssistantUserMessage(
          client,
          conversation.id,
          CLIENT_ASSISTANT_FORBIDDEN_TURN_ID,
          'Создай клиента',
        ))
      await withActorTransaction(runtimePool, OTHER_ACTOR_ID, (client) =>
        persistAssistantResponse(
          client,
          conversation.id,
          CLIENT_ASSISTANT_FORBIDDEN_TURN_ID,
          'Запрещённое действие',
          {
            id: CLIENT_ASSISTANT_FORBIDDEN_ACTION_ID,
            tool: 'create_client_draft',
            status: 'proposed',
            title: 'Новый клиент',
            description: 'Не должно примениться',
            payload: { step: 'confirm' },
          },
        ))
      await expect(withActorTransaction(
        runtimePool,
        OTHER_ACTOR_ID,
        (client) => applyAssistantAction(
          client,
          CLIENT_ASSISTANT_FORBIDDEN_ACTION_ID,
          { fullName: 'Чужой клиент' },
          1,
        ),
      )).rejects.toMatchObject({ failure: 'forbidden' })

      await ownerPool.query('delete from public.workouts where id = $1', [applied.workoutId])
      await ownerPool.query(
        `delete from public.workouts
         where notes = 'Клиентская программа из Assistant'
           and created_by = $1`,
        [OTHER_ACTOR_ID],
      )
      await ownerPool.query('delete from public.assistant_conversations where id = $1', [conversation.id])
    })

    it('loads client program context and scopes generation leases to the actor', async () => {
      if (ownerPool === undefined || runtimePool === undefined) {
        throw new Error('Database pools are not ready')
      }
      await ownerPool.query(
        'delete from private.assistant_program_generations where id = $1',
        [CLIENT_PROGRAM_JOB_ID],
      )

      const context = await withActorTransaction(runtimePool, OTHER_ACTOR_ID, (client) =>
        loadDatabaseProgramContext(client, {
          id: CLIENT_ID,
          ageYears: 30,
          goal: null,
        }, '2026-09-19'))
      expect(context.context.periodEnd).toBe('2026-09-19')
      expect(context.fingerprint).toMatch(/^[0-9a-f]{64}$/u)

      const claim = await withActorTransaction(runtimePool, OTHER_ACTOR_ID, async (client) => {
        const rows = await client.query<{ result: Record<string, unknown> } & QueryResultRow>(
          'select public.assistant_program_generation_job($1, $2, $3, null) result',
          [CLIENT_PROGRAM_JOB_ID, CLIENT_ID, CLIENT_PROGRAM_JOB_LEASE_ID],
        )
        return rows[0]?.result
      })
      expect(claim).toEqual({ status: 'claimed' })

      const busy = await withActorTransaction(runtimePool, OTHER_ACTOR_ID, async (client) => {
        const rows = await client.query<{ result: Record<string, unknown> } & QueryResultRow>(
          'select public.assistant_program_generation_job($1, $2, $3, null) result',
          [CLIENT_PROGRAM_JOB_ID, CLIENT_ID, CLIENT_PROGRAM_JOB_OTHER_LEASE_ID],
        )
        return rows[0]?.result
      })
      expect(busy).toEqual({ status: 'busy' })

      await expect(withActorTransaction(runtimePool, OUTSIDE_TRAINER_ID, (client) =>
        client.query(
          'select public.assistant_program_generation_job($1, $2, $3, null)',
          [CLIENT_PROGRAM_JOB_ID, CLIENT_ID, CLIENT_PROGRAM_JOB_OTHER_LEASE_ID],
        ))).rejects.toMatchObject({ code: 'PT403' })

      const complete = await withActorTransaction(runtimePool, OTHER_ACTOR_ID, async (client) => {
        const rows = await client.query<{ result: Record<string, unknown> } & QueryResultRow>(
          'select public.assistant_program_generation_job($1, $2, $3, $4::jsonb) result',
          [CLIENT_PROGRAM_JOB_ID, CLIENT_ID, CLIENT_PROGRAM_JOB_LEASE_ID, JSON.stringify({ template: { sessions: [] } })],
        )
        return rows[0]?.result
      })
      expect(complete).toEqual({ status: 'complete', result: { template: { sessions: [] } } })

      await ownerPool.query(
        'delete from private.assistant_program_generations where id = $1',
        [CLIENT_PROGRAM_JOB_ID],
      )
    })

    it('preserves client source timestamps only during a tenant migration restore', async () => {
      if (ownerPool === undefined) throw new Error('Database pool is not ready')
      const connection = await ownerPool.connect()
      const migrationClientId = 'fe000000-0000-4000-8000-000000000077'
      try {
        await connection.query('begin')
        await connection.query(
          `insert into public.clients (
             id, trainer_id, full_name, updated_at
           ) values ($1, $2, 'Migration fixture', timestamptz '2026-01-01 00:00:00+00')`,
          [migrationClientId, ACTOR_ID],
        )
        await connection.query(
          "select set_config('fit.tenant_migration_restore', 'on', true)",
        )
        await connection.query(
          `insert into public.client_progress (
             trainer_id, client_id, created_by, recorded_on, weight_kg
           ) values ($1, $2, $1, date '2026-01-01', 70)`,
          [ACTOR_ID, migrationClientId],
        )
        const preserved = await connection.query<{ preserved: boolean } & QueryResultRow>(
          `select updated_at = timestamptz '2026-01-01 00:00:00+00' preserved
           from public.clients where id = $1`,
          [migrationClientId],
        )
        expect(preserved.rows[0]?.preserved).toBe(true)

        await connection.query(
          "select set_config('fit.tenant_migration_restore', 'off', true)",
        )
        await connection.query(
          `insert into public.client_progress (
             trainer_id, client_id, created_by, recorded_on, weight_kg
           ) values ($1, $2, $1, date '2026-01-02', 69)`,
          [ACTOR_ID, migrationClientId],
        )
        const advanced = await connection.query<{ advanced: boolean } & QueryResultRow>(
          `select updated_at > timestamptz '2026-01-01 00:00:00+00' advanced
           from public.clients where id = $1`,
          [migrationClientId],
        )
        expect(advanced.rows[0]?.advanced).toBe(true)
      } finally {
        await connection.query('rollback')
        connection.release()
      }
    })

    it('manages linked domain-ready rollout assignments as one private batch', async () => {
      if (enrollmentPool === undefined) throw new Error('Database pool is not ready')
      const manager = new DatabaseStageRolloutAssignmentManager(enrollmentPool)

      const inspected = await manager.applyLinkedProfiles('inspect')
      expect(inspected.domainReadyProfiles).toBeGreaterThan(0)
      expect(inspected.linkedProfiles).toBeGreaterThan(0)

      const enabled = await manager.applyLinkedProfiles('enable')
      expect(enabled.rolloutEnabledProfiles).toBe(enabled.linkedProfiles)

      const disabled = await manager.applyLinkedProfiles('disable')
      expect(disabled.rolloutEnabledProfiles).toBe(0)
    })

    it('uses one canonical duration and validates long or overnight workout clocks', async () => {
      if (ownerPool === undefined) throw new Error('Database pool is not ready')
      const result = await ownerPool.query<{
        canonical: number; consistent: boolean; contradictory: boolean
        overnight: number; four_hours: number; plausible: boolean; implausible: boolean
        consistent_total: string; contradictory_total: string
      }>(`select
        app_private.canonical_set_duration_seconds(1800, 30) canonical,
        app_private.set_duration_is_consistent(1800, 30) consistent,
        app_private.set_duration_is_consistent(1800, 20) contradictory,
        app_private.workout_elapsed_seconds(null, null, time '23:30', time '00:30') overnight,
        app_private.workout_elapsed_seconds(null, null, time '10:00', time '14:00') four_hours,
        app_private.workout_elapsed_is_plausible(14400) plausible,
        app_private.workout_elapsed_is_plausible(50000) implausible,
        app_private.workout_time_quality(3600, 3500) consistent_total,
        app_private.workout_time_quality(3600, 4000) contradictory_total`)
      expect(result.rows[0]).toMatchObject({
        canonical: 1800, consistent: true, contradictory: false,
        overnight: 3600, four_hours: 14400, plausible: true, implausible: false,
        consistent_total: 'consistent', contradictory_total: 'contradictory',
      })
      const connection = await ownerPool.connect()
      try {
        await connection.query('begin')
        const saved = await connection.query<{ start_time: string; end_time: string }>(`
          update public.workouts set start_time = time '23:30', end_time = time '00:30'
          where id = $1 returning start_time::text, end_time::text`, [ROOT_WORKOUT_ID])
        expect(saved.rows[0]).toMatchObject({ start_time: '23:30:00', end_time: '00:30:00' })
      } finally {
        await connection.query('rollback')
        connection.release()
      }
    })

    it('never uses a future weight measurement for an earlier workout', async () => {
      if (ownerPool === undefined) throw new Error('Database pool is not ready')
      const connection = await ownerPool.connect()
      try {
        await connection.query('begin')
        await connection.query(`insert into public.client_progress
          (trainer_id, client_id, created_by, recorded_on, weight_kg)
          values ($1, $2, $1, date '1900-01-01', 70),
            ($1, $2, $1, date '1900-01-03', 85)`, [ACTOR_ID, CLIENT_ID])
        const result = await connection.query<{ weight: string }>(`
          select app_private.workout_weight_on_date($1, date '1900-01-02')::text weight`, [CLIENT_ID])
        expect(result.rows[0]?.weight).toBe('70.00')
      } finally {
        await connection.query('rollback')
        connection.release()
      }
    })

    it('calculates shadow calories from entered work without changing published v1', async () => {
      if (ownerPool === undefined) throw new Error('Database pool is not ready')
      const connection = await ownerPool.connect()
      try {
        await connection.query('begin')
        await connection.query(`insert into public.client_progress
          (trainer_id, client_id, created_by, recorded_on, weight_kg)
          values ($1, $2, $1, date '2026-08-20', 70)
          on conflict (client_id, recorded_on) where deleted_at is null
          do update set weight_kg = excluded.weight_kg`, [ACTOR_ID, CLIENT_ID])
        await connection.query(`update public.workouts set status = 'done',
          start_time = time '10:00', end_time = time '11:00',
          completed_at = timestamptz '2026-08-20 11:00:00+00'
          where id = $1`, [ROOT_WORKOUT_ID])
        await connection.query(`update public.workout_sets set
          fact_duration_sec = 3600, fact_duration_source = 'entered',
          fact_distance_km = 10, fact_distance_source = 'entered',
          fact_rpe = 9, fact_rpe_source = 'planned',
          confirmed_at = timestamptz '2026-08-20 11:00:00+00'
          where id = $1`, [ROOT_WORKOUT_SET_ID])
        const read = async () => {
          const result = await connection.query<{
            active_calories_kcal: number | null
            calorie_v2_shadow_kcal: number | null
            calorie_v2_shadow_reason: string | null
            calorie_v2_shadow_details: { segments: Array<{ met: number }> }
          }>(`select active_calories_kcal, calorie_v2_shadow_kcal,
              calorie_v2_shadow_reason, calorie_v2_shadow_details
            from public.workouts where id = $1`, [ROOT_WORKOUT_ID])
          return result.rows[0]!
        }
        const running = await read()
        expect(running.calorie_v2_shadow_reason).toBeNull()
        expect(running.calorie_v2_shadow_kcal).toBe(610)
        expect(running.calorie_v2_shadow_details.segments[0]?.met).toBe(9.3)
        const publishedV1 = running.active_calories_kcal

        await connection.query(`update public.workout_exercises
          set exercise_ref = 'stationary-bike', exercise_name = 'Велотренажёр'
          where id = $1`, [ROOT_WORKOUT_EXERCISE_ID])
        const bike = await read()
        expect(bike.calorie_v2_shadow_kcal).toBe(425)
        expect(bike.calorie_v2_shadow_details.segments[0]?.met).toBe(6.8)
        // Changing bike distance alone cannot change the intensity estimate.
        await connection.query(`update public.workout_sets set fact_distance_km = 30
          where id = $1`, [ROOT_WORKOUT_SET_ID])
        expect((await read()).calorie_v2_shadow_kcal).toBe(425)
        expect((await read()).active_calories_kcal).toBe(publishedV1)

        await connection.query(`update public.workout_sets set fact_duration_source = 'planned'
          where id = $1`, [ROOT_WORKOUT_SET_ID])
        const missing = await read()
        expect(missing.calorie_v2_shadow_kcal).toBeNull()
        expect(missing.calorie_v2_shadow_reason).toBe('missing_activity_duration')
      } finally {
        await connection.query('rollback')
        connection.release()
      }
    })

    it('uses bounded activity MET bands and never infers bike intensity from distance', async () => {
      if (ownerPool === undefined) throw new Error('Database pool is not ready')
      const values = await ownerPool.query<{
        walk_slow: string; walk_fast: string; row_moderate: string
        row_fast: string; bike: string; bike_rpe: string
        recovery: string; custom: string
      }>(`select
        app_private.calorie_v2_met('walking', 3, null)::text walk_slow,
        app_private.calorie_v2_met('walking', 6, null)::text walk_fast,
        app_private.calorie_v2_met('rowing-machine', 6, null)::text row_moderate,
        app_private.calorie_v2_met('rowing-machine', 10, null)::text row_fast,
        app_private.calorie_v2_met('stationary-bike', 100, null)::text bike,
        app_private.calorie_v2_met('stationary-bike', null, 9)::text bike_rpe,
        app_private.calorie_v2_met('recovery', null, null)::text recovery,
        app_private.calorie_v2_met(
          app_private.calorie_v2_activity('custom', 'stationary-bike', 'cardio', 'set'),
          null, null)::text custom`)
      expect(values.rows[0]).toEqual({
        walk_slow: '2.30', walk_fast: '4.80', row_moderate: '5.00',
        row_fast: '7.30', bike: '6.80', bike_rpe: '7.34',
        recovery: '2.30', custom: '4.00',
      })
    })
  },
)
