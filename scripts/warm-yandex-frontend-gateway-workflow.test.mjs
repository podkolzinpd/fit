import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const workflow = await readFile(
  new URL('../.github/workflows/warm-yandex-frontend-gateway.yml', import.meta.url),
  'utf8',
)

test('warmup is default-off, read-only, bounded and has no chat notifications or secrets', () => {
  assert.match(workflow, /cron: '3-58\/5 \* \* \* \*'/)
  assert.match(workflow, /workflow_dispatch:/)
  assert.match(workflow, /vars\.YC_FRONTEND_GATEWAY_WARMUP_ENABLED == 'true'/)
  assert.match(workflow, /permissions:\n  contents: read/)
  assert.match(workflow, /timeout-minutes: 2/)
  assert.match(workflow, /node scripts\/probe-frontend-gateway-warmup\.mjs/)
  assert.doesNotMatch(workflow, /secrets\.|id-token: write|slack|telegram|send-message|terraform|yc /i)
})
