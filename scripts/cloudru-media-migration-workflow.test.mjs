import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

const root = join(import.meta.dirname, '..')
const workflow = readFileSync(
  join(root, '.github', 'workflows', 'migrate-yandex-media-to-cloudru.yml'),
  'utf8',
)
const migration = readFileSync(
  join(root, 'services', 'api', 'src', 'migrate-yandex-media-to-cloudru.mjs'),
  'utf8',
)

test('keeps the Yandex to Cloud.ru media transfer manual, bounded and non-deleting', () => {
  assert.match(workflow, /^on:\n  workflow_dispatch:/m)
  assert.match(workflow, /runs-on: \[self-hosted, cloudru-stage\]/)
  assert.match(workflow, /COPY_YANDEX_MEDIA_TO_CLOUDRU/)
  assert.match(workflow, /fit-chat-media-b1gt7dfq/)
  assert.match(workflow, /fit-cloudru-stage-media-c2ad3760/)
  assert.match(workflow, /secrets\.YANDEX_MEDIA_MIGRATION_SECRET_ACCESS_KEY/)
  assert.match(workflow, /secrets\.CLOUDRU_MEDIA_MIGRATION_KEY_SECRET/)
  assert.match(migration, /'chat-media\/',\s*'fit-exercise-media\/',\s*'trainer-profile-media\/'/)
  assert.match(migration, /Prefix: prefix/)
  assert.doesNotMatch(migration, /DeleteObject|deleteObjects|Remove-Item|rm\s/)
})

test('verifies copied object bytes without logging object paths', () => {
  assert.match(migration, /createHash\('sha256'\)/)
  assert.match(migration, /digest\(targetBytes\) !== sourceDigests\.get\(item\.Key\)/)
  assert.match(migration, /event: 'verification'/)
  assert.doesNotMatch(migration, /console\.log\([^\n]*(?:item\.Key|object\.Key)/)
})
