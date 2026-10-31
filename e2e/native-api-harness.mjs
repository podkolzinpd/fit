import { createHash, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// This executable is test-only, never imported by server.ts or a frontend build.
// It creates its own database; it cannot reuse or erase an existing database.
const apiDirectory = new URL('../services/api/', import.meta.url)
const requireApi = createRequire(new URL('package.json', apiDirectory))
const { Pool } = requireApi('pg')
const ownerUrl = new URL(process.env.FIT_E2E_POSTGRES_URL ?? 'postgresql://postgres:postgres@127.0.0.1:55432/postgres')
if (!['127.0.0.1', 'localhost', '[::1]'].includes(ownerUrl.hostname)
  || !['5432', '55432'].includes(ownerUrl.port)
  || !['/postgres', '/fit_actor_test'].includes(ownerUrl.pathname)) throw new Error('native_fixture_requires_local_postgres')
const databaseName = `fit_frontend_e2e_${process.pid}_${randomUUID().replaceAll('-', '').slice(0, 12)}`
if (!/^fit_frontend_e2e_[0-9]+_[a-f0-9]{12}$/.test(databaseName)) throw new Error('invalid_fixture_database')
const admin = new Pool({ connectionString: ownerUrl.href, max: 1 })
let created = false
let runtime
let owner
let app
let stopping = false
const mediaObjects = new Map()
let origin
let resetId = 0
let sessionSequence = 0
const profiles = new Map()
const trainerId = '90000000-0000-4000-8000-000000000009'
const clientId = '92000000-0000-4000-8000-000000000029'
const seed = await readFile(new URL('fixtures/native-browser-seed.sql', import.meta.url), 'utf8')
const legal = JSON.parse(await readFile(new URL('../src/shared/legal-documents.json', import.meta.url), 'utf8'))
const terms = `sha256:${legal.terms.sourceTextSha256.slice(0, 24)}`
const privacy = `sha256:${legal.privacy.sourceTextSha256.slice(0, 24)}`
const sha = value => createHash('sha256').update(value).digest('hex')
const uuid = value => {
  const hash = sha(value)
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`
}
const nativeModule = name => import(new URL(`dist/${name}.js`, apiDirectory))

async function stop() {
  if (stopping) return
  stopping = true
  await app?.close()
  await runtime?.end()
  await owner?.end()
  if (created) {
    await admin.query('select pg_terminate_backend(pid) from pg_stat_activity where datname=$1 and pid<>pg_backend_pid()', [databaseName])
    await admin.query(`drop database "${databaseName}"`)
  }
  await admin.end()
}
process.once('SIGTERM', () => { void stop().then(() => process.exit(0)) })
process.once('SIGINT', () => { void stop().then(() => process.exit(0)) })

try {
  // Workers share a local PostgreSQL cluster, but never a fixture database.
  // Serialize initial role creation instead of racing the pg_authid unique key.
  await admin.query('select pg_advisory_lock(310312026)')
  try {
    await admin.query(`do $$ begin if not exists(select 1 from pg_roles where rolname='fit_api') then create role fit_api login password 'fit-api-test-only'; end if; end $$`)
  } finally {
    await admin.query('select pg_advisory_unlock(310312026)')
  }
  await admin.query(`create database "${databaseName}"`)
  created = true
  const databaseUrl = new URL(ownerUrl)
  databaseUrl.pathname = `/${databaseName}`
  const migrate = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'db:migrate'], {
    cwd: fileURLToPath(apiDirectory), env: { ...process.env, DATABASE_URL: databaseUrl.href }, encoding: 'utf8', timeout: 120_000,
  })
  if (migrate.status !== 0) {
    // Migration source is synthetic and this DSN is local-only. Do not print env.
    process.stderr.write(migrate.stderr ?? '')
    throw new Error('native_fixture_migration_failed')
  }
  owner = new Pool({ connectionString: databaseUrl.href, max: 1 })
  await owner.query("grant connect on database \"" + databaseName + "\" to fit_api")
  const runtimeUrl = new URL(databaseUrl)
  runtimeUrl.username = 'fit_api'
  runtimeUrl.password = 'fit-api-test-only'
  const { PgDatabasePool } = await nativeModule('db/pg-pool')
  runtime = new PgDatabasePool({ connectionString: runtimeUrl.href, max: 1 }, 'api')
  const { buildApp } = await nativeModule('app')
  const services = [
    ['pilotClientsReader', 'pilot-clients-reader', 'DatabasePilotClientsReader'],
    ['pilotProfileReader', 'pilot-profile-reader', 'DatabasePilotProfileReader'],
    ['pilotConnectionsReader', 'pilot-connections-reader', 'DatabasePilotConnectionsReader'],
    ['pilotConnectionsWriter', 'pilot-connections-writer', 'DatabasePilotConnectionsWriter'],
    ['pilotInvitationLinks', 'pilot-invitation-links', 'DatabasePilotInvitationLinks'],
    ['pilotLegal', 'pilot-legal', 'DatabasePilotLegal'],
    ['pilotDomainWriter', 'pilot-domain-writer', 'DatabasePilotDomainWriter'],
    ['pilotTrainingDataReader', 'pilot-training-data-reader', 'DatabasePilotTrainingDataReader'],
    ['pilotTrainerWorkspace', 'pilot-trainer-workspace', 'DatabasePilotTrainerWorkspace'],
    ['pilotTrainerDiscovery', 'trainer-discovery', 'DatabasePilotTrainerDiscovery'],
    ['pilotFavoriteWorkouts', 'favorite-workouts', 'DatabasePilotFavoriteWorkouts'],
    ['pilotTrainerFinance', 'trainer-finance', 'DatabasePilotTrainerFinance'],
    ['pilotWorkoutsWriter', 'pilot-workouts-writer', 'DatabasePilotWorkoutsWriter'],
    ['pilotWorkoutTemplates', 'workout-templates', 'DatabasePilotWorkoutTemplates'],
    ['pilotProgressData', 'progress-data', 'DatabasePilotProgressData'],
    ['clientWorkoutStatsReader', 'client-workout-stats', 'DatabaseClientWorkoutStatsReader'],
    ['workoutHomeReader', 'workout-home-reader', 'DatabaseWorkoutHomeReader'],
    ['pilotAppFeedbackWriter', 'pilot-app-feedback-writer', 'DatabasePilotAppFeedbackWriter'],
    ['pilotPushNotifications', 'pilot-push-notifications', 'DatabasePilotPushNotifications'],
    ['pilotChat', 'pilot-chat', 'DatabasePilotChat'],
  ]
  const options = { databasePool: runtime, logger: false, allowedOrigins: [new URL(process.env.FIT_E2E_FRONTEND_URL ?? 'http://127.0.0.1:5173').origin], yandexOnlyAuthEnabled: true }
  for (const [key, module, name] of services) {
    const exports = await nativeModule(module)
    options[key] = new exports[name](runtime)
  }
  const sessions = await nativeModule('yandex-app-session')
  options.yandexAppSessionReader = new sessions.DatabaseYandexAppSessionReader(runtime)
  options.yandexAppSessionRevoker = new sessions.DatabaseYandexAppSessionRevoker(runtime)
  const storage = {
    async read(namespace, path) { return mediaObjects.get(`${namespace}/${path}`)?.bytes },
    async remove(namespace, path) { mediaObjects.delete(`${namespace}/${path}`) },
    async sign(namespace, path) { return `${origin}/__fixtures/media/${namespace}/${path}` },
    async stat(namespace, path) {
      const item = mediaObjects.get(`${namespace}/${path}`)
      return item === undefined ? undefined : { sizeBytes: item.bytes.byteLength, sha256: sha(item.bytes) }
    },
    async write(namespace, path, bytes, contentType, overwrite) {
      const key = `${namespace}/${path}`
      if (!overwrite && mediaObjects.has(key)) throw new Error('fixture_media_already_exists')
      mediaObjects.set(key, { bytes: Buffer.from(bytes), contentType })
    },
  }
  const { YandexChatMediaStore } = await nativeModule('object-storage-media')
  options.chatMediaStore = new YandexChatMediaStore(storage)
  const { DatabasePilotTrainerProfiles } = await nativeModule('trainer-profile')
  options.pilotTrainerProfiles = new DatabasePilotTrainerProfiles(runtime, storage)
  const { DatabasePilotCustomExercisePhotos } = await nativeModule('custom-exercise-photo')
  options.pilotCustomExercisePhotos = new DatabasePilotCustomExercisePhotos(runtime, storage)
  const { DatabasePilotTrainingSummaries } = await nativeModule('training-summary')
  options.pilotTrainingSummaryReader = new DatabasePilotTrainingSummaries(runtime)
  options.vitalMediaSigner = { async sign(path) { return `${process.env.FIT_E2E_FRONTEND_URL ?? 'http://127.0.0.1:5173'}/exercises/${path}` } }
  app = buildApp(options)
  // Fixture endpoints only exist in this loopback-only, isolated executable.
  app.post('/__fixtures/reset', async () => {
    // Holding the only runtime connection drains earlier requests before TRUNCATE.
    // This prevents reset/actor transaction deadlocks without retrying SQL errors.
    const barrier = await runtime.connect()
    try {
      await owner.query('truncate table public.profiles cascade')
      await owner.query(seed)
      mediaObjects.clear()
      profiles.clear()
      resetId += 1
      profiles.set('trainer', trainerId)
      profiles.set('client', clientId)
      await owner.query(`insert into app_private.profile_rollout_assignments(profile_id,target_backend,access_mode,enabled) select id,'yandex','read_write',true from public.profiles on conflict(profile_id) do update set enabled=true,target_backend='yandex',access_mode='read_write'`)
      await owner.query(`insert into public.user_legal_acceptances(user_id,terms_version,privacy_version,source) select id,$1,$2,'existing_user' from public.profiles on conflict do nothing`, [terms, privacy])
      return { ok: true }
    } finally { barrier.release() }
  })
  app.post('/__fixtures/session', async request => {
    const value = request.body
    if (!value || typeof value.key !== 'string' || value.key.length > 200 || !['client','trainer'].includes(value.role)) return { error: 'invalid_fixture_identity' }
    let id = profiles.get(value.key)
    if (id === undefined) {
      if (typeof value.firstName !== 'string' || value.firstName.length < 1 || value.firstName.length > 120) return { error: 'invalid_fixture_name' }
      id = uuid(`${resetId}:${value.key}`)
      await owner.query('insert into public.profiles(id,account_role,first_name,timezone) values($1,$2,$3,$4)', [id,value.role,value.firstName,'Europe/Moscow'])
      if (value.role === 'trainer') await owner.query('insert into public.trainers(profile_id) values($1)',[id])
      await owner.query("insert into app_private.profile_rollout_assignments(profile_id,target_backend,access_mode,enabled) values($1,'yandex','read_write',true)",[id])
      await owner.query("insert into public.user_legal_acceptances(user_id,terms_version,privacy_version,source) values($1,$2,$3,'existing_user')",[id,terms,privacy])
      profiles.set(value.key,id)
    }
    const token = createHash('sha256').update(`${databaseName}:${resetId}:${id}:${++sessionSequence}`).digest('base64url')
    await owner.query("insert into app_private.yandex_app_sessions(token_sha256,profile_id,expires_at) values($1,$2,now()+interval '1 day') on conflict(token_sha256) do nothing",[sha(token),id])
    return { profileId: id, token, expiresAt: new Date(Date.now()+86_400_000).toISOString() }
  })
  app.get('/__fixtures/media/*', async (request, reply) => {
    const key = request.url.slice('/__fixtures/media/'.length)
    const item = mediaObjects.get(key)
    if (item === undefined) return reply.code(404).send()
    return reply.header('content-type',item.contentType).send(item.bytes)
  })
  origin = await app.listen({ host: '127.0.0.1', port: 0 })
  process.stdout.write(JSON.stringify({ event: 'native_fixture_ready', origin })+'\n')
} catch (error) {
  process.stderr.write(`Native browser fixture failed: ${error instanceof Error ? error.message : 'unknown_error'}\n`)
  await stop()
  process.exitCode = 1
}
