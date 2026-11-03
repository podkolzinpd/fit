import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

const launcher = new URL('./run-local-stack.mjs', import.meta.url)
const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

function withLocalCommands(failure, verify) {
  const directory = mkdtempSync(join(tmpdir(), 'fit-native-local-'))
  const calls = join(directory, 'calls.jsonl')
  const executable = `#!${process.execPath}
const fs = require('node:fs')
const path = require('node:path')
const command = path.basename(process.argv[1])
const args = process.argv.slice(2)
fs.appendFileSync(process.env.FIT_LOCAL_CALLS, JSON.stringify({ command, args }) + '\\n')
if (process.env.FIT_LOCAL_FAIL && args.includes(process.env.FIT_LOCAL_FAIL)) process.exit(7)
if (command === 'podman' && args[0] === 'inspect') console.log('true')
`
  try {
    for (const command of ['npm', 'podman', 'node']) {
      writeFileSync(join(directory, command), executable, { mode: 0o755 })
    }
    const result = spawnSync(process.execPath, [launcher.pathname, '--verify'], {
      cwd: directory,
      encoding: 'utf8',
      env: { ...process.env, PATH: directory, FIT_LOCAL_CALLS: calls, FIT_LOCAL_FAIL: failure },
    })
    verify(result, readFileSync(calls, 'utf8').trim().split('\n').map(line => JSON.parse(line)))
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

test('local verify prepares native PostgreSQL and runs actor/RLS and migration guards without a Supabase executable', () => {
  withLocalCommands('', (result, calls) => {
    assert.equal(result.status, 0, result.stderr)
    const argumentsOf = command => calls.filter(call => call.command === command).map(call => call.args)
    assert.ok(argumentsOf('podman').some(args => args.includes('pg_isready')))
    assert.ok(argumentsOf('podman').some(args => args.includes('psql')))
    assert.ok(argumentsOf('npm').some(args => args.includes('db:migrate')))
    assert.ok(argumentsOf('npm').some(args => args.includes('test:db')))
    assert.deepEqual(argumentsOf('node'), [['scripts/check-migrations.mjs']])
    assert.doesNotMatch(JSON.stringify(calls), /supabase|db:start|db:test|db:types/)
  })
})

test('failed native migration stops local verify before running acceptance checks', () => {
  withLocalCommands('db:migrate', (result, calls) => {
    assert.equal(result.status, 1)
    assert.match(result.stderr, /db:migrate/)
    assert.ok(calls.some(call => call.args.includes('db:migrate')))
    assert.ok(calls.every(call => !call.args.includes('test:db') && call.command !== 'node'))
  })
})

test('root install and normal scripts have no Supabase CLI dependency or legacy SQL invocation', () => {
  const lockfile = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'))
  assert.equal(manifest.devDependencies.supabase, undefined)
  assert.ok(Object.keys(lockfile.packages).every(name => !name.includes('supabase')))
  assert.doesNotMatch(JSON.stringify(manifest.scripts), /supabase (?:start|stop|db|test|gen)|db:types:check/)
  for (const command of ['db:start', 'db:reset', 'db:test', 'db:types', 'tenant:rehearse:local']) {
    assert.equal(manifest.scripts[command], undefined)
  }
})
