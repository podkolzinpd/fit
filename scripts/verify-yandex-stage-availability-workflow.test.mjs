import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const workflow = await readFile(
  new URL('../.github/workflows/verify-yandex-stage-availability.yml', import.meta.url),
  'utf8',
)

test('is manual-only and serializes with stage deployments', () => {
  assert.match(workflow, /^  workflow_dispatch:$/m)
  assert.doesNotMatch(workflow, /^  push:$/m)
  assert.match(workflow, /^  group: yandex-stage$/m)
  assert.match(workflow, /^  cancel-in-progress: false$/m)
})

test('defaults to a 50-minute sequence of exactly 1000 probes', () => {
  assert.match(workflow, /^      probe_count:$/m)
  assert.match(workflow, /^        default: 1000$/m)
  assert.match(workflow, /^      probe_interval_seconds:$/m)
  assert.match(workflow, /^        default: 3$/m)
  assert.match(workflow, /--count "\$PROBE_COUNT"/)
  assert.match(
    workflow,
    /--interval-ms "\$\(\( PROBE_INTERVAL_SECONDS \* 1000 \)\)"/,
  )
})

test('reads state and refuses to observe an unprovisioned revision', () => {
  assert.match(workflow, /terraform show -json/)
  assert.match(workflow, /yandex_serverless_container\.api/)
  assert.match(workflow, /\.provision_policy\[0\]\.min_instances/)
  assert.match(workflow, /min_instances=\$min_instances; expected 1/)
  assert.match(workflow, /--expected-release-id "\$EXPECTED_RELEASE_ID"/)
})

test('does not mutate Terraform or hide API request retries', () => {
  assert.doesNotMatch(workflow, /terraform (?:apply|destroy|import)/)
  assert.doesNotMatch(workflow, /terraform plan/)
  assert.doesNotMatch(workflow, /curl[\s\S]*?--retry/)
  assert.match(workflow, /verify-yandex-api-availability\.mjs/)
})

test('retains a short sanitized report for successful and failed observations', () => {
  assert.match(workflow, /if: always\(\)/)
  assert.match(workflow, /failure_category=/)
  assert.match(workflow, /actions\/upload-artifact@v4/)
  assert.match(workflow, /retention-days: 3/)
})
