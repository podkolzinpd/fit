import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { planMediaAclReadRepair } from './repair-cloudru-media-acl.mjs'

const read = name => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8')
const configurations = ['configure-cloudru-ai', 'configure-cloudru-background', 'configure-cloudru-speech', 'configure-cloudru-nutrition']

for (const name of configurations) {
  test(`${name} requires green exact-main, a trusted host and the shared VM lock`, () => {
    const workflow = read(`.github/workflows/${name}.yml`)
    assert.match(workflow, /test "\$GITHUB_REF" = refs\/heads\/main/)
    assert.match(workflow, /test "\$commit" = "\$GITHUB_SHA"/)
    assert.match(workflow, /\.conclusion == "success"/)
    assert.match(workflow, /\.head_repository.full_name == \$repo/)
    assert.match(workflow, /\.path == "\.github\/workflows\/ci.yml"/)
    // Production runner has curl/jq, but no GitHub CLI. Keep the source guard executable there.
    assert.doesNotMatch(workflow, /\bgh api\b/)
    assert.match(workflow, /curl --fail --silent --show-error --max-time 15/)
    assert.match(workflow, /Authorization: Bearer \$GH_TOKEN/)
    assert.match(workflow, /github_api commits\/main \| jq -er \.sha/)
    assert.match(workflow, /test "\$\(hostname\)" = fit-stage-app/)
    assert.match(workflow, /group: cloudru-stage-vm\n  cancel-in-progress: false/)
    assert.doesNotMatch(workflow, /\n  (push|pull_request|schedule):|add-access-binding|terraform apply|system:allUsers/)
  })
}

test('all new operational shell steps parse without performing any infrastructure operations', () => {
  for (const name of [...configurations, 'backup-cloudru-production', 'inspect-cloudru-operations', 'maintain-cloudru-runner-disk', 'route-legacy-yandex-to-cloudru', 'repair-cloudru-media-acl']) {
    const workflow = read(`.github/workflows/${name}.yml`)
    for (const match of workflow.matchAll(/\n        run: \|\n([\s\S]*?)(?=\n      - |$)/g)) {
      const result = spawnSync('bash', ['-n'], { input: match[1].replace(/^          /gm, ''), encoding: 'utf8' })
      assert.equal(result.status, 0, `${name}: ${result.stderr}`)
    }
  }
  for (const path of ['scripts/promote-cloudru-speech.sh', 'infra/cloudru/fit-cloudru-background', 'infra/cloudru/fit-cloudru-speechkit']) {
    assert.equal(spawnSync('bash', ['-n'], { input: read(path), encoding: 'utf8' }).status, 0, path)
  }
})

test('root expansion is manual, VM-bound and constrained to the known ext4 root partition', () => {
  const workflow = read('.github/workflows/maintain-cloudru-runner-disk.yml')
  assert.match(workflow, /options: \[inspect, inspect-root, extend-root, apply\]/)
  assert.match(workflow, /RETENTION_CONFIRMATION" = EXPAND_CLOUDRU_ROOT_FILESYSTEM/)
  assert.match(workflow, /test "\$root_source" = \/dev\/vda2/)
  assert.match(workflow, /test "\$root_fstype" = ext4/)
  assert.match(workflow, /test "\$disk_bytes" -ge 60000000000/)
  assert.match(workflow, /test "\$partition_bytes" -lt "\$disk_bytes"/)
  assert.match(workflow, /sudo growpart \/dev\/vda 2/)
  assert.match(workflow, /sudo resize2fs \/dev\/vda2/)
  assert.match(workflow, /test "\$expanded_kib" -ge 58593750/)
  assert.match(workflow, /Root filesystem inspection complete; nothing was changed/)
})

const mediaApp = 'b87cd7c3-c737-4cd7-87b3-6591dd9b3ec9'
const mediaAcl = () => ({ Owner: { ID: 'fixture-owner' }, Grants: [
  { Grantee: { Type: 'CanonicalUser', ID: 'fixture-owner' }, Permission: 'FULL_CONTROL' },
  { Grantee: { Type: 'CanonicalUser', ID: mediaApp }, Permission: 'READ' },
  { Grantee: { Type: 'CanonicalUser', ID: mediaApp }, Permission: 'WRITE' },
] })

test('media ACL repair preserves owner and app data grants and adds only READ_ACP', () => {
  const acl = mediaAcl()
  const before = structuredClone(acl)
  assert.deepEqual(planMediaAclReadRepair(acl), { changed: true, headers: {
    GrantRead: `id="${mediaApp}"`, GrantWrite: `id="${mediaApp}"`,
    GrantReadACP: `id="${mediaApp}"`, GrantFullControl: 'id="fixture-owner"',
  } })
  assert.deepEqual(acl, before)
})

test('media ACL repair is idempotent when app already has ACL read or full control', () => {
  for (const permission of ['READ_ACP', 'FULL_CONTROL']) {
    const acl = mediaAcl()
    acl.Grants.push({ Grantee: { Type: 'CanonicalUser', ID: mediaApp }, Permission: permission })
    assert.equal(planMediaAclReadRepair(acl).changed, false)
  }
})

test('media ACL repair rejects public, unknown or malformed grants before mutation', () => {
  for (const grant of [
    { Grantee: { Type: 'Group', URI: 'http://acs.amazonaws.com/groups/global/AllUsers' }, Permission: 'READ' },
    { Grantee: { Type: 'CanonicalUser', ID: 'unexpected-account' }, Permission: 'READ' },
    { Grantee: { Type: 'CanonicalUser', ID: mediaApp }, Permission: 'UNKNOWN' },
  ]) {
    const acl = mediaAcl()
    acl.Grants.push(grant)
    assert.throws(() => planMediaAclReadRepair(acl), /media_acl_requires_review/)
  }
  assert.throws(() => planMediaAclReadRepair({}), /media_acl_invalid/)
})

test('media ACL repair is manual, bucket-bound and uses only existing media credentials', () => {
  const workflow = read('.github/workflows/repair-cloudru-media-acl.yml')
  assert.match(workflow, /GRANT_APP_MEDIA_ACL_READ_ONLY/)
  assert.match(workflow, /test "\$GITHUB_REF" = refs\/heads\/main/)
  assert.match(workflow, /test "\$\(hostname\)" = fit-stage-app/)
  assert.match(workflow, /group: cloudru-stage-vm\n  cancel-in-progress: false/)
  assert.deepEqual([...workflow.matchAll(/secrets\.([A-Z0-9_]+)/g)].map(match => match[1]),
    ['CLOUDRU_MEDIA_MIGRATION_KEY_ID', 'CLOUDRU_MEDIA_MIGRATION_KEY_SECRET'])
  const command = read('scripts/repair-cloudru-media-acl.mjs')
  assert.match(command, /const bucket = 'fit-cloudru-stage-media-c2ad3760'/)
  assert.doesNotMatch(command, /PutBucketPolicyCommand|PutBucketOwnershipControlsCommand|CreateAccessKey|DATABASE_/)
  assert.doesNotMatch(workflow, /schedule:|push:|pull_request:|add-access-binding/)
})

test('legacy routing is manually confirmed and never changes database or IAM resources', () => {
  const workflow = read('.github/workflows/route-legacy-yandex-to-cloudru.yml')
  assert.match(workflow, /group: yandex-stage/)
  assert.match(workflow, /ROUTE_OLD_ADDRESSES_TO_CLOUDRU/)
  assert.match(workflow, /test "\$commit" = "\$GITHUB_SHA"/)
  assert.doesNotMatch(workflow, /\n  (push|schedule):|terraform apply|add-access-binding|DATABASE_PASSWORD|SUPABASE_/)
})

test('offsite restore cannot connect to production or expose a database port and never publishes dumps', () => {
  const workflow = read('.github/workflows/backup-cloudru-production.yml')
  const restore = workflow.slice(workflow.indexOf('      - name: Restore downloaded backup'), workflow.indexOf('      - name: Verify private media after'))
  assert.match(restore, /--network=none/)
  assert.match(restore, /POSTGRES_DB=fit_restore/)
  assert.match(restore, /pg_isready -h 127\.0\.0\.1 -U fit_owner -d fit_restore/)
  assert.match(restore, /--dbname fit_restore/)
  assert.match(restore, /has_table_privilege\('fit_api'/)
  assert.match(restore, /c.relrowsecurity/)
  assert.match(restore, /create role fit_api nologin; create role fit_datalens nologin;/)
  assert.doesNotMatch(restore, /--no-acl/)
  assert.doesNotMatch(restore, /--publish|--network=host|10\.70\.10\.67|DATABASE_PASSWORD/)
  assert.match(workflow, /sudo rm -f --/)
  assert.doesNotMatch(workflow, /upload-artifact|rm -rf|volume prune|--dbname fit(?:\s|$)/)
  assert.match(workflow, /CLOUDRU_BACKUP_ENCRYPTION_KEY/)
  assert.match(workflow, /CLOUDRU_BACKUP_KEY_ID: \$\{\{ secrets\.CLOUDRU_BACKUP_KEY_ID \}\}/)
  assert.match(workflow, /CLOUDRU_BACKUP_KEY_SECRET: \$\{\{ secrets\.CLOUDRU_BACKUP_KEY_SECRET \}\}/)
  const backupRun = workflow.slice(workflow.indexOf('      - name: Back up only'), workflow.indexOf('      - name: Restore downloaded'))
  assert.match(backupRun, /for name in CLOUDRU_BACKUP_KEY_ID CLOUDRU_BACKUP_KEY_SECRET CLOUDRU_BACKUP_ACCOUNT_ID CLOUDRU_BACKUP_ENCRYPTION_KEY BACKUP_MODE/)
  assert.match(backupRun, /for name in CLOUDRU_MEDIA_KEY_ID CLOUDRU_MEDIA_KEY_SECRET BACKUP_MODE/)
  assert.match(backupRun, /--env-file "\$private_env"[^\n]*\n[^\n]*\n[^\n]*cloudru-backup\.js/)
  const mediaRun = workflow.slice(workflow.indexOf('      - name: Verify private media after'), workflow.indexOf('      - name: Remove only'))
  assert.match(mediaRun, /--env-file "\$media_env"[^\n]*\n[^\n]*cloudru-media-health\.js/)
  assert.doesNotMatch(backupRun, /cloudru-media-health\.js/)
  assert.doesNotMatch(restore, /cloudru-media-health\.js|continue-on-error/)
  assert.ok(workflow.indexOf('date -u +%Y-%m-%dT%H:%M:%SZ') < workflow.indexOf('      - name: Verify private media after'))
  assert.doesNotMatch(mediaRun, /continue-on-error|--env-file "\$private_env"/)
  assert.doesNotMatch(read('services/api/src/cloudru-backup.ts'), /PutBucketAclCommand|PutBucketPolicyCommand/)
  assert.match(workflow, /"\/opt\/fit\/secrets\/media-health-\$id\.env"/)
  for (const runtime of ['start-cloudru-api-stage', 'release-cloudru-api-stage']) {
    assert.doesNotMatch(read(`.github/workflows/${runtime}.yml`), /CLOUDRU_BACKUP_KEY_(?:ID|SECRET)/)
  }
})

test('restore table inventory excludes ACL, table data and partition attachment entries', () => {
  const workflow = read('.github/workflows/backup-cloudru-production.yml')
  const program = workflow.match(/\| awk '(\$4 == "TABLE"[^']+)'/)[1]
  const inventory = [
    '1; 1259 123 TABLE public workouts fit_owner',
    '2; 1259 124 TABLE app_private fit_migrations fit_owner',
    '3; 0 123 TABLE DATA public workouts fit_owner',
    '4; 0 0 ACL public TABLE workouts fit_owner',
    '5; 0 0 COMMENT public TABLE workouts fit_owner',
    '6; 0 0 TABLE ATTACH public workouts_partition fit_owner',
  ].join('\n')
  const result = spawnSync('awk', [program], { input: inventory, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout.trim(), '2')
})

test('disposable restore image includes the production audit extension without importing secrets', () => {
  const image = read('infra/cloudru/backup-restore.Dockerfile')
  assert.match(image, /postgres:17@sha256:[a-f0-9]{64}/)
  assert.match(image, /postgresql-17-pgaudit=17\.1-2\.pgdg13\+1/)
  assert.match(image, /shared_preload_libraries=pg_stat_statements,pgaudit/)
  assert.match(image, /pgaudit\.log=none/)
  assert.match(image, /log_min_messages=panic/)
  assert.match(image, /log_min_error_statement=panic/)
  assert.doesNotMatch(image, /^(COPY|ADD|ARG|ENV)\b/m)
  const workflow = read('.github/workflows/backup-cloudru-production.yml')
  assert.match(workflow, /image="localhost\/fit-backup-restore:\$GITHUB_SHA"/)
  assert.match(workflow, /-f infra\/cloudru\/backup-restore\.Dockerfile infra\/cloudru/)
})

test('operations monitor expects speech only when its canonical endpoint is configured', () => {
  const workflow = read('.github/workflows/inspect-cloudru-operations.yml')
  assert.match(workflow, /SPEECH_EXPECTED_URL: \$\{\{ vars\.CLOUDRU_SPEECHKIT_RELAY_URL \}\}/)
  const check = workflow.match(/          if test -n "\$SPEECH_EXPECTED_URL";[\s\S]*?\n          fi/)[0]
  for (const [url, expected] of [['', 0], ['wss://api.fit-training.ru/stt', 0], ['wss://invalid.example/stt', 1]]) {
    const script = `failed=0
check() {
  shift
  if test "$1" = test; then "$@" || failed=1; fi
}
${check}
exit "$failed"
`
    const result = spawnSync('bash', ['-c', script], { encoding: 'utf8',
      env: { ...process.env, SPEECH_EXPECTED_URL: url, GITHUB_STEP_SUMMARY: '/dev/null' } })
    assert.equal(result.status, expected, result.stderr)
    assert.equal(result.stdout.includes('Speech relay disabled'), url === '')
  }
})

test('restore extension diagnostics expose only allowlisted system names', () => {
  const workflow = read('.github/workflows/backup-cloudru-production.yml')
  const program = workflow.match(/\| awk '(\$4 == "EXTENSION"[^']+)'/)[1]
  const result = spawnSync('awk', [program], { encoding: 'utf8', input: [
    '1; 3079 123 EXTENSION - pg_stat_statements',
    '2; 3079 124 EXTENSION - synthetic-sensitive-name',
    '3; 0 0 COMMENT - EXTENSION pg_stat_statements',
  ].join('\n') })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout, 'cloudru_restore_extension=pg_stat_statements\ncloudru_restore_extension=unrecognized\n')
})

test('restore diagnostics emit only fixed categories, never private stderr', () => {
  const workflow = read('.github/workflows/backup-cloudru-production.yml')
  const classifier = workflow.match(/sudo podman exec --user 0 "\$container" (sh -c '[\s\S]*?')\n            exit 1/)[1]
  const directory = mkdtempSync(join(tmpdir(), 'fit-restore-diagnostics-'))
  try {
    const errorFile = join(directory, 'restore-error')
    for (const [error, category] of [
      ['role "fit_datalens" does not exist', 'missing_role'],
      ['permission denied for relation example', 'permission_denied'],
      ['extension example is not available', 'missing_extension'],
      ['COPY failed: synthetic-sensitive-row', 'unclassified'],
    ]) {
      writeFileSync(errorFile, `${error}\nsynthetic-sensitive-row\n`)
      const result = spawnSync('bash', ['-c', classifier.replaceAll('/tmp/restore-error', errorFile)], { encoding: 'utf8' })
      assert.equal(result.status, 0, result.stderr)
      assert.equal(result.stdout.trim(), `cloudru_restore_failed=${category}`)
      assert.equal(result.stderr, '')
    }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('background delivery boundary is persistent and existing uncertain recovery receipts are not retried', () => {
  const workflow = read('.github/workflows/configure-cloudru-background.yml')
  assert.match(workflow, /test -f \/opt\/fit\/BACKGROUND_STARTED_AT/)
  assert.match(workflow, /START_CLOUDRU_FRESH_PUSH_ONLY/)
  assert.ok(workflow.indexOf('Preserve historical outbox') < workflow.indexOf('Install the private worker'))
  const worker = read('infra/cloudru/fit-cloudru-background')
  assert.match(worker, /flock -n 9/)
  assert.doesNotMatch(worker, /--publish|fit_owner|MIGRATION_DATABASE/)
})

test('speech ingress upgrades only the authenticated loopback relay and its runtime has no database credentials', () => {
  const configure = read('.github/workflows/configure-cloudru-speech.yml')
  assert.match(configure, /SPEECHKIT_API_KEY: \$\{\{ secrets\.CLOUDRU_SPEECHKIT_API_KEY \}\}/)
  assert.match(configure, /SPEECHKIT_FOLDER_ID: \$\{\{ vars\.CLOUDRU_SPEECHKIT_FOLDER_ID \}\}/)
  assert.match(configure, /test -n "\$SPEECHKIT_API_KEY"/)
  assert.match(configure, /\[\[ "\$SPEECHKIT_FOLDER_ID" =~ \^\[a-z0-9\]\{20\}\$ \]\]/)
  assert.doesNotMatch(configure, /sudo awk|YANDEX_CLOUD_MODEL_ID/)
  const workflow = read('.github/workflows/configure-cloudru-speech.yml')
  assert.match(workflow, /cloudru-smoke.mjs upstream/)
  assert.match(workflow, /cloudru-smoke.mjs guard/)
  assert.deepEqual([...workflow.matchAll(/secrets\.([A-Z0-9_]+)/g)].map(match => match[1]), ['CLOUDRU_SPEECHKIT_API_KEY'])
  assert.doesNotMatch(workflow, /MIGRATION_DATABASE_|DATABASE_PASSWORD/)
  const inspect = read('.github/workflows/inspect-cloudru-operations.yml')
  const diagnostics = inspect.slice(inspect.indexOf('      - name: Read only aggregate SpeechKit'), inspect.indexOf('      - name: Inspect runtime'))
  assert.match(diagnostics, /inputs\.speech_diagnostics/)
  assert.match(diagnostics, /journalctl CONTAINER_NAME=fit-speechkit-cloudru/)
  assert.doesNotMatch(diagnostics, /--unit=fit-speechkit\.service/)
  const validationStart = workflow.indexOf('          test -n "$SPEECHKIT_API_KEY"')
  const validation = workflow.slice(validationStart, workflow.indexOf('          id=', validationStart)).replace(/^          /gm, '')
  // Independent validation failures, not a browser/theme matrix: nothing after
  // this prefix (files, containers, upstream calls) is executed by this test.
  for (const [key, folder, expected] of [
    ['synthetic-speech-key', 'b1goqho12tlk9dibc3f3', 0],
    ['', 'b1goqho12tlk9dibc3f3', 1],
    ['synthetic-speech-key', 'invalid-folder', 1],
    ['synthetic\nspeech-key', 'b1goqho12tlk9dibc3f3', 1],
    ['synthetic\u0007speech-key', 'b1goqho12tlk9dibc3f3', 1],
  ]) {
    const result = spawnSync('bash', ['-eu', '-c', validation], {
      env: { SPEECHKIT_API_KEY: key, SPEECHKIT_FOLDER_ID: folder }, encoding: 'utf8',
    })
    assert.equal(result.status === 0, expected === 0)
  }
  const nginx = read('infra/cloudru/nginx-public-api.conf')
  assert.match(nginx, /location = \/stt/)
  assert.match(nginx, /proxy_pass http:\/\/127\.0\.0\.1:18084\/stt/)
  assert.match(nginx, /proxy_set_header Upgrade \$http_upgrade/)
})


test('background journal report keeps only fixed flags and allowlisted database codes', () => {
  const messages = [
    { event: 'cloudru_background_failed', errorCode: '42501', message: 'private-query-values' },
    { event: 'database_pool_window', databaseErrorCode: 'private-code' },
    { event: 'yandex_session_cleanup_failed', errorCode: 'ETIMEDOUT' },
  ].map(entry => JSON.stringify({ MESSAGE: JSON.stringify(entry) }))
  messages.push(JSON.stringify({ MESSAGE: 'cloudru_background_failed' }),
    JSON.stringify({ MESSAGE: 'private-credential-value' }),
    JSON.stringify({ MESSAGE: 'background_launcher_failed:container:125' }),
    JSON.stringify({ MESSAGE: 'background_launcher_failed:private-data:125' }), 'invalid-json', '[]', 'null')
  const result = spawnSync('python3', ['scripts/cloudru-background-diagnostics.py'], {
    input: messages.join('\n'), encoding: 'utf8',
  })
  assert.equal(result.status, 0)
  const report = JSON.parse(result.stdout)
  assert.equal(report.workerFailed, true)
  assert.equal(report.sessionCleanupFailed, true)
  assert.deepEqual(report.databaseCodes, ['42501', 'ETIMEDOUT'])
  assert.deepEqual(report.launcherFailures, [{ stage: 'container', exitCode: 125 }])
  assert.doesNotMatch(result.stdout, /private-/)
})

test('manual API journal inspection exposes counts only, never user payloads or arbitrary codes', () => {
  const entry = (value, container = 'fit-api-stage') => JSON.stringify({
    CONTAINER_NAME: container, MESSAGE: JSON.stringify(value), PRIVATE_TOKEN: 'private-token',
  })
  const messages = [
    entry({ msg: 'Pilot command failed', databaseErrorCode: '23502', body: 'private-workout' }),
    entry({ msg: 'Pilot command failed', databaseErrorCode: '23502', email: 'private-email' }),
    entry({ msg: 'Pilot command failed', databaseErrorCode: 'PT422' }),
    entry({ msg: 'Pilot command failed', databaseErrorCode: 'private-code' }),
    entry({ msg: 'Pilot command failed', databaseErrorCode: 'TOKEN' }),
    entry({ msg: 'Pilot command failed', databaseErrorCode: '42702' }, 'another-container'),
    entry({ msg: 'private-message', databaseErrorCode: '42702' }),
    JSON.stringify({ CONTAINER_NAME: 'fit-api-stage', MESSAGE: 'private-raw-text' }),
    'invalid-json', '[]', 'null',
  ]
  const result = spawnSync('python3', ['scripts/cloudru-api-command-diagnostics.py'], {
    input: messages.join('\n'), encoding: 'utf8',
  })
  assert.equal(result.status, 0)
  assert.deepEqual(JSON.parse(result.stdout), {
    event: 'cloudru_api_command_error_counts', journalEntries: 7, parsedApiEntries: 6,
    failedCommands: 5, databaseCodes: { '23502': 2, PT422: 1, unknown: 2 },
  })
  assert.doesNotMatch(result.stdout, /private-|42702|another-container|TOKEN/)
  const workflow = read('.github/workflows/inspect-cloudru-operations.yml')
  const step = workflow.slice(workflow.indexOf('      - name: Read only bounded API'), workflow.indexOf('      - name: Inspect runtime'))
  assert.match(step, /github\.event_name == 'workflow_dispatch' && inputs\.api_errors/)
  assert.match(step, /test "\$GITHUB_REF" = refs\/heads\/main/)
  assert.match(step, /test "\$\(hostname\)" = fit-stage-app/)
  assert.match(step, /timeout 15 journalctl CONTAINER_NAME=fit-api-stage --since="24 hours ago" --lines=5000/)
  assert.match(step, /python3 scripts\/cloudru-api-command-diagnostics\.py \| tee/)
  assert.doesNotMatch(step, /secrets\.|--env-file|podman run|systemctl (?:restart|stop)|psql/)
})


test('request diagnostics correlate only the requested UUID and never export error messages or request data', () => {
  const id = '00000000-0000-4000-8000-000000000001'
  const row = (entry) => JSON.stringify({CONTAINER_NAME:'fit-api-stage',MESSAGE:JSON.stringify(entry)})
  const lines = [row({reqId:id,req:{body:'private-body'},msg:'private-msg'}),
    row({reqId:id,err:{type:'TypeError',code:'FST_ERR_FAILED_ERROR_SERIALIZATION',message:'private-sql',stack:'private-sql\n at x (/app/dist/planned-workout-request.js:120:3)'}}),
    row({reqId:id,res:{statusCode:500}}),row({reqId:'another',err:{type:'RangeError'}}),
    row({reqId:id,err:{type:'private-type',code:'private-code',stack:'private-stack'}}), 'null', 'invalid']
  const result = spawnSync('python3',['scripts/cloudru-api-request-diagnostics.py',id],{input:lines.join('\n'),encoding:'utf8'})
  assert.equal(result.status,0)
  const report = JSON.parse(result.stdout)
  assert.equal(report.matchedEntries,4)
  assert.deepEqual(report.statuses,[500])
  assert.deepEqual(report.errors,[{type:'TypeError',code:'FST_ERR_FAILED_ERROR_SERIALIZATION',frames:['planned-workout-request.js:120:3']},{type:'unknown',code:'unknown',frames:[]}])
  assert.doesNotMatch(result.stdout,/private-|another|reqId|body|message|stack/)
  const invalid = spawnSync('python3',['scripts/cloudru-api-request-diagnostics.py','not-a-uuid'],{input:lines.join('\n'),encoding:'utf8'})
  assert.notEqual(invalid.status,0)
  assert.equal(invalid.stdout,'')
  const workflow = read('.github/workflows/inspect-cloudru-operations.yml')
  const step = workflow.slice(workflow.indexOf('      - name: Read only bounded diagnostics for one API request'),workflow.indexOf('      - name: Read only aggregate SpeechKit'))
  assert.match(step,/github\.event_name == 'workflow_dispatch'/)
  assert.match(step,/test "\$GITHUB_REF" = refs\/heads\/main/)
  assert.match(step,/test "\$\(hostname\)" = fit-stage-app/)
  assert.match(step,/timeout 15 journalctl CONTAINER_NAME=fit-api-stage/)
  assert.match(step,/--lines=5000/)
  assert.match(step,/epoch - 120/)
  assert.match(step,/epoch \+ 120/)
  assert.doesNotMatch(step,/secrets\.|--env-file|podman run|systemctl (?:restart|stop)|psql/)
})
