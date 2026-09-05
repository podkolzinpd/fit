import { execFileSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const SAFE_WITHOUT_E2E = [
  /^docs\//,
  /^infra\/yandex\//,
  /^\.github\/(?:copilot-instructions\.md|pull_request_template\.md)$/,
  /^\.github\/workflows\/(?:deploy-database|deploy-summary-function|deploy-yandex-[^/]+|manage-yandex-stage-database-access|sync-yandex-stage-preview)\.yml$/,
  /^(?:AGENTS|README|FEATURE_PARITY|OPERATIONS)\.md$/,
  /^scripts\/(?:check-yandex-terraform-plan(?:\.test)?|deploy-yandex-stage-workflow\.test|e2e-scope(?:\.test)?)\.mjs$/,
  /^vercel\.json$/,
]

export function requiresE2E(paths) {
  if (paths.length === 0) return true
  return paths.some((path) => !SAFE_WITHOUT_E2E.some((pattern) => pattern.test(path)))
}

export function changedPaths(baseSha, headSha) {
  if (!baseSha || !headSha) return []
  return execFileSync('git', ['diff', '--name-only', `${baseSha}...${headSha}`], {
    encoding: 'utf8',
  }).split('\n').filter(Boolean)
}

function main() {
  const [baseSha, headSha] = process.argv.slice(2)
  const paths = changedPaths(baseSha, headSha)
  const required = !baseSha || !headSha || requiresE2E(paths)
  const output = `required=${required}\n`

  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, output)
  process.stdout.write(output)
  process.stdout.write(required
    ? 'Full browser suite is required for these changes.\n'
    : 'Only documentation or deployment infrastructure changed; browser runtime is unaffected.\n')
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main()
