import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { mirrorYandexPushTransport } from './mirror-yandex-push-transport.mjs'

const SECRET = 'a'.repeat(43)
const FOLDER_ID = 'b1gstage'
const SOURCE_VERSION_ID = 'e6qsource'
const SECRET_NAME = 'fit-stage-push-transport'

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'fit-push-mirror-'))
  const githubEnv = join(directory, 'github-env')
  const secretFile = join(directory, 'dispatch-secret')
  writeFileSync(githubEnv, '')
  writeFileSync(secretFile, `${SECRET}\n`, { mode: 0o600 })
  return { directory, githubEnv, secretFile }
}

function metadata({ description, id = 'e6qmirror', versionId = 'e6qversion' }) {
  return JSON.stringify({
    id,
    current_version: {
      id: versionId,
      description,
      payload_entry_keys: ['PUSH_DISPATCH_SECRET'],
    },
  })
}

function run(input, responses) {
  const calls = []
  const result = mirrorYandexPushTransport(
    {
      folderId: FOLDER_ID,
      secretName: SECRET_NAME,
      sourceVersionId: SOURCE_VERSION_ID,
      ...input,
    },
    {
      runYc: (args, stdin) => {
        calls.push({ args, stdin })
        return responses.shift()
      },
    },
  )
  assert.equal(responses.length, 0)
  return { calls, result }
}

test('creates a deletion-protected stage mirror without putting the payload in arguments or GITHUB_ENV', () => {
  const files = fixture()
  const { calls, result } = run(files, [
    { status: 1, stderr: 'NOT_FOUND' },
    { status: 0, stdout: '{}' },
    { status: 0, stdout: metadata({ description: `source-version:${SOURCE_VERSION_ID}` }) },
  ])

  assert.equal(result.id, 'e6qmirror')
  assert.equal(calls.length, 3)
  assert.deepEqual(calls[1].args.slice(0, 3), ['lockbox', 'secret', 'create'])
  assert.ok(calls[1].args.includes('--deletion-protection'))
  assert.ok(calls[1].args.includes(`source-version:${SOURCE_VERSION_ID}`))
  assert.doesNotMatch(calls[1].args.join(' '), new RegExp(SECRET))
  assert.equal(JSON.parse(calls[1].stdin)[0].text_value, SECRET)
  assert.equal(
    readFileSync(files.githubEnv, 'utf8'),
    'TF_VAR_push_transport_secret_id=e6qmirror\n'
      + 'TF_VAR_push_transport_secret_version_id=e6qversion\n',
  )
  assert.throws(() => readFileSync(files.secretFile), /ENOENT/)
})

test('reuses the current mirror when it already represents the source version', () => {
  const files = fixture()
  const { calls } = run(files, [{
    status: 0,
    stdout: metadata({ description: `source-version:${SOURCE_VERSION_ID}` }),
  }])

  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0].args.slice(0, 3), ['lockbox', 'secret', 'get'])
})

test('adds one immutable version when the source version changes', () => {
  const files = fixture()
  const { calls, result } = run(files, [
    { status: 0, stdout: metadata({ description: 'source-version:old' }) },
    { status: 0, stdout: '{}' },
    {
      status: 0,
      stdout: metadata({
        description: `source-version:${SOURCE_VERSION_ID}`,
        versionId: 'e6qnewversion',
      }),
    },
  ])

  assert.deepEqual(calls[1].args.slice(0, 3), ['lockbox', 'secret', 'add-version'])
  assert.equal(JSON.parse(calls[1].stdin)[0].text_value, SECRET)
  assert.equal(result.versionId, 'e6qnewversion')
})

test('redacts the payload from a Yandex CLI failure and still removes the temporary file', () => {
  const files = fixture()
  assert.throws(
    () => run(files, [{ status: 2, stderr: `request rejected for ${SECRET}` }]),
    (error) => {
      assert.match(error.message, /\[REDACTED\]/)
      assert.doesNotMatch(error.message, new RegExp(SECRET))
      return true
    },
  )
  assert.throws(() => readFileSync(files.secretFile), /ENOENT/)
})
