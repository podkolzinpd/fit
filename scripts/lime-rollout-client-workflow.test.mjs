import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
const workflow=readFileSync(new URL('../.github/workflows/manage-client-lime-rollout.yml',import.meta.url),'utf8')
test('client rollout is main-only manual, inspect by default and requires validated confirmation',()=>{
  assert.match(workflow,/workflow_dispatch:/)
  assert.doesNotMatch(workflow,/\n\s+(push|schedule|workflow_run|workflow_call):/)
  assert.match(workflow,/default: inspect/)
  assert.match(workflow,/test "\$GITHUB_REF" = refs\/heads\/main/)
  assert.match(workflow,/node \/request\.mjs request/)
  assert.match(workflow,/expected_revision:/)
  assert.match(workflow,/confirmation:/)
  assert.match(workflow,/group: cloudru-stage-vm\n\s+cancel-in-progress: false/)
})
test('client rollout uses the current private Cloud.ru owner and existing atomic manager',()=>{
  assert.match(workflow,/runs-on: \[self-hosted, cloudru-stage\]/)
  assert.match(workflow,/test "\$\(hostname\)" = fit-stage-app/)
  assert.match(workflow,/CLOUDRU_STAGE_DATABASE_CONFIG_JSON/)
  assert.match(workflow,/MIGRATION_DATABASE_USER == "fit_owner"/)
  assert.match(workflow,/MIGRATION_DATABASE_URL == null/)
  assert.match(workflow,/sudo install -m 600/)
  assert.match(workflow,/RUNNING_SHA/)
  assert.match(workflow,/Config.Image/)
  assert.match(workflow,/--read-only/)
  assert.match(workflow,/cloudru-client-lime-rollout\.mjs/)
  assert.doesNotMatch(workflow,/supabase|terraform|yandex-github-oidc|DATABASE_URL:|--retry|set -x|curl -v/)
})
test('all build channels retain the client pilot until an explicit all',()=>{
  for(const name of ['prepare-cloudru-frontend','release-android-ota','android-build','deploy-yandex-frontend']){
    const text=readFileSync(new URL(`../.github/workflows/${name}.yml`,import.meta.url),'utf8')
    assert.ok(text.includes("VITE_CLIENT_WORKOUT_ROLLOUT_MODE: ${{ vars.VITE_CLIENT_WORKOUT_ROLLOUT_MODE || 'pilot' }}"),name)
  }
})

// Cloud.ru runners provide Podman, not a host Node installation.
test('input validation uses the verified API container before creating owner credentials',()=>{
  assert.doesNotMatch(workflow,/^\s+node scripts\//m)
  assert.match(workflow,/-v "\$PWD\/scripts\/lime-rollout-request\.mjs:\/request\.mjs:ro" "localhost\/fit-api:\$revision" node \/request\.mjs request/)
  const verifiedImage=workflow.indexOf('test "$(sudo podman inspect fit-api-stage')
  const validation=workflow.indexOf('node /request.mjs request')
  const ownerCredentials=workflow.indexOf('sudo install -m 600')
  assert.ok(verifiedImage>0 && verifiedImage<validation && validation<ownerCredentials)
  assert.match(workflow,/-e LIME_TARGET=client -e "LIME_MODE=\$LIME_MODE" -e "EXPECTED_REVISION=\$EXPECTED_REVISION" -e "CONFIRMATION=\$CONFIRMATION"/)
})
