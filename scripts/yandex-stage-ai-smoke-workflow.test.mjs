import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

const workflow = readFileSync(
  join(import.meta.dirname, '..', '.github', 'workflows', 'smoke-yandex-stage-ai.yml'),
  'utf8',
)

test('runs paid Yandex AI smoke only by explicit main-branch dispatch', () => {
  assert.match(workflow, /workflow_dispatch:/)
  assert.doesNotMatch(workflow, /\n\s+push:/)
  assert.doesNotMatch(workflow, /\n\s+schedule:/)
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/)
  assert.match(workflow, /CONFIRMATION: \$\{\{ inputs\.confirmation \}\}/)
  assert.match(workflow, /test "\$CONFIRMATION" = RUN_PAID_AI_SMOKE/)
})

test('uses only ephemeral auth and synthetic data for one parser and summary check', () => {
  assert.match(workflow, /scripts\/yandex-github-oidc\.sh/)
  assert.match(workflow, /\/stage\/fixtures\/workout-read-model/)
  assert.match(workflow, /\/v1\/assistant\/yandex\/parse-workout/)
  assert.match(workflow, /\/training-summaries\/generate/)
  assert.match(workflow, /force: true/)
  assert.match(workflow, /Тестовая тяга Yandex stage/)
  assert.match(workflow, /chmod 600 ai-smoke-/)
  assert.doesNotMatch(workflow, /actions\/upload-artifact/)
})
