import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

const workflowsDirectory = join(import.meta.dirname, '..', '.github', 'workflows')

test('keeps external media bucket credentials version-pinned and consistent for API and migration', () => {
  const infra = join(import.meta.dirname, '..', 'infra', 'yandex')
  const container = readFileSync(join(infra, 'container.tf'), 'utf8')
  const locals = readFileSync(join(infra, 'locals.tf'), 'utf8')
  const variables = readFileSync(join(infra, 'variables.tf'), 'utf8')
  const media = readFileSync(join(infra, 'media.tf'), 'utf8')
  const workflow = readFileSync(join(workflowsDirectory, 'deploy-yandex-stage.yml'), 'utf8')
  assert.match(workflow, /TF_VAR_media_s3_credentials_override: \$\{\{ vars\.YC_STAGE_MEDIA_S3_CREDENTIALS \|\| 'null' \}\}/)
  assert.match(variables, /variable "media_s3_credentials_override"[\s\S]*?secret_id\s+= string[\s\S]*?version_id = string/)
  assert.match(locals, /media_s3_secret_id = \([\s\S]*?var\.media_s3_credentials_override == null[\s\S]*?yandex_lockbox_secret\.media_s3_credentials\.id[\s\S]*?: var\.media_s3_credentials_override\.secret_id/)
  assert.match(locals, /media_s3_secret_version_id = \([\s\S]*?output_to_lockbox_version_id[\s\S]*?: var\.media_s3_credentials_override\.version_id/)
  assert.match(container, /External media credentials require an explicit media bucket override/)
  const mounts = [...container.matchAll(/secrets \{\s+id\s+= local\.media_s3_secret_id\s+version_id\s+= local\.media_s3_secret_version_id\s+key\s+= "(YANDEX_MEDIA_[A-Z_]+)"\s+environment_variable\s+= "\1"/g)]
  assert.equal(mounts.length, 4, 'both credentials must use the same override in API and migration')
  assert.match(media, /resource "yandex_iam_service_account_static_access_key" "api_media"/)
  assert.doesNotMatch(media, /media_s3_credentials_override/, 'override must not rotate or replace the original stage key')
})

test('pins every Yandex Cloud Lockbox mount to an immutable version', () => {
  const workflows = readdirSync(workflowsDirectory)
    .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))

  for (const workflow of workflows) {
    const source = readFileSync(join(workflowsDirectory, workflow), 'utf8')
    const mounts = [...source.matchAll(/--secret\s+([^\s\\]+)/g)]
    const intendedVersions = new Set()

    for (const mount of mounts) {
      const argument = mount[1]
      assert.match(
        argument,
        /(?:^|,)version-id=[^,]+(?:,|$)/,
        `${workflow} contains an unpinned Lockbox mount: --secret ${argument}`,
      )
      const version = argument.match(/(?:^|,)version-id=([^,]+)(?:,|$)/)?.[1]
      if (version) intendedVersions.add(version)
    }
    if (mounts.length > 0) assert.equal(intendedVersions.size, 1, `${workflow} mixes Lockbox release versions in one function`)
  }

  const assistant = readFileSync(join(workflowsDirectory, 'deploy-yandex-assistant-orchestrator.yml'), 'utf8')
  assert.match(assistant, /--environment RELEASE_SHA=\"\$GITHUB_SHA\"/)
  assert.doesNotMatch(assistant, /add-access-binding\s+\S+.*(?:lockbox|allUsers|serverless\.functions\.invoker)/)

  const summary = readFileSync(join(workflowsDirectory, 'deploy-yandex-summary-function.yml'), 'utf8')
  assert.match(summary, /Resolve the existing immutable Lockbox version/)
  assert.match(summary, /\.current_version\.id/)
  assert.doesNotMatch(summary, /api\.supabase\.com\/v1\/projects\/\$SUPABASE_PROJECT_ID\/secrets/)
  assert.doesNotMatch(summary, /lockbox secret add-version/)

  const parser = readFileSync(join(workflowsDirectory, 'deploy-yandex-workout-parser.yml'), 'utf8')
  assert.match(parser, /^  FIT_API_BASE_URL: https:\/\/api\.fit-training\.ru$/m)
  assert.match(parser, /--environment "FIT_API_BASE_URL=\$FIT_API_BASE_URL"/)

  for (const [name, source, expectedKeys] of [
    ['parser', parser, ['YANDEX_CLOUD_API_KEY', 'YANDEX_CLOUD_FOLDER_ID', 'YANDEX_CLOUD_MODEL_ID']],
    ['summary', summary, ['YANDEX_CLOUD_API_KEY', 'YANDEX_CLOUD_FOLDER_ID', 'YANDEX_CLOUD_MODEL_ID']],
    ['assistant', assistant, ['YANDEX_CLOUD_FOLDER_ID', 'YANDEX_CLOUD_MODEL_ID']],
  ]) {
    assert.doesNotMatch(source, /SUPABASE_(?:URL|ANON_KEY|PUBLISHABLE_KEY|SERVICE_ROLE_KEY)/, `${name} must not request or mount Supabase credentials`)
    const keys = [...source.matchAll(/--secret\s+[^\s]+,key=([^,\s]+),environment-variable=\1/g)].map(match => match[1])
    assert.deepEqual(keys, expectedKeys, `${name} must preserve its existing native credentials`)
    assert.match(source, /verify-yandex-function-release\.mjs[\s\S]*?--expected-version-id[\s\S]*?--previous-version-id/)
  }

  const push = readFileSync(join(workflowsDirectory, 'deploy-yandex-push-function.yml'), 'utf8')
  assert.match(push, /Resolve or bootstrap the immutable Lockbox version/)
  assert.match(push, /elif grep -qiE 'NOT_FOUND\|not found'/)
  assert.match(push, /lockbox secret create[\s\S]*?--deletion-protection[\s\S]*?--payload - < "\$payload_file"/)
  assert.match(push, /randomBytes\(32\)\.toString\('base64url'\)/)
  assert.match(push, /webPush\.generateVAPIDKeys\(\)/)
  assert.match(push, /if \[\[ "\$status" == '403' \]\]; then[\s\S]*?serverless function allow-unauthenticated-invoke "\$PUSH_FUNCTION_NAME"/)
  assert.doesNotMatch(push, /SUPABASE_|sync-supabase-push-transport|lockbox payload get/)
  assert.match(push, /key=PUSH_DISPATCH_SECRET,environment-variable=PUSH_DISPATCH_SECRET/)
  assert.match(push, /Verify the candidate and roll back on smoke failure[\s\S]*?verify-yandex-function-release\.mjs/)
  assert.doesNotMatch(push, /PUSH_DISPATCH_SECRET=.*>> "\$GITHUB_ENV"/)
  assert.doesNotMatch(push, /resource-manager folder add-access-binding/)
  assert.doesNotMatch(push, /serverless function set-access-bindings/)
  assert.doesNotMatch(push, /lockbox secret add-version/)
})
