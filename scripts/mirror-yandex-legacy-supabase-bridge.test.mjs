import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { mirrorYandexLegacySupabaseBridge } from './mirror-yandex-legacy-supabase-bridge.mjs'

const FOLDER_ID = 'b1gstage'
const SECRET_NAME = 'fit-stage-legacy-supabase-bridge'
const payload = [
  { key: 'SUPABASE_URL', text_value: 'https://example.supabase.co' },
  { key: 'SUPABASE_PUBLISHABLE_KEY', text_value: 'sb_publishable_test' },
  { key: 'SUPABASE_SERVICE_ROLE_KEY', text_value: 'sb_secret_test' },
]

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'fit-supabase-bridge-mirror-'))
  const githubEnv = join(directory, 'github-env')
  const payloadFile = join(directory, 'payload.json')
  writeFileSync(githubEnv, '')
  writeFileSync(payloadFile, JSON.stringify(payload), { mode: 0o600 })
  return { githubEnv, payloadFile }
}

function metadata(description, versionId = 'e6qversion') {
  return JSON.stringify({ id: 'e6qmirror', current_version: { id: versionId, description, payload_entry_keys: payload.map(({ key }) => key) } })
}

test('creates a deletion-protected mirror without leaking payload values', () => {
  const files = fixture()
  const calls = []
  const result = mirrorYandexLegacySupabaseBridge({ folderId: FOLDER_ID, secretName: SECRET_NAME, ...files }, {
    runYc: (args, stdin) => {
      calls.push({ args, stdin })
      return calls.length === 1 ? { status: 1, stderr: 'NOT_FOUND' }
        : calls.length === 2 ? { status: 0, stdout: '{}' }
          : { status: 0, stdout: metadata(JSON.parse(calls[1].stdin).length === 3 ? /^payload-sha256:[a-f0-9]{64}$/.test(calls[1].args[calls[1].args.indexOf('--version-description') + 1]) ? calls[1].args[calls[1].args.indexOf('--version-description') + 1] : '' : '') }
    },
  })
  assert.equal(result.id, 'e6qmirror')
  assert.ok(calls[1].args.includes('--deletion-protection'))
  assert.doesNotMatch(calls[1].args.join(' '), /sb_secret_test/)
  assert.deepEqual(JSON.parse(calls[1].stdin), payload)
  assert.equal(readFileSync(files.githubEnv, 'utf8'), 'TF_VAR_legacy_supabase_bridge_lockbox_secret_id=e6qmirror\nTF_VAR_legacy_supabase_bridge_lockbox_secret_version_id=e6qversion\n')
  assert.throws(() => readFileSync(files.payloadFile), /ENOENT/)
})

test('reuses a current mirror and removes the temporary payload', () => {
  const files = fixture()
  const marker = 'payload-sha256:' + createHash('sha256').update(JSON.stringify(payload)).digest('hex')
  const result = mirrorYandexLegacySupabaseBridge({ folderId: FOLDER_ID, secretName: SECRET_NAME, ...files }, {
    runYc: () => ({ status: 0, stdout: metadata(marker) }),
  })
  assert.equal(result.versionId, 'e6qversion')
  assert.throws(() => readFileSync(files.payloadFile), /ENOENT/)
})
