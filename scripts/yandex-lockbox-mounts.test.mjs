import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

const workflowsDirectory = join(import.meta.dirname, '..', '.github', 'workflows')

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

  const push = readFileSync(join(workflowsDirectory, 'deploy-yandex-push-function.yml'), 'utf8')
  assert.match(push, /Resolve or bootstrap the immutable Lockbox version/)
  assert.match(push, /elif grep -qiE 'NOT_FOUND\|not found'/)
  assert.match(push, /lockbox secret create[\s\S]*?--deletion-protection[\s\S]*?--payload - < "\$payload_file"/)
  assert.match(push, /randomBytes\(32\)\.toString\('base64url'\)/)
  assert.match(push, /webPush\.generateVAPIDKeys\(\)/)
  assert.doesNotMatch(push, /lockbox secret add-version/)
})
