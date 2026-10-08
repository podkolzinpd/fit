import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
const workflow=readFileSync(new URL('../.github/workflows/manage-client-lime-rollout.yml',import.meta.url),'utf8')
test('client rollout is main-only manual, inspect by default and requires validated confirmation',()=>{
  assert.match(workflow,/workflow_dispatch:/)
  assert.doesNotMatch(workflow,/\n\s+(push|schedule|workflow_run|workflow_call):/)
  assert.match(workflow,/default: inspect/)
  assert.match(workflow,/test "\$GITHUB_REF" = refs\/heads\/main/)
  assert.match(workflow,/node scripts\/lime-rollout-request\.mjs request/)
  assert.match(workflow,/expected_revision:/)
  assert.match(workflow,/confirmation:/)
  assert.match(workflow,/group: yandex-stage\n\s+cancel-in-progress: false/)
})
test('client rollout uses private Yandex IAM only, single write and independent verified readback',()=>{
  assert.match(workflow,/scripts\/yandex-github-oidc\.sh/)
  assert.match(workflow,/migration_container_url/)
  assert.match(workflow,/\/stage\/experiments\/lime-rollout/)
  assert.match(workflow,/LIME_MODE=inspect EXPECTED_REVISION= CONFIRMATION=/)
  assert.match(workflow,/node scripts\/lime-rollout-request\.mjs verify/)
  assert.doesNotMatch(workflow,/supabase|DATABASE_URL|terraform apply|--retry|set -x|curl -v/)
})
