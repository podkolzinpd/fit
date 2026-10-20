import { execFileSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

// Explicitly reviewed paths, not blanket scripts/workflows/infra exclusions.
const DOCUMENTATION = [
  // docs/design also owns SVGs imported by TS/CSS; only prose is skippable.
  /^docs\/.+\.md$/,
  /^(?:AGENTS|README|FEATURE_PARITY|OPERATIONS)\.md$/,
  /^\.github\/(?:copilot-instructions\.md|pull_request_template\.md)$/,
]
const SERVER_ONLY = [
  /^services\/api\/src\/(?:cloudru-(?:backup|sql-audit|sql-snapshot)|email-audience-audit)(?:\.test)?\.ts$/,
  // Test-only changes retain the complete API and PostgreSQL gates.
  /^services\/api\/src\/.+\.test\.ts$/,
  /^services\/speechkit-relay\/.+\.test\.mjs$/,
]
const OPERATIONS_ONLY = [
  /^\.github\/workflows\/(?:inspect-cloudru-operations|maintain-cloudru-runner-disk|backup-cloudru-production|deploy-cloudru-stage|migrate-yandex-(?:database|media)-to-cloudru|transfer-yandex-sql-to-cloudru|manage-cloudru-recovery-push)\.yml$/,
  /^\.github\/workflows\/(?:deploy-database|deploy-summary-function|deploy-yandex-(?:stage|migration-container-only)|manage-yandex-stage-database-access|manage-yandex-stage-identity-unlink|migrate-yandex-media|sync-yandex-stage-preview)\.yml$/,
  /^scripts\/(?:cloudru-stabilization-workflows|cloudru-runner-disk-workflow|domain-change-push-workflow)\.test\.mjs$/,
  /^scripts\/(?:check-yandex-migration-container-plan|check-yandex-terraform-plan|cloudru-media-migration-workflow|deploy-yandex-serverless-revision|deploy-yandex-stage-workflow|verify-yandex-stage-access|yandex-stage-smoke)(?:\.test)?\.mjs$/,
  /^scripts\/cloudru-speech-diagnostics(?:\.test)?\.py$/,
]

function classifyPath(path) {
  if (typeof path !== 'string' || !path || path.startsWith('/')
    || path.includes('\\') || [...path].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
    || path.split('/').some(part => !part || part === '.' || part === '..')) {
    return { path, category: 'invalid path', required: true }
  }
  // Auth/routing boundaries take precedence even over test-only rules.
  if (path.startsWith('services/api/') && /auth|session|cors|route|request|contract|\/server\.|\/app\./i.test(path)) {
    return { path, category: 'API auth/routing/contract boundary', required: true }
  }
  if (DOCUMENTATION.some(pattern => pattern.test(path))) return { path, category: 'documentation', required: false }
  if (SERVER_ONLY.some(pattern => pattern.test(path))) return { path, category: 'reviewed API-only scope', required: false }
  if (OPERATIONS_ONLY.some(pattern => pattern.test(path))) return { path, category: 'reviewed operations-only scope', required: false }
  if (/^(?:src|public|android|ios|e2e|supabase)\//.test(path)) {
    return { path, category: 'frontend/native/shared runtime', required: true }
  }
  return { path, category: 'shared configuration or unreviewed path', required: true }
}

// Retain the public helper used by the independently audited Fit Lime policy.
export function requiresE2E(paths) {
  return !Array.isArray(paths) || paths.length === 0 || paths.some(path => classifyPath(path).required)
}

export function selectCheckScope(paths, { eventName } = {}) {
  const decisions = Array.isArray(paths) ? paths.map(classifyPath) : []
  let reason = 'Only explicitly reviewed non-frontend paths changed'
  let required = decisions.some(decision => decision.required)
  if (eventName !== 'pull_request') {
    required = true
    reason = 'Main, manual and unknown events retain full acceptance'
  } else if (decisions.length === 0) {
    required = true
    reason = 'Diff unavailable or empty; full acceptance is required'
  } else if (required) reason = 'Frontend, shared, auth/routing or unreviewed paths changed'
  return { frontendRequired: required, browserRequired: required, reason, decisions }
}

export function changedPaths(baseSha, headSha, eventName = 'pull_request') {
  if (![baseSha, headSha].every(sha => typeof sha === 'string' && /^[a-f0-9]{7,40}$/i.test(sha) && !/^0+$/.test(sha))) return []
  const range = eventName === 'pull_request' ? `${baseSha}...${headSha}` : `${baseSha}..${headSha}`
  try {
    // Expose both paths of a rename; NUL preserves unusual filenames.
    return execFileSync('git', ['diff', '--name-only', '--no-renames', '-z', range], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).split('\0').filter(Boolean)
  } catch {
    return [] // Missing history cannot silently authorize a skip.
  }
}

function main() {
  const [baseSha, headSha, format] = process.argv.slice(2)
  const selection = selectCheckScope(changedPaths(baseSha, headSha, process.env.EVENT_NAME), {
    eventName: process.env.EVENT_NAME,
  })
  const output = `required=${selection.browserRequired}\nfrontend_required=${selection.frontendRequired}\n`
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, output)
  if (process.env.GITHUB_STEP_SUMMARY) {
    const escaped = JSON.stringify(selection, null, 2).replace(/[&<>]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[char])
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Automatic PR check scope\n\n<pre>${escaped}</pre>\n`)
  }
  if (format === '--json') process.stdout.write(`${JSON.stringify(selection, null, 2)}\n`)
  else {
    process.stdout.write(output)
    process.stdout.write(`${selection.reason}\n`)
    for (const decision of selection.decisions) {
      process.stdout.write(`${JSON.stringify(decision.path)}: ${decision.category}; frontend/browser=${decision.required}\n`)
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
