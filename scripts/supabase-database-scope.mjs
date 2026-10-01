import { execFileSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const LEGACY_DATABASE_PATHS = [
  /^supabase\/(?:migrations|tests)\//,
  /^supabase\/(?:config\.toml|seed\.sql)$/,
]

export function requiresSupabaseDatabase(paths) {
  return paths.some((path) => LEGACY_DATABASE_PATHS.some((pattern) => pattern.test(path)))
}

export function shouldRunSupabaseDatabase(eventName, paths) {
  return eventName === 'workflow_dispatch' || paths === null || requiresSupabaseDatabase(paths)
}

export function changedPaths(eventName, baseSha, headSha) {
  if (!baseSha || !headSha || /^0+$/.test(baseSha)) return null

  const range = eventName === 'pull_request'
    ? `${baseSha}...${headSha}`
    : `${baseSha}..${headSha}`

  try {
    return execFileSync('git', ['diff', '--name-only', range], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).split('\n').filter(Boolean)
  } catch {
    // Missing history must never silently skip the legacy rollback check.
    return null
  }
}

function main() {
  const [eventName, baseSha, headSha] = process.argv.slice(2)
  const required = shouldRunSupabaseDatabase(
    eventName,
    eventName === 'workflow_dispatch' ? null : changedPaths(eventName, baseSha, headSha),
  )
  const output = `required=${required}\n`

  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, output)
  process.stdout.write(output)
  process.stdout.write(required
    ? 'Legacy Supabase database tests are required.\n'
    : 'Legacy Supabase schema is unchanged; database tests are skipped.\n')
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main()
