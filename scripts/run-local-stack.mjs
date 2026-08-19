import { spawn, spawnSync } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import process from 'node:process'

const POSTGRES_CONTAINER = 'fit-yandex-postgres-local'
const POSTGRES_IMAGE = 'docker.io/library/postgres:17'
const POSTGRES_DATABASE = 'fit_actor_test'
const POSTGRES_PORT = '55432'
const OWNER_DATABASE_URL = `postgresql://postgres:postgres@127.0.0.1:${POSTGRES_PORT}/${POSTGRES_DATABASE}`
const RUNTIME_DATABASE_URL = `postgresql://fit_api:fit-api-test-only@127.0.0.1:${POSTGRES_PORT}/${POSTGRES_DATABASE}`
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: options.capture ? 'pipe' : 'inherit',
    ...options,
  })

  if (result.error !== undefined) throw result.error
  if (result.status !== 0 && !options.allowFailure) {
    const details = options.capture
      ? `\n${result.stderr || result.stdout}`.trimEnd()
      : ''
    throw new Error(
      `Команда ${command} ${args.join(' ')} завершилась с ошибкой.${details}`,
    )
  }
  return result
}

function requireCommand(command, versionArguments) {
  const result = run(command, versionArguments, {
    allowFailure: true,
    capture: true,
  })
  if (result.status !== 0) {
    throw new Error(
      `Не найден ${command}. Установите и запустите Podman, затем повторите команду.`,
    )
  }
}

function startSupabase() {
  console.log('\n[local] Запускаю локальный Supabase через Podman…')
  run(npmCommand, ['run', 'db:start', '--silent'], { capture: true })
  console.log('[local] Supabase готов.')

  console.log('[local] Применяю только ещё не применённые Supabase-миграции…')
  run('npx', ['--no-install', 'supabase', 'migration', 'up', '--local'])
}

function ensureApiDependencies() {
  const lockfile = 'services/api/package-lock.json'
  const installedLockfile = 'services/api/node_modules/.package-lock.json'
  const dependenciesAreCurrent =
    existsSync(installedLockfile) &&
    statSync(installedLockfile).mtimeMs >= statSync(lockfile).mtimeMs

  if (dependenciesAreCurrent) return

  console.log('\n[local] Устанавливаю зафиксированные зависимости Fastify API…')
  run(npmCommand, ['ci', '--prefix', 'services/api'])
}

function containerExists() {
  return (
    run('podman', ['container', 'exists', POSTGRES_CONTAINER], {
      allowFailure: true,
      capture: true,
    }).status === 0
  )
}

function containerIsRunning() {
  const result = run(
    'podman',
    ['inspect', '--format', '{{.State.Running}}', POSTGRES_CONTAINER],
    { allowFailure: true, capture: true },
  )
  return result.status === 0 && result.stdout.trim() === 'true'
}

function startPostgres() {
  console.log('\n[local] Проверяю локальный PostgreSQL 17 для Yandex API…')
  if (!containerExists()) {
    run('podman', [
      'run',
      '--detach',
      '--name',
      POSTGRES_CONTAINER,
      '--publish',
      `127.0.0.1:${POSTGRES_PORT}:5432`,
      '--env',
      'POSTGRES_PASSWORD=postgres',
      '--env',
      `POSTGRES_DB=${POSTGRES_DATABASE}`,
      '--volume',
      'fit-yandex-postgres-data:/var/lib/postgresql/data',
      POSTGRES_IMAGE,
    ])
  } else if (!containerIsRunning()) {
    run('podman', ['start', POSTGRES_CONTAINER])
  }
}

async function waitForPostgres() {
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    const result = run(
      'podman',
      [
        'exec',
        POSTGRES_CONTAINER,
        'pg_isready',
        '--username',
        'postgres',
        '--dbname',
        POSTGRES_DATABASE,
      ],
      { allowFailure: true, capture: true },
    )
    if (result.status === 0) return
    await new Promise((resolve) => setTimeout(resolve, 1_000))
  }
  throw new Error(
    `PostgreSQL не стал готов за 30 секунд. Проверьте: podman logs ${POSTGRES_CONTAINER}`,
  )
}

function preparePostgres() {
  const createRuntimeRole = `do $$ begin
    if not exists (select 1 from pg_roles where rolname = 'fit_api') then
      create role fit_api login password 'fit-api-test-only';
    else
      alter role fit_api login password 'fit-api-test-only';
    end if;
  end $$;`

  run('podman', [
    'exec',
    POSTGRES_CONTAINER,
    'psql',
    '--username',
    'postgres',
    '--dbname',
    POSTGRES_DATABASE,
    '--set',
    'ON_ERROR_STOP=1',
    '--command',
    createRuntimeRole,
  ])

  console.log('[local] Применяю только ещё не применённые API-миграции…')
  run(npmCommand, ['--prefix', 'services/api', 'run', 'db:migrate'], {
    env: { ...process.env, DATABASE_URL: OWNER_DATABASE_URL },
  })
}

async function prepareLocalDatabases() {
  requireCommand('podman', ['--version'])
  ensureApiDependencies()
  startSupabase()
  startPostgres()
  await waitForPostgres()
  preparePostgres()
  console.log('\n[local] Обе локальные базы готовы.')
}

function verifyLocalDatabases() {
  console.log('\n[local] Проверяю Supabase SQL/RLS и generated types…')
  run(npmCommand, ['run', 'db:test'])
  run(npmCommand, ['run', 'db:types:check'])

  console.log('\n[local] Проверяю PostgreSQL 17 actor context и RLS…')
  run(npmCommand, ['--prefix', 'services/api', 'run', 'test:db'], {
    env: { ...process.env, TEST_DATABASE_URL: OWNER_DATABASE_URL },
  })

  console.log('\n[local] Проверяю неизменность истории миграций…')
  run('node', ['scripts/check-migrations.mjs'])
  console.log('\n[local] Все локальные проверки БД прошли.')
}

async function waitForApi(child) {
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error('Локальный API завершился до прохождения readiness-проверки.')
    }
    try {
      const response = await fetch('http://127.0.0.1:8080/ready')
      if (response.ok) return
    } catch {
      // API ещё запускается.
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error('Локальный API не прошёл /ready за 15 секунд.')
}

function spawnInherited(command, args, env = process.env) {
  return spawn(command, args, { env, stdio: 'inherit' })
}

async function runDevelopmentServers() {
  console.log('\n[local] Собираю и запускаю Fastify API…')
  run(npmCommand, ['--prefix', 'services/api', 'run', 'build'])
  const api = spawnInherited(
    npmCommand,
    ['--prefix', 'services/api', 'run', 'start'],
    {
      ...process.env,
      DATABASE_URL: RUNTIME_DATABASE_URL,
      PORT: '8080',
    },
  )

  await waitForApi(api)
  console.log('[local] API готов: http://127.0.0.1:8080')
  console.log('[local] Запускаю frontend…\n')
  const frontend = spawnInherited(npmCommand, ['run', 'dev:frontend'])
  const children = [api, frontend]

  const stop = () => {
    for (const child of children) {
      if (child.exitCode === null) child.kill('SIGTERM')
    }
  }
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)

  await Promise.race(
    children.map(
      (child) =>
        new Promise((resolve) => child.once('exit', resolve)),
    ),
  )
  stop()
  const failedChild = children.find(
    (child) => child.exitCode !== null && child.exitCode !== 0,
  )
  if (failedChild !== undefined) process.exitCode = failedChild.exitCode ?? 1
}

try {
  await prepareLocalDatabases()
  if (process.argv.includes('--verify')) verifyLocalDatabases()
  if (process.argv.includes('--dev')) await runDevelopmentServers()
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`\n[local] Не удалось подготовить окружение: ${message}`)
  console.error('[local] Облачные базы и данные не изменялись.')
  process.exitCode = 1
}
