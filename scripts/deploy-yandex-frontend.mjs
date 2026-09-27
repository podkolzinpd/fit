import { execFile } from 'node:child_process'
import { promisify, isDeepStrictEqual } from 'node:util'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { gatewayPlan } from './frontend-gateway-plan.mjs'
import { uploadCandidate } from './upload-frontend-candidate.mjs'

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

export function validateSpecification(spec) {
  if (spec?.openapi !== '3.0.0' || !spec.paths?.['/'] || !spec.paths?.['/assets/{file+}']) {
    throw new Error('Unknown gateway contract; activation refused')
  }
  for (const route of Object.values(spec.paths)) {
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

export async function smoke(bundle, origin, request = fetch) {
  const plan = gatewayPlan(bundle, [], target)
  const index = bundle.files.find((f) => f.key === 'index.html')
  const check = async (path, file) => {
    const response = await request(`${origin}${path}`, { redirect: 'manual', signal: AbortSignal.timeout(20_000) })
    if (response.status !== 200 || hash(Buffer.from(await response.arrayBuffer())) !== file.sha256
        || response.headers.get('content-type') !== file.contentType) throw new Error(`Frontend smoke failed: ${path}`)
    const cache = response.headers.get('cache-control') ?? ''
    if (file.cacheControl.includes('immutable') ? !cache.includes('immutable') : !cache.includes('no-store')) {
      throw new Error(`Unexpected frontend cache policy: ${path}`)
    }
  }
  for (const path of ['/', '/auth', '/auth/yandex/callback', '/today']) await check(path, index)
  for (const file of bundle.files) {
    const object = plan.objects.find((entry) => entry.key === file.key)
    if (object.delivery === 'public-object-redirect') {
      const response = await request(`${origin}/${file.key}`, { redirect: 'manual', signal: AbortSignal.timeout(20_000) })
      const url = `https://storage.yandexcloud.net/${target.bucket}/${object.object}`
      if (response.status !== 307 || response.headers.get('location') !== url) throw new Error('WASM redirect mismatch')
      for (const allowedOrigin of [target.frontendOrigin, target.customOrigin]) {
        const asset = await request(url, { headers: { Origin: allowedOrigin }, signal: AbortSignal.timeout(20_000) })
        if (asset.status !== 200 || asset.headers.get('access-control-allow-origin') !== allowedOrigin
            || hash(Buffer.from(await asset.arrayBuffer())) !== file.sha256) throw new Error('WASM bytes or CORS mismatch')
      }
    } else await check(`/${file.key}`, file)
  }
  const missing = await request(`${origin}/assets/fit-deploy-missing.css`, { signal: AbortSignal.timeout(20_000) })
  if (missing.status !== 404) throw new Error('Missing assets must return 404')
  await check('/assets/fit-deploy-missing.js', bundle.files.find((f) => f.key === 'asset-recovery.js'))
}

export async function deployFrontend(bundle, cloud) {
  const plan = gatewayPlan(bundle, [], target)
  const before = validateSpecification(await cloud.specification())
  await cloud.assertReady()
  const next = retainAssets(plan.specification, before)
  // Check content-hash collisions against bytes, not merely matching filenames.
  for (const file of plan.objects) {
    const route = before.paths[`/${file.key}`]
    if (immutable(`/${file.key}`) && route) {
      if (hash(await cloud.routeBytes(route)) !== file.sha256) throw new Error('Conflicting immutable asset')
    }
  }
  const oldIndex = await cloud.routeBytes(before.paths['/'])
  await cloud.backup(before, next)
  await cloud.upload(bundle)
  for (const object of plan.objects) await cloud.verifyMetadata(object)
  for (const key of plan.publicReadObjects) await cloud.publishWasm(key)
  await cloud.assertCurrentCommit(bundle.commit)
  await cloud.assertReady()
  if (!isDeepStrictEqual(before, await cloud.specification())) throw new Error('Gateway changed during upload; stopped')
  // No blind retry of activation: an uncertain update must first settle.
  let activationCompleted = false
  try {
    await cloud.activate(next)
    activationCompleted = true
    await cloud.smoke(bundle)
    await cloud.assertReady()
    if (!isDeepStrictEqual(next, await cloud.specification())) throw new Error('Activated gateway differs from candidate')
  } catch {
    await cloud.assertReady()
    const current = await cloud.specification()
    if (!activationCompleted && isDeepStrictEqual(current, before)) {
      throw new Error('Activation outcome uncertain; previous spec is still visible. Inspect cloud operations before retry.')
    }
    if (!isDeepStrictEqual(current, before) && !isDeepStrictEqual(current, next)) {
      throw new Error('Concurrent or uncertain gateway update; automatic rollback refused. Use saved backup after inspection.')
    }
    if (!isDeepStrictEqual(current, before)) await cloud.activate(before)
    if (!isDeepStrictEqual(before, await cloud.specification())) throw new Error('Rollback specification verification failed')
    await cloud.assertReady()
    await cloud.verifyRollback(oldIndex)
    throw new Error('Frontend publication failed; previous gateway restored and verified')
  }
  return { release: bundle.release, files: plan.objects.length, status: 'verified' }
}

export function createCloud({ directory, token, githubToken, run = promisify(execFile), request = fetch }) {
  const api = `https://serverless-apigateway.api.cloud.yandex.net/apigateways/v1/apigateways/${target.gateway}`
  const json = async (url, bearer) => {
    const response = await request(url, { headers: { Authorization: `Bearer ${bearer}` }, signal: AbortSignal.timeout(30_000) })
    if (!response.ok) throw new Error(`Read-only deployment API failed: HTTP ${response.status}`)
    return response.json()
  }
  const yc = async (args) => {
    try { return await run('yc', args, { timeout: 240_000, maxBuffer: 8_000_000 }) }
    catch { throw new Error(`Yandex command failed: ${args.slice(0, 3).join(' ')}; inspect gateway status before retry`) }
  }
  const retry = async (action) => {
    for (let attempt = 0; ; attempt += 1) {
      try { return await action() } catch (error) {
        if (attempt === 3) throw error
        await delay(5000)
      }
    }
  }
  return {
    specification: async () => JSON.parse((await json(`${api}:spec?format=JSON`, token)).openapiSpec),
    assertReady: async () => {
      await retry(async () => {
        const state = await json(api, token)
        if (state.status !== 'ACTIVE' || state.logOptions?.disabled !== true) {
          throw new Error('Gateway is not ACTIVE with request logging disabled')
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
    upload: (bundle) => uploadCandidate(bundle, run),
    verifyMetadata: async (object) => {
      const { stdout } = await yc(['storage', 's3api', 'head-object', '--bucket', target.bucket, '--key', object.object, '--format', 'json'])
      const metadata = JSON.parse(stdout)
      if (metadata.content_type !== object.contentType || metadata.cache_control !== object.cacheControl
          || (metadata.content_encoding ?? null) !== object.upload.contentEncoding
          || Number(metadata.content_length) !== object.upload.size) throw new Error('Remote object metadata mismatch')
    },
    publishWasm: async (key) => {
      if (!objectKey(key) || !key.endsWith('.wasm')) throw new Error('Refusing public ACL outside WASM release files')
      await yc(['storage', 's3api', 'put-object-acl', '--bucket', target.bucket, '--key', key, '--acl', 'public-read'])
    },
    routeBytes: async (route) => {
      const op = route.get[integration]
      // All spec targets are validated before this function is called.
      const key = op.type === 'object_storage' ? op.object : op.http_headers.Location.split(`/${target.bucket}/`)[1]
      const file = join(directory, 'inspect-object')
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
    smoke: (bundle) => retry(() => smoke(bundle, target.frontendOrigin, request)),
    verifyRollback: (expected) => retry(async () => {
      const response = await request(`${target.frontendOrigin}/auth`, { signal: AbortSignal.timeout(20_000) })
      if (response.status !== 200 || hash(Buffer.from(await response.arrayBuffer())) !== hash(expected)) {
        throw new Error('Previous frontend was not restored')
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
