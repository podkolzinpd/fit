import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const workflowUrl = new URL(
  '../.github/workflows/manage-domain-change-push.yml',
  import.meta.url,
)

test('domain-change push workflow is manual, main-only, and confirmation-gated', async () => {
  const workflow = await readFile(workflowUrl, 'utf8')

  assert.match(workflow, /^on:\n  workflow_dispatch:$/m)
  assert.match(workflow, /test "\$GITHUB_REF" = 'refs\/heads\/main'/)
  assert.match(workflow, /QUEUE_DOMAIN_CHANGE_ANNOUNCEMENT/)
  assert.match(workflow, /options:\n          - inspect\n          - enqueue/)
  assert.match(workflow, /\/stage\/push\/domain-change-announcement/)
  assert.match(workflow, /\.inserted == 0/)
  assert.doesNotMatch(workflow, /schedule:/)
})
