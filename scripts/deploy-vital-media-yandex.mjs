#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import { reviewedVitalGymProExercises } from './data/vital-gym-pro-catalog-reviewed.mjs'
import { validateVitalGymProMediaManifest } from './vital-gym-pro-media-contract.mjs'

const APPLY_CONFIRMATION = 'APPLY_VITAL_MEDIA_TO_YANDEX_STAGE'
const BINARY_CONTENT_TYPE = 'application/vnd.fit.vital-media'
const TRANSFER_CONCURRENCY = 4
const MAX_ATTEMPTS = 5
const TARGETED_SMOKE_JPG_PATHS = [
  'vital-cycling-ex061.jpg',
  'vital-leg-press-machine-ex073.jpg',
  'vital-dumbbell-rdl-ex248.jpg',
  'vital-dumbbell-walking-lunge-ex727.jpg',
]

function required(name) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error('vital_media_deployment_configuration_missing')
  return value
}

function mode() {
  const value = process.env.FIT_VITAL_MEDIA_DEPLOYMENT_MODE?.trim()
  if (value !== 'audit' && value !== 'apply' && value !== 'smoke') {
    throw new Error('vital_media_deployment_mode_invalid')
  }
  return value
}

function sleep(milliseconds) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds))
}

async function request(url, options, acceptedStatuses = [200]) {
  let response
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      response = await fetch(url, options)
      if (!response.ok && [408, 425, 429, 500, 502, 503, 504].includes(response.status)) {
        if (attempt < MAX_ATTEMPTS) {
          await sleep(750 * (2 ** (attempt - 1)))
          continue
        }
      }
      break
    } catch (error) {
      if (attempt === MAX_ATTEMPTS) throw error
      await sleep(750 * (2 ** (attempt - 1)))
    }
  }
  if (response === undefined || !acceptedStatuses.includes(response.status)) {
    const safeBody = await response?.json().catch(() => undefined)
    const code = typeof safeBody === 'object' && safeBody !== null && 'code' in safeBody
      && typeof safeBody.code === 'string' && /^[a-z0-9_]{1,96}$/.test(safeBody.code)
      ? safeBody.code
      : 'vital_media_remote_request_failed'
    throw new Error(code)
  }
  return response
}

function privateHeaders(token, extra = {}) {
  return { Authorization: `Bearer ${token}`, ...extra }
}

async function parallel(values, operation) {
  let cursor = 0
  await Promise.all(Array.from({ length: TRANSFER_CONCURRENCY }, async () => {
    while (cursor < values.length) {
      const value = values[cursor]
      cursor += 1
      if (value !== undefined) await operation(value)
    }
  }))
}

async function audit(migrationUrl, token, manifest) {
  const response = await request(`${migrationUrl}/stage/vital-media/audit`, {
    method: 'POST',
    headers: privateHeaders(token, { 'content-type': 'application/json' }),
    body: JSON.stringify({ files: manifest.files }),
  })
  const report = await response.json()
  if (
    report.status !== 'vital_media_audited'
    || report.objects !== 2_010
    || report.bytes !== 71_514_430
    || report.enumeration !== 'manifest_only'
    || typeof report.verified !== 'number'
    || typeof report.missing !== 'number'
    || typeof report.mismatched !== 'number'
    || typeof report.fingerprint !== 'string'
    || !/^[a-f0-9]{16}$/.test(report.fingerprint)
  ) throw new Error('vital_media_remote_audit_invalid')
  return report
}

async function signedUrlSmoke(apiUrl, migrationUrl, token, manifest) {
  const fixture = await request(`${migrationUrl}/stage/fixtures/workout-read-model`, {
    method: 'POST',
    headers: privateHeaders(token),
  }).then((response) => response.json())
  const sessionToken = fixture?.mediaSession?.token
  if (typeof sessionToken !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(sessionToken)) {
    throw new Error('vital_media_smoke_session_invalid')
  }

  const jpg = manifest.files.find(({ path }) => path.endsWith('.jpg'))
  const mp4 = manifest.files.find(({ path }) => path.endsWith('.mp4'))
  if (jpg === undefined || mp4 === undefined) throw new Error('vital_media_smoke_manifest_invalid')

  async function sign(path) {
    const response = await request(`${apiUrl}/v1/exercise-media/sign`, {
      method: 'POST',
      headers: privateHeaders(token, {
        'content-type': 'application/json',
        'x-fit-session': sessionToken,
      }),
      body: JSON.stringify({ path: `vital-pro/${path}` }),
    })
    const body = await response.json()
    if (typeof body.signedUrl !== 'string' || !body.signedUrl.startsWith('https://')) {
      throw new Error('vital_media_signed_url_invalid')
    }
    return body.signedUrl
  }

  const jpgUrl = await sign(jpg.path)
  const jpgResponse = await request(jpgUrl, { redirect: 'manual' })
  if (jpgResponse.headers.get('content-type')?.split(';')[0] !== 'image/jpeg') {
    throw new Error('vital_media_jpg_content_type_invalid')
  }
  const jpgBody = Buffer.from(await jpgResponse.arrayBuffer())
  if (
    jpgBody.byteLength !== jpg.bytes
    || createHash('sha256').update(jpgBody).digest('hex') !== jpg.sha256
  ) throw new Error('vital_media_jpg_signed_content_invalid')

  const mp4Url = await sign(mp4.path)
  const mp4Response = await request(mp4Url, {
    headers: { Range: 'bytes=0-1023' },
    redirect: 'manual',
  }, [206])
  if (
    mp4Response.headers.get('content-type')?.split(';')[0] !== 'video/mp4'
    || !mp4Response.headers.get('content-range')?.startsWith('bytes 0-')
  ) throw new Error('vital_media_mp4_range_invalid')
  const mp4RangeBody = Buffer.from(await mp4Response.arrayBuffer())
  if (mp4RangeBody.byteLength < 1 || mp4RangeBody.byteLength > 1_024) {
    throw new Error('vital_media_mp4_range_body_invalid')
  }

  const unsignedUrl = new URL(jpgUrl)
  unsignedUrl.search = ''
  await request(unsignedUrl, { redirect: 'manual' }, [403])
}

async function targetedSignedUrlSmoke(apiUrl, migrationUrl, token, manifest) {
  const fixture = await request(`${migrationUrl}/stage/fixtures/workout-read-model`, {
    method: 'POST',
    headers: privateHeaders(token),
  }).then((response) => response.json())
  const sessionToken = fixture?.mediaSession?.token
  if (typeof sessionToken !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(sessionToken)) {
    throw new Error('vital_media_smoke_session_invalid')
  }

  const filesByPath = new Map(manifest.files.map((file) => [file.path, file]))
  const files = TARGETED_SMOKE_JPG_PATHS.map((path) => filesByPath.get(path))
  if (files.some((file) => file === undefined)) throw new Error('vital_media_smoke_manifest_invalid')

  for (const file of files) {
    const signResponse = await request(`${apiUrl}/v1/exercise-media/sign`, {
      method: 'POST',
      headers: privateHeaders(token, {
        'content-type': 'application/json',
        'x-fit-session': sessionToken,
      }),
      body: JSON.stringify({ path: `vital-pro/${file.path}` }),
    })
    const signed = await signResponse.json()
    if (typeof signed.signedUrl !== 'string' || !signed.signedUrl.startsWith('https://')) {
      throw new Error('vital_media_signed_url_invalid')
    }
    const mediaResponse = await request(signed.signedUrl, { redirect: 'manual' })
    if (mediaResponse.headers.get('content-type')?.split(';')[0] !== 'image/jpeg') {
      throw new Error('vital_media_jpg_content_type_invalid')
    }
    const body = Buffer.from(await mediaResponse.arrayBuffer())
    if (
      body.byteLength !== file.bytes
      || createHash('sha256').update(body).digest('hex') !== file.sha256
    ) throw new Error('vital_media_jpg_signed_content_invalid')
  }

  return files.length
}

async function main() {
  const deploymentMode = mode()
  const token = required('YC_TOKEN')
  const migrationUrl = required('FIT_YANDEX_MIGRATION_URL').replace(/\/$/, '')
  const expectedBucket = required('FIT_YANDEX_MEDIA_BUCKET')
  const root = resolve(import.meta.dirname, '..')
  const manifest = JSON.parse(await readFile(join(root, 'scripts/data/vital-gym-pro-media-manifest.json'), 'utf8'))
  const baseCatalog = JSON.parse(await readFile(join(root, 'scripts/data/vital-gym-pro-catalog.json'), 'utf8'))
  validateVitalGymProMediaManifest(
    manifest,
    [...baseCatalog.exercises, ...reviewedVitalGymProExercises()],
  )

  const preflight = await request(`${migrationUrl}/stage/vital-media/preflight`, {
    method: 'POST',
    headers: privateHeaders(token, {
      'content-type': 'application/json',
      ...(deploymentMode === 'apply'
        ? { 'x-fit-vital-media-confirmation': APPLY_CONFIRMATION }
        : {}),
    }),
    body: JSON.stringify({ allowWrite: deploymentMode === 'apply' }),
  }).then((response) => response.json())
  const expectedVersioning = deploymentMode === 'apply'
    ? 'pending_manifest_write'
    : 'not_probed_read_only'
  if (
    preflight.status !== 'vital_media_preflight_ready'
    || preflight.bucket !== expectedBucket
    || preflight.private !== true
    || preflight.versioning !== expectedVersioning
  ) throw new Error('vital_media_preflight_mismatch')

  if (deploymentMode === 'smoke') {
    const checked = await targetedSignedUrlSmoke(
      required('FIT_YANDEX_API_URL').replace(/\/$/, ''),
      migrationUrl,
      token,
      manifest,
    )
    process.stdout.write(`${JSON.stringify({
      mode: deploymentMode,
      checked,
      signedUrlSmoke: true,
    })}\n`)
    return
  }

  const before = await audit(migrationUrl, token, manifest)
  if (deploymentMode === 'audit') {
    process.stdout.write(`${JSON.stringify({ mode: deploymentMode, ...before })}\n`)
    return
  }

  const mediaDir = join(root, 'public/exercises/vital-pro')
  let uploaded = 0
  let skipped = 0
  let completed = 0
  async function upload(file) {
    const body = await readFile(join(mediaDir, file.path))
    const response = await request(`${migrationUrl}/stage/vital-media/object`, {
      method: 'PUT',
      headers: privateHeaders(token, {
        'content-type': BINARY_CONTENT_TYPE,
        'x-fit-vital-media-bytes': String(file.bytes),
        'x-fit-vital-media-confirmation': APPLY_CONFIRMATION,
        'x-fit-vital-media-path': file.path,
        'x-fit-vital-media-sha256': file.sha256,
      }),
      body,
    })
    const result = await response.json()
    if (result.versioning !== 'verified') {
      throw new Error('vital_media_object_versioning_unverified')
    }
    if (result.status === 'vital_media_uploaded') uploaded += 1
    else if (result.status === 'vital_media_skipped') skipped += 1
    else throw new Error('vital_media_upload_response_invalid')
    completed += 1
    if (completed % 100 === 0 || completed === manifest.files.length) {
      process.stderr.write(`Processed ${completed}/${manifest.files.length} reviewed media objects.\n`)
    }
  }

  const [firstFile, ...remainingFiles] = manifest.files
  if (firstFile === undefined) throw new Error('vital_media_manifest_empty')
  await upload(firstFile)
  await parallel(remainingFiles, upload)

  const after = await audit(migrationUrl, token, manifest)
  if (
    after.verified !== 2_010
    || after.missing !== 0
    || after.mismatched !== 0
  ) throw new Error('vital_media_post_upload_audit_failed')
  const repeated = await audit(migrationUrl, token, manifest)
  if (JSON.stringify(after) !== JSON.stringify(repeated)) {
    throw new Error('vital_media_repeat_audit_changed')
  }

  await signedUrlSmoke(
    required('FIT_YANDEX_API_URL').replace(/\/$/, ''),
    migrationUrl,
    token,
    manifest,
  )
  process.stdout.write(`${JSON.stringify({
    mode: deploymentMode,
    ...after,
    uploaded,
    skipped,
    signedUrlSmoke: true,
    versioning: 'verified_by_manifest_objects',
  })}\n`)
}

try {
  await main()
} catch (error) {
  const code = error instanceof Error && /^[a-z0-9_]{1,96}$/.test(error.message)
    ? error.message
    : 'vital_media_deployment_failed'
  process.stderr.write(`${code}\n`)
  process.exitCode = 1
}
