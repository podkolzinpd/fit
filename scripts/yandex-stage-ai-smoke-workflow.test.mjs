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

// The public endpoint uses the same snake_case command as the browser repository.
test('summary smoke follows the actual API request parser', async () => {
  const { readAssistantProgressRequest } = await import('../services/api/src/assistant-progress-request.ts')
  const request = workflow.match(/jq -cn --arg client_id \"\$client_id\" '([\s\S]*?)' > ai-smoke-summary-request\.json/)[1]
  const clientId = '11111111-1111-4111-8111-111111111111'
  const payload = JSON.parse(request.replace(/\$client_id/g, JSON.stringify(clientId)).replace(/([a-z_]+):/g, '\"$1\":'))
  assert.deepEqual(readAssistantProgressRequest(payload), {
    clientId, periodStart: '2026-08-01', periodEnd: '2026-08-31', force: true,
    triggerReason: 'manual_refresh',
  })
})
