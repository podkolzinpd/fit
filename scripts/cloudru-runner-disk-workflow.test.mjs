import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

const workflowUrl = new URL('../.github/workflows/maintain-cloudru-runner-disk.yml', import.meta.url)

test('Cloud.ru disk maintenance remains shell-only and can start on a full runner', async () => {
  const workflow = await readFile(workflowUrl, 'utf8')
  assert.match(workflow, /^  schedule:\n    - cron: '17 2 \* \* \*'$/m)
  assert.match(workflow, /runs-on: \[self-hosted, cloudru-stage\]/)
  assert.match(workflow, /group: cloudru-stage-vm/)
  assert.doesNotMatch(workflow, /uses:|actions\/checkout|actions\/setup-node/)
  assert.match(workflow, /test "\$\(hostname\)" = fit-stage-app/)
  assert.match(workflow, /APPLY_CLOUDRU_RUNNER_RETENTION/)
})

test('retention protects live pointers, containers and three recent rollback revisions', async () => {
  const workflow = await readFile(workflowUrl, 'utf8')
  for (const required of [
    '"$root/RUNNING_SHA"',
    '"$root/DEPLOYED_SHA"',
    'readlink -f "$root/current"',
    'readlink -f "$root/frontend/current"',
    "podman ps -a --format '{{.Image}}'",
    "awk 'NR <= 3 { print $2 }'",
  ]) assert.ok(workflow.includes(required), required)
  assert.match(workflow, /test "\$\(sudo readlink -f "\$root\/current"\)" = "\$current_api"/)
  assert.match(workflow, /test "\$\(sudo readlink -f "\$root\/frontend\/current"\)" = "\$current_frontend"/)
})

test('retention removes only validated build artifacts and never data or backup paths', async () => {
  const workflow = await readFile(workflowUrl, 'utf8')
  assert.match(workflow, /\^\/opt\/fit\/releases\/\[a-f0-9\]\{40\}\$/)
  assert.match(workflow, /\^\/opt\/fit\/frontend\/candidates\/\[a-f0-9\]\{40\}-\[0-9\]\+\-\[0-9\]\+\$/)
  assert.match(workflow, /\^localhost\/fit-api:\[a-f0-9\]\{40\}\$/)
  assert.match(workflow, /podman image prune --force/)
  assert.doesNotMatch(workflow, /podman (?:system|volume) prune|--volumes|db-backups[^\n]*rm|secrets[^\n]*rm|media[^\n]*rm/)
  assert.match(workflow, /backup_state=\$\(sudo stat/)
  assert.match(workflow, /= "\$backup_state"/)
  assert.match(workflow, /test "\$available_kib" -ge 2097152/)
  assert.match(workflow, /http:\/\/127\.0\.0\.1:18080\/ready/)
  assert.match(workflow, /http:\/\/127\.0\.0\.1:18081\//)
})

test('Cloud.ru disk maintenance workflow contains valid Bash', async () => {
  const workflow = await readFile(workflowUrl, 'utf8')
  const match = workflow.match(/        run: \|\n([\s\S]+)$/)
  assert.ok(match)
  const script = match[1].split('\n').map((line) => line.startsWith('          ') ? line.slice(10) : line).join('\n')
  const result = spawnSync('bash', ['-n'], { input: script, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
})

