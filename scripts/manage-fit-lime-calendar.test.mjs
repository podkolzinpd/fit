import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const workflow = readFileSync(new URL('../.github/workflows/manage-fit-lime-calendar.yml', import.meta.url), 'utf8')
const enrollment = readFileSync(new URL('../.github/workflows/enroll-fit-lime-trainer.yml', import.meta.url), 'utf8')

test('trainer enrollment is bounded main-only and stores no public account input', () => {
  assert.match(enrollment, /workflow_dispatch:/)
  assert.doesNotMatch(enrollment, /\n\s+(push|schedule):/)
  assert.match(enrollment, /test "\$GITHUB_REF" = refs\/heads\/main/)
  assert.match(enrollment, /test "\$CONFIRMATION" = ADD_ONE_REVIEWED_TRAINER/)
  assert.match(enrollment, /group: yandex-stage\n\s+cancel-in-progress: false/)
  assert.match(enrollment, /secrets.FIT_LIME_ADDITIONAL_TRAINER_LOGIN_SHA256/)
  assert.doesNotMatch(enrollment, /inputs\.(login|email|hash|profile)|DATABASE_URL|terraform apply|[0-9a-f]{64}/)
  assert.doesNotMatch(enrollment, /echo.*REVIEWED_LOGIN_SHA256|\bcat\b.*request_file|set -x/)
})

test('trainer enrollment uses private IAM and verifies counts twice without exposing identity', () => {
  assert.match(enrollment, /scripts\/yandex-github-oidc\.sh/)
  assert.match(enrollment, /migration_container_url/)
  assert.match(enrollment, /\/stage\/experiments\/trainer-lime-cohort/)
  assert.match(enrollment, /for response_file in cohort-response.json cohort-readback.json/)
  assert.match(enrollment, /\.approvedRows == 3/)
  assert.match(enrollment, /\.added == false/)
  assert.match(enrollment, /jq '\{approvedRows, added\}' cohort-readback.json/)
})

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
