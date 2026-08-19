import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import process from 'node:process'

const migrationRoots = ['supabase/migrations', 'services/api/db/migrations']
const baseRef = process.argv[2] ?? 'origin/main'

function git(args) {
  const result = spawnSync('git', args, { encoding: 'utf8' })
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `git ${args.join(' ')} failed`)
  }
  return result.stdout
}

function parseChangedMigrations() {
  const output = git([
    'diff',
    '--name-status',
    baseRef,
    '--',
    ...migrationRoots,
  ])
  const trackedChanges = output
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [status, ...paths] = line.split('\t')
      return { paths, status }
    })
  const untrackedFiles = git([
    'ls-files',
    '--others',
    '--exclude-standard',
    '--',
    ...migrationRoots,
  ])
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((path) => ({ paths: [path], status: 'A' }))

  return [...trackedChanges, ...untrackedFiles]
}

function checkImmutableHistory(changes) {
  const rewritten = changes.filter(({ status }) => status !== 'A')
  if (rewritten.length === 0) return []

  return rewritten.map(
    ({ paths, status }) =>
      `Уже существующую миграцию нельзя изменять (${status}): ${paths.join(' -> ')}`,
  )
}

function checkDangerousUpMigrations(changes) {
  const dangerousPatterns = [
    /\bdrop\s+(?:table|schema|database)\b/i,
    /\btruncate\b/i,
    /\balter\s+table\b[\s\S]*?\bdrop\s+column\b/i,
    /\balter\s+table\b[\s\S]*?\balter\s+column\b[\s\S]*?\btype\b/i,
    /\balter\s+table\b[\s\S]*?\brename\s+(?:column|to)\b/i,
  ]
  const errors = []

  for (const { paths, status } of changes) {
    if (status !== 'A') continue
    const path = paths[0]
    if (path === undefined || !path.endsWith('.sql')) continue

    const contents = readFileSync(path, 'utf8')
    const upMigration = contents.split(/^-- Down Migration\s*$/im)[0] ?? ''
    if (dangerousPatterns.some((pattern) => pattern.test(upMigration))) {
      errors.push(
        `Потенциально разрушающая операция в новой миграции: ${path}. ` +
          'Такое изменение нужно вынести в отдельный ручной план развёртывания.',
      )
    }
  }
  return errors
}

try {
  const changes = parseChangedMigrations()
  const errors = [
    ...checkImmutableHistory(changes),
    ...checkDangerousUpMigrations(changes),
  ]

  if (errors.length > 0) {
    console.error(errors.map((error) => `- ${error}`).join('\n'))
    process.exitCode = 1
  } else {
    console.log(
      `Migration safety check passed (${changes.length} changed file(s), base ${baseRef}).`,
    )
  }
} catch (error) {
  console.error(
    `Не удалось проверить историю миграций: ${error instanceof Error ? error.message : String(error)}`,
  )
  process.exitCode = 1
}
