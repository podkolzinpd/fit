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
})
