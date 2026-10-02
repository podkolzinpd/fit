import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const workflow = await readFile(
  new URL('../.github/workflows/verify-production-domain-redirect.yml', import.meta.url),
  'utf8',
)

test('scheduled redirect monitor is read-only, bounded and stores a sanitized report', () => {
  assert.match(workflow, /schedule:\n\s+- cron: '17 \*\/6 \* \* \*'/)
  assert.match(workflow, /workflow_dispatch:/)
  assert.match(workflow, /permissions:\n\s+contents: read/)
  assert.match(workflow, /timeout-minutes: 5/)
  assert.match(workflow, /verify-production-domain-redirect\.mjs --report/)
  assert.match(workflow, /probe-production-frontend\.mjs --report production-frontend-network\.json/)
  assert.match(workflow, /production-frontend-network\.json\n/)
  assert.match(workflow, /actions\/upload-artifact@v4/)
  assert.doesNotMatch(workflow, /id-token: write|secrets\.|terraform|aws |yc /)
})
