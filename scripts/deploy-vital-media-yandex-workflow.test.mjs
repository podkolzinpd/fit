import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

const root = join(import.meta.dirname, '..')
const workflow = readFileSync(join(root, '.github/workflows/deploy-vital-media-yandex.yml'), 'utf8')
const script = readFileSync(join(root, 'scripts/deploy-vital-media-yandex.mjs'), 'utf8')
const service = readFileSync(join(root, 'services/api/src/vital-media-deployment.ts'), 'utf8')

test('deploys Vital media through the private OIDC migration runtime', () => {
  assert.match(workflow, /id-token: write/)
  assert.match(workflow, /scripts\/yandex-github-oidc\.sh/)
  assert.doesNotMatch(workflow, /yc storage bucket get/)
  assert.match(workflow, /fit-stage-migration/)
  assert.match(workflow, /YC_STAGE_MEDIA_BUCKET/)
  assert.match(workflow, /YC_STAGE_MEDIA_S3_CREDENTIALS/)
  assert.doesNotMatch(workflow, /YANDEX_MEDIA_ACCESS_KEY_ID|YANDEX_MEDIA_SECRET_ACCESS_KEY/)
  assert.doesNotMatch(workflow, /fit-stage-media-s3/)
})

test('requires the reviewed package contract, full readback and signed URL smoke', () => {
  assert.match(script, /validateVitalGymProMediaManifest/)
  assert.match(script, /pending_manifest_write/)
  assert.match(script, /verified_by_manifest_objects/)
  assert.match(script, /enumeration !== 'manifest_only'/)
  assert.match(service, /vital_media_object_version_missing/)
  assert.match(service, /put\.VersionId/)
  assert.doesNotMatch(service, /HeadObjectCommand/)
  assert.doesNotMatch(service, /DeleteObjectCommand|_migration-probes/)
  assert.doesNotMatch(service, /ListObjectsV2Command/)
  assert.match(script, /verified !== 2_010/)
  assert.match(script, /JSON\.stringify\(after\) !== JSON\.stringify\(repeated\)/)
  assert.match(script, /x-fit-session/)
  assert.match(script, /Range: 'bytes=0-1023'/)
  assert.match(script, /\[403\]/)
})
