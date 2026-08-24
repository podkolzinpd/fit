import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const workflow = readFileSync(
  join(import.meta.dirname, '..', '.github', 'workflows', 'ci.yml'),
  'utf8',
)

test('isolates WebKit behavior tests and retries only a failed shard', () => {
  assert.match(workflow, /Run iPhone behavior scenarios in isolated shards/)
  assert.match(workflow, /for shard in \{1\.\.8\}/)
  assert.match(workflow, /--shard="\$\{shard\}\/8"/)
  assert.match(workflow, /if ! run_webkit_shard "\$shard"/)
  assert.match(workflow, /retrying once in a fresh container/)
  assert.doesNotMatch(
    workflow,
    /npx playwright test --project=iphone-13-webkit --workers=1/,
  )
})
