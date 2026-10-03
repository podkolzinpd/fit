import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const workflow = readFileSync(new URL('../.github/workflows/manage-fit-lime-calendar.yml', import.meta.url), 'utf8')

test('calendar data writes are explicit main-only bounded operations', () => {
  assert.match(workflow, /workflow_dispatch:/)
  assert.doesNotMatch(workflow, /\n\s+(push|schedule):/)
  assert.match(workflow, /test "\$GITHUB_REF" = refs\/heads\/main/)
  assert.match(workflow, /test "\$CONFIRMATION" = SEED_FIT_LIME_30_CLIENTS_120_WORKOUTS/)
  assert.match(workflow, /test "\$CONFIRMATION" = CLEANUP_FIT_LIME_CALENDAR/)
  assert.match(workflow, /group: yandex-stage\n\s+cancel-in-progress: false/)
  assert.doesNotMatch(workflow, /trainer_id:|client_id:|DATABASE_URL|terraform apply/)
})

test('calendar operation uses private IAM and confirms exact readback', () => {
  assert.match(workflow, /scripts\/yandex-github-oidc\.sh/)
  assert.match(workflow, /migration_container_url/)
  assert.match(workflow, /\/stage\/experiments\/fit-lime-calendar/)
  assert.match(workflow, /\.isolated == true/)
  assert.match(workflow, /\.clients == 15 and \.workouts == 60/)
  assert.match(workflow, /diff <\(jq -S '\.trainers' calendar-response.json\)/)
  assert.match(workflow, /path: infra\/yandex\/calendar-readback.json/)
})
