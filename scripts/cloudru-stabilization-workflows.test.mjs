import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

const read = name => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8')
const configurations = ['configure-cloudru-ai', 'configure-cloudru-background', 'configure-cloudru-speech']

for (const name of configurations) {
  test(`${name} requires green exact-main, a trusted host and the shared VM lock`, () => {
    const workflow = read(`.github/workflows/${name}.yml`)
    assert.match(workflow, /test "\$GITHUB_REF" = refs\/heads\/main/)
    assert.match(workflow, /test "\$commit" = "\$GITHUB_SHA"/)
    assert.match(workflow, /\.conclusion == "success"/)
    assert.match(workflow, /\.head_repository.full_name == \$repo/)
    assert.match(workflow, /\.path == "\.github\/workflows\/ci.yml"/)
    assert.match(workflow, /test "\$\(hostname\)" = fit-stage-app/)
    assert.match(workflow, /group: cloudru-stage-vm\n  cancel-in-progress: false/)
    assert.doesNotMatch(workflow, /\n  (push|pull_request|schedule):|add-access-binding|terraform apply|system:allUsers/)
  })
}

test('all new operational shell steps parse without performing any infrastructure operations', () => {
  for (const name of [...configurations, 'backup-cloudru-production', 'inspect-cloudru-operations', 'route-legacy-yandex-to-cloudru']) {
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

test('legacy routing is manually confirmed and never changes database or IAM resources', () => {
  const workflow = read('.github/workflows/route-legacy-yandex-to-cloudru.yml')
  assert.match(workflow, /group: yandex-stage/)
  assert.match(workflow, /ROUTE_OLD_ADDRESSES_TO_CLOUDRU/)
  assert.match(workflow, /test "\$commit" = "\$GITHUB_SHA"/)
  assert.doesNotMatch(workflow, /\n  (push|schedule):|terraform apply|add-access-binding|DATABASE_PASSWORD|SUPABASE_/)
})

test('offsite restore cannot connect to production or expose a database port and never publishes dumps', () => {
  const workflow = read('.github/workflows/backup-cloudru-production.yml')
  const restore = workflow.slice(workflow.indexOf('      - name: Restore downloaded backup'), workflow.indexOf('      - name: Remove only'))
  assert.match(restore, /--network=none/)
  assert.match(restore, /POSTGRES_DB=fit_restore/)
  assert.match(restore, /--dbname fit_restore/)
  assert.match(restore, /has_table_privilege\('fit_api'/)
  assert.match(restore, /c.relrowsecurity/)
  assert.doesNotMatch(restore, /--no-acl/)
  assert.doesNotMatch(restore, /--publish|--network=host|10\.70\.10\.67|DATABASE_PASSWORD/)
  assert.match(workflow, /sudo rm -f --/)
  assert.doesNotMatch(workflow, /upload-artifact|rm -rf|volume prune|--dbname fit(?:\s|$)/)
  assert.match(workflow, /CLOUDRU_BACKUP_ENCRYPTION_KEY/)
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
  const workflow = read('.github/workflows/configure-cloudru-speech.yml')
  assert.match(workflow, /cloudru-smoke.mjs upstream/)
  assert.match(workflow, /cloudru-smoke.mjs guard/)
  assert.doesNotMatch(workflow, /secrets\.|MIGRATION_DATABASE_|DATABASE_PASSWORD/)
  const nginx = read('infra/cloudru/nginx-public-api.conf')
  assert.match(nginx, /location = \/stt/)
  assert.match(nginx, /proxy_pass http:\/\/127\.0\.0\.1:18084\/stt/)
  assert.match(nginx, /proxy_set_header Upgrade \$http_upgrade/)
})
