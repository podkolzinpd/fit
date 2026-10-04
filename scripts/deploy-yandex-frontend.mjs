import { execFile } from 'node:child_process'
import { promisify, isDeepStrictEqual } from 'node:util'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { frontendHealthBody, frontendHealthPath, frontendHealthRoute, gatewayPlan } from './frontend-gateway-plan.mjs'
import { gatewaySpecificationsEqual } from './frontend-gateway-specification.mjs'
import { uploadCandidate } from './upload-frontend-candidate.mjs'
import { releaseBatch, reuseReleaseObjects, releaseManifest, manifestKey } from './frontend-release-storage.mjs'

export const target = Object.freeze({
  bucket: 'fit-frontend-probe-b1goqho1', reader: 'aje67ouc4633u7i7oc2a',
  gateway: 'd5drmhq5ovqk03jgsm8i',
  frontendOrigin: 'https://d5drmhq5ovqk03jgsm8i.wnq2w1o5.apigw.yandexcloud.net',
  customOrigin: 'https://fit-training.ru',
})
const integration = 'x-yc-apigateway-integration'
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
const immutable = (path) => /^\/assets\/[a-zA-Z0-9_./-]+-[A-Za-z0-9_-]{8,}\.[a-z0-9]+$/.test(path)
const objectKey = (key) => /^releases\/[a-f0-9]{40}-[a-f0-9]{64}\/[a-zA-Z0-9_./-]+$/.test(key)
  && !key.split('/').some((part) => part.startsWith('.') || !part)

// Only explicitly authored diagnostics may reach CI. Never print raw fetch/yc
// errors, their causes, stderr, headers or command arguments.
class DeploymentCheckError extends Error {}
const failureReason = (error) => error instanceof DeploymentCheckError ? error.message : 'External operation failed (details withheld)'

export async function retryTransient(action, { attempts = 4, sleep = delay, delayMs = 5000 } = {}) {
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 12) throw new Error('Invalid retry budget')
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try { return await action() } catch (error) {
      if (attempt === attempts - 1) throw error
      await sleep(delayMs)
    }
  }
}

export function validateSpecification(spec) {
  if (spec?.openapi !== '3.0.0' || !spec.paths?.['/'] || !spec.paths?.['/assets/{file+}']) {
    throw new Error('Unknown gateway contract; activation refused')
  }
  if (spec.paths[frontendHealthPath] !== undefined
      && !isDeepStrictEqual(spec.paths[frontendHealthPath], frontendHealthRoute())) {
    throw new Error('Unexpected gateway health route')
  }
  for (const [path, route] of Object.entries(spec.paths)) {
    for (const method of ['get', 'head']) {
      const op = route[method]?.[integration]
      if (op?.type === 'object_storage') {
        if (op.bucket !== target.bucket || op.service_account_id !== target.reader || !objectKey(op.object)) {
          throw new Error('Gateway points outside the approved frontend release scope')
        }
      } else if (op?.type === 'dummy' && op.http_code === 307) {
        const prefix = `https://storage.yandexcloud.net/${target.bucket}/`
        const location = op.http_headers?.Location ?? ''
        if (!location.startsWith(prefix) || !objectKey(location.slice(prefix.length)) || !location.endsWith('.wasm')) {
          throw new Error('Unexpected public redirect')
        }
      } else if (path === frontendHealthPath && op?.type === 'dummy'
          && op.http_code === 200) {
        // The exact route, headers and body were checked above.
      } else if (op?.type !== 'dummy' || op.http_code !== 404) {
        throw new Error('Unexpected gateway integration')
      }
    }
  }
  if (Buffer.byteLength(JSON.stringify(spec)) > 3_400_000) throw new Error('Gateway specification too large')
  return spec
}

// Retain all existing content-hashed routes. Never silently prune old tabs' assets.
// Stop at the size limit; reviewed retention cleanup is a separate operation.
export function retainAssets(next, previous) {
  validateSpecification(previous)
  const spec = structuredClone(previous)
  spec.info = next.info
  spec.paths = { ...next.paths }
  for (const [path, route] of Object.entries(previous.paths)) {
    if (immutable(path) && !spec.paths[path]) spec.paths[path] = route
  }
  return validateSpecification(spec)
}

// Bucket policy, configured separately by an operator, exposes only release WASM.
// Deployment identity cannot change ACL/policy. Prove access before activation.
export async function verifyStorageAccess(plan, request = fetch) {
  const base = `https://storage.yandexcloud.net/${target.bucket}`
  for (const object of plan.objects.filter((entry) => entry.key.endsWith('.wasm'))) {
    if (!objectKey(object.object) || !object.key.startsWith('assets/')) throw new Error('Unexpected WASM key')
    for (const origin of [target.frontendOrigin, target.customOrigin]) {
      const response = await request(`${base}/${object.object}`, {
        headers: { Origin: origin }, redirect: 'manual', signal: AbortSignal.timeout(20_000),
      })
      if (response.status !== 200 || response.headers.get('access-control-allow-origin') !== origin
          || response.headers.get('content-type') !== object.contentType
          || hash(Buffer.from(await response.arrayBuffer())) !== object.sha256) {
        throw new Error('Public WASM access, bytes, MIME or CORS mismatch; activation refused')
      }
    }
  }
  const privateObjects = plan.objects.filter((entry) => !entry.key.endsWith('.wasm'))
  await releaseBatch(privateObjects, async (object) => {
    const response = await request(`${base}/${object.object}`, {
      method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(20_000),
    })
    if (response.status !== 403) throw new Error('Non-WASM object is not confirmed private; activation refused')
  })
  const listing = await request(`${base}?list-type=2&max-keys=1`, {
    redirect: 'manual', signal: AbortSignal.timeout(20_000),
  })
  if (listing.status !== 403) throw new Error('Bucket listing is not confirmed private; activation refused')
}

export async function smoke(bundle, origin, request = fetch, plan = gatewayPlan(bundle, [], target), sleep = delay) {
  const index = bundle.files.find((f) => f.key === 'index.html')
  const fetchRoute = async (label, url, options) => {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try { return await request(url, options) } catch {
        if (attempt === 3) throw new DeploymentCheckError(`Frontend request failed: ${label}`)
        await sleep(5000)
      }
    }
  }
  const check = async (path, file) => {
    const response = await fetchRoute(path, `${origin}${path}`, { redirect: 'manual', signal: AbortSignal.timeout(20_000) })
    if (response.status !== 200 || hash(Buffer.from(await response.arrayBuffer())) !== file.sha256
        || response.headers.get('content-type') !== file.contentType) throw new DeploymentCheckError(`Frontend smoke failed: ${path}`)
    const cache = response.headers.get('cache-control') ?? ''
    if (file.cacheControl.includes('immutable') ? !cache.includes('immutable') : !cache.includes('no-store')) {
      throw new DeploymentCheckError(`Unexpected frontend cache policy: ${path}`)
    }
  }
  // A freshly activated Yandex API Gateway can accept the control-plane update
  // before its Object Storage routes are warm. Prime the lightweight dummy
  // route first, matching the production warmup probe, then verify HTML/assets.
  const health = await fetchRoute(frontendHealthPath, `${origin}${frontendHealthPath}`, {
    redirect: 'manual', signal: AbortSignal.timeout(20_000),
  })
  if (health.status !== 200 || (health.headers.get('content-type') ?? '').split(';')[0] !== 'text/plain'
      || !(health.headers.get('cache-control') ?? '').includes('no-store')
      || await health.text() !== frontendHealthBody) {
    throw new DeploymentCheckError('Frontend gateway health route mismatch')
  }
  for (const path of ['/', '/auth', '/auth/yandex/callback', '/today']) await check(path, index)
  await releaseBatch(bundle.files, async (file) => {
    const object = plan.objects.find((entry) => entry.key === file.key)
    if (object.delivery === 'public-object-redirect') {
      const response = await fetchRoute(`/${file.key}`, `${origin}/${file.key}`, { redirect: 'manual', signal: AbortSignal.timeout(20_000) })
      const url = `https://storage.yandexcloud.net/${target.bucket}/${object.object}`
      if (response.status !== 307 || response.headers.get('location') !== url) throw new DeploymentCheckError('WASM redirect mismatch')
      for (const allowedOrigin of [target.frontendOrigin, target.customOrigin]) {
        const asset = await fetchRoute(`storage:${file.key}`, url, { headers: { Origin: allowedOrigin }, signal: AbortSignal.timeout(20_000) })
        if (asset.status !== 200 || asset.headers.get('access-control-allow-origin') !== allowedOrigin
            || hash(Buffer.from(await asset.arrayBuffer())) !== file.sha256) throw new DeploymentCheckError('WASM bytes or CORS mismatch')
      }
    } else await check(`/${file.key}`, file)
  })
  const missing = await fetchRoute('/assets/fit-deploy-missing.css', `${origin}/assets/fit-deploy-missing.css`, { signal: AbortSignal.timeout(20_000) })
  if (missing.status !== 404) throw new DeploymentCheckError('Missing assets must return 404')
  await check('/assets/fit-deploy-missing.js', bundle.files.find((f) => f.key === 'asset-recovery.js'))
}

export async function deployFrontend(bundle, cloud) {
  const plan = gatewayPlan(bundle, [], target)
  const before = validateSpecification(await cloud.specification())
  await cloud.assertReady()
  await reuseReleaseObjects(plan, before, cloud, target.bucket)
  const next = retainAssets(plan.specification, before)
  const oldIndex = await cloud.routeBytes(before.paths['/'])
  await cloud.backup(before, next)
  const manifest = releaseManifest(plan, before.info.version)
  manifest.previousSpecification = before
  await cloud.recordManifest(manifest)
  await cloud.upload(bundle, plan)
  await releaseBatch(plan.objects, (object) => cloud.verifyMetadata(object))
  await cloud.verifyStorageAccess(plan)
  await cloud.assertCurrentCommit(bundle.commit)
  await cloud.assertReady()
  if (!gatewaySpecificationsEqual(before, await cloud.specification())) throw new Error('Gateway changed during upload; stopped')
  // No blind retry of activation: an uncertain update must first settle.
  let activationCompleted = false
  let stage = 'activate'
  try {
    await cloud.activate(next)
    activationCompleted = true
    stage = 'smoke'
    await cloud.smoke(bundle, plan)
    stage = 'activation-readiness'
    await cloud.assertReady()
    stage = 'activation-readback'
    if (!gatewaySpecificationsEqual(next, await cloud.specification())) throw new DeploymentCheckError('Activated gateway differs from candidate')
  } catch (cause) {
    const original = `stage=${stage}: ${failureReason(cause)}`
    let rollbackStage = 'rollback-readiness'
    try {
      await cloud.assertReady()
      rollbackStage = 'rollback-inspection'
      const current = await cloud.specification()
      if (!activationCompleted && gatewaySpecificationsEqual(current, before)) {
        throw new DeploymentCheckError('Activation outcome uncertain; previous spec is still visible. Inspect cloud operations before retry.')
      }
      if (!gatewaySpecificationsEqual(current, before) && !gatewaySpecificationsEqual(current, next)) {
        throw new DeploymentCheckError('Concurrent or uncertain gateway update; automatic rollback refused. Use saved backup after inspection.')
      }
      rollbackStage = 'rollback-activate'
      if (!gatewaySpecificationsEqual(current, before)) await cloud.activate(before)
      rollbackStage = 'rollback-readback'
      if (!gatewaySpecificationsEqual(before, await cloud.specification())) throw new DeploymentCheckError('Rollback specification verification failed')
      rollbackStage = 'rollback-readiness'
      await cloud.assertReady()
      rollbackStage = 'rollback-smoke'
      await cloud.verifyRollback(oldIndex)
    } catch (rollbackError) {
      throw new Error(`Frontend publication failed; ${original}; stage=${rollbackStage}: ${failureReason(rollbackError)}`, { cause: new AggregateError([cause, rollbackError]) })
    }
    throw new Error(`Frontend publication failed; previous gateway restored and verified; ${original}`, { cause })
  }
  return { release: bundle.release, files: plan.objects.length,
    reused: plan.objects.filter((object) => object.reused).length, status: 'verified' }
}

export function createCloud({ directory, token, githubToken, run = promisify(execFile), request = fetch }) {
  const api = `https://serverless-apigateway.api.cloud.yandex.net/apigateways/v1/apigateways/${target.gateway}`
  const json = async (url, bearer) => {
    const response = await request(url, { headers: { Authorization: `Bearer ${bearer}` }, signal: AbortSignal.timeout(30_000) })
    if (!response.ok) throw new DeploymentCheckError(`Read-only deployment API failed: HTTP ${response.status}`)
    return response.json()
  }
  const yc = async (args) => {
    try { return await run('yc', args, { timeout: 240_000, maxBuffer: 8_000_000 }) }
    catch (cause) { throw new DeploymentCheckError(`Yandex command failed: ${args.slice(0, 3).join(' ')}; inspect gateway status before retry`, { cause }) }
  }
  const retry = (action, attempts = 4) => retryTransient(action, { attempts })
  return {
    specification: async () => JSON.parse((await json(`${api}:spec?format=JSON`, token)).openapiSpec),
    assertReady: async () => {
      await retry(async () => {
        const state = await json(api, token)
        if (state.status !== 'ACTIVE' || state.logOptions?.disabled !== true) {
          throw new DeploymentCheckError('Gateway is not ACTIVE with request logging disabled')
        }
      })
    },
    assertCurrentCommit: async (commit) => {
      const head = await json('https://api.github.com/repos/podkolzinpd/fit/commits/main', githubToken)
      if (head.sha !== commit) throw new Error('A newer main commit exists; stale deployment skipped')
    },
    backup: async (before, next) => {
      await writeFile(join(directory, 'previous-gateway.json'), JSON.stringify(before), { flag: 'wx' })
      await writeFile(join(directory, 'candidate-gateway.json'), JSON.stringify(next), { flag: 'wx' })
    },
    recordManifest: async (manifest) => {
      const key = manifestKey(manifest.release)
      const path = join(directory, 'release-manifest.json')
      try {
        await yc(['storage', 's3api', 'get-object', '--bucket', target.bucket, '--key', key, path])
        const existing = JSON.parse(await readFile(path, 'utf8'))
        if (existing.release !== manifest.release || !isDeepStrictEqual(existing.objects, manifest.objects)
            || !isDeepStrictEqual(existing.specification, manifest.specification)) throw new Error('Manifest conflict')
        return
      } catch (error) {
        // Only a proven missing key permits creation; permission/network errors
        // must never be interpreted as absence.
        if (!/NoSuchKey/.test(String(error.cause?.stderr))) throw error
      }
      await writeFile(path, JSON.stringify(manifest))
      await yc(['storage', 's3api', 'put-object', '--bucket', target.bucket, '--key', key,
        '--body', path, '--content-type', 'application/json', '--cache-control', 'no-store'])
      await yc(['storage', 's3api', 'get-object', '--bucket', target.bucket, '--key', key, path])
      if (!isDeepStrictEqual(JSON.parse(await readFile(path, 'utf8')), manifest)) throw new Error('Manifest verification failed')
    },
    upload: (bundle, plan) => uploadCandidate(bundle, run, plan),
    verifyMetadata: async (object) => {
      const { stdout } = await yc(['storage', 's3api', 'head-object', '--bucket', target.bucket, '--key', object.object, '--format', 'json'])
      const metadata = JSON.parse(stdout)
      if (metadata.content_type !== object.contentType || metadata.cache_control !== object.cacheControl
          || (metadata.content_encoding ?? null) !== object.upload.contentEncoding
          || Number(metadata.content_length) !== object.upload.size) throw new Error('Remote object metadata mismatch')
    },
    verifyStorageAccess: (plan) => retry(() => verifyStorageAccess(plan, request)),
    routeBytes: async (route) => {
      const op = route.get[integration]
      // All spec targets are validated before this function is called.
      const key = op.type === 'object_storage' ? op.object : op.http_headers.Location.split(`/${target.bucket}/`)[1]
      const file = join(directory, `inspect-${randomUUID()}`)
      const { stdout } = await yc(['storage', 's3api', 'get-object', '--bucket', target.bucket, '--key', key, file, '--format', 'json'])
      const bytes = await readFile(file)
      const metadata = JSON.parse(stdout)
      if (metadata.content_encoding === 'gzip') {
        const { gunzipSync } = await import('node:zlib')
        return gunzipSync(bytes)
      }
      return bytes
    },
    activate: async (spec) => {
      validateSpecification(spec)
      const path = join(directory, 'activate-gateway.json')
      await writeFile(path, JSON.stringify(spec))
      // Updating only --spec preserves custom domains, certificate and log options.
      await yc(['serverless', 'api-gateway', 'update', target.gateway, '--spec', path, '--format', 'json'])
    },
    // The custom domain is the user-visible production entry point. The provider
    // hostname is still covered by the gateway readback and both-origin CORS checks.
    // Custom-domain propagation has repeatedly exceeded the old ~6 minute
    // smoke budget even though the control plane was ACTIVE. Keep retrying the
    // read-only smoke for up to ~13 minutes; activation itself is still issued
    // exactly once and the workflow's 30 minute timeout preserves rollback room.
    smoke: (bundle, plan) => retry(() => smoke(bundle, target.customOrigin, request, plan), 8),
    verifyRollback: (expected) => retry(async () => {
      const response = await request(`${target.customOrigin}/auth`, { signal: AbortSignal.timeout(20_000) })
      if (response.status !== 200 || hash(Buffer.from(await response.arrayBuffer())) !== hash(expected)) {
        throw new DeploymentCheckError('Previous frontend was not restored')
      }
    }),
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [input, directory, flag] = process.argv.slice(2)
  if (!input || !directory || flag !== '--deploy' || !process.env.YC_IAM_TOKEN || !process.env.GH_TOKEN) {
    throw new Error('Usage: deploy-yandex-frontend.mjs RELEASE BACKUP_DIRECTORY --deploy; short-lived IAM and GitHub tokens required')
  }
  await mkdir(directory, { recursive: true })
  try {
    const result = await deployFrontend(JSON.parse(await readFile(input, 'utf8')), createCloud({
      directory, token: process.env.YC_IAM_TOKEN, githubToken: process.env.GH_TOKEN,
    }))
    console.log(JSON.stringify(result))
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
