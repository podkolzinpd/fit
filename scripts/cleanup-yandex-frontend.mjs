import { execFile } from 'node:child_process'
import { promisify, isDeepStrictEqual } from 'node:util'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { target, validateSpecification } from './deploy-yandex-frontend.mjs'
import { gatewayRoutesEqual, gatewaySpecificationsEqual } from './frontend-gateway-specification.mjs'
import { releaseId, isReleaseObject, manifestKey, routeObject, releaseBatch, digest } from './frontend-release-storage.mjs'

const DAY = 86_400_000
const hashedAsset = (path) => /^\/assets\/[a-zA-Z0-9_./-]+-[A-Za-z0-9_-]{8,}\.[a-z0-9]+$/.test(path)
const legacyFolderKey = (key) => typeof key === 'string' && (key === 'releases/'
  || /^releases\/[a-f0-9]{40}-[a-f0-9]{64}\/(?:[a-zA-Z0-9_-]+\/)*$/.test(key))
const legacyFolderMarker = (item) => item?.size === 0 && legacyFolderKey(item.key)
const inventorySize = (item) => {
  // YC CLI omits zero-valued size for legacy S3 folder markers. Only accept
  // that omission for a canonical marker with the empty-object ETag.
  if (item.size === undefined && legacyFolderKey(item.key)
      && item.etag === '"d41d8cd98f00b204e9800998ecf8427e"') return 0
  return typeof item.size === 'number' || (typeof item.size === 'string' && /^\d+$/.test(item.size))
    ? Number(item.size) : NaN
}
export function referencedObjects(spec) {
  validateSpecification(spec)
  const objects = new Set()
  for (const route of Object.values(spec.paths)) {
    for (const method of ['get', 'head']) {
      const op = route[method]?.['x-yc-apigateway-integration']
      if (op?.type === 'object_storage' || op?.http_code === 307) {
        objects.add(routeObject({ get: route[method] }, target.bucket))
      }
    }
  }
  return objects
}

export function planCleanup({ specification, manifests, inventory, now = new Date() }) {
  referencedObjects(specification)
  const cutoff = now.getTime() - 3 * DAY
  if (!Number.isFinite(cutoff)) throw new Error('Invalid cleanup time')
  const records = new Map()
  for (const m of manifests) {
    if (m.schemaVersion !== 1 || !releaseId.test(m.release) || !releaseId.test(m.previous)
        || !Number.isFinite(Date.parse(m.createdAt)) || Date.parse(m.createdAt) > now.getTime()
        || !Array.isArray(m.objects) || !m.objects.length || m.objects.some((key) => !isReleaseObject(key))
        || records.has(m.release) || m.specification?.info?.version !== m.release
        || m.previousSpecification?.info?.version !== m.previous) throw new Error('Invalid cleanup manifest')
    if (!isDeepStrictEqual([...referencedObjects(m.specification)].sort(), [...new Set(m.objects)].sort())) {
      throw new Error('Manifest reference mismatch')
    }
    referencedObjects(m.previousSpecification)
    records.set(m.release, m)
  }
  const active = records.get(specification.info.version)
  if (!active) throw new Error('Active release has no verified manifest; cleanup refused')
  // Only known OpenAPI defaults are normalized; manual route changes still fail.
  for (const [path, route] of Object.entries(active.specification.paths)) {
    if (!gatewayRoutesEqual(specification.paths[path], route)) throw new Error('Active gateway differs from manifest')
  }
  const keep = manifests.filter((m) => m.release === active.release || m.release === active.previous
    || Date.parse(m.createdAt) >= cutoff)
  const protectedKeys = new Set(keep.flatMap((m) => [...m.objects, manifestKey(m.release)]))
  if (!records.has(active.previous)) {
    for (const key of referencedObjects(active.previousSpecification)) protectedKeys.add(key)
  }
  const keepPaths = new Set(keep.flatMap((m) => Object.keys(m.specification.paths)))
  if (!records.has(active.previous)) Object.keys(active.previousSpecification.paths).forEach((path) => keepPaths.add(path))
  const knownKeys = new Set(manifests.flatMap((m) => m.objects))
  const next = structuredClone(specification)
  for (const [path, route] of Object.entries(next.paths)) {
    if (hashedAsset(path) && !keepPaths.has(path) && knownKeys.has(routeObject(route, target.bucket))) delete next.paths[path]
  }
  for (const key of referencedObjects(next)) protectedKeys.add(key)
  const seen = new Set()
  for (const [index, item] of inventory.entries()) {
    // Existing bootstrap bundle observed in the bucket; never a deletion target.
    const bootstrapBundle = item.key === 'releases/frontend-release.json'
    // The console and older upload tooling may have left zero-byte S3 folder
    // markers. They carry no release data and are preserved, not cleanup targets.
    const folderMarker = legacyFolderMarker(item)
    const reason = !Number.isSafeInteger(item.size) || item.size < 0 ? 'invalid size'
      : !isReleaseObject(item.key) && !bootstrapBundle && !folderMarker ? 'unsupported key'
        : seen.has(item.key) ? 'duplicate key'
          : !Number.isFinite(Date.parse(item.lastModified)) ? 'invalid date' : undefined
    // Do not print arbitrary object keys or raw cloud responses in failure logs.
    if (reason) throw new Error(`Invalid object inventory: item ${index}, ${reason}`)
    seen.add(item.key)
  }
  if ([...protectedKeys].some((key) => !seen.has(key))) throw new Error('Protected object missing; cleanup refused')
  const expiredManifests = new Set(manifests.filter((m) => !keep.includes(m)).map((m) => manifestKey(m.release)))
  const deletions = inventory.filter((item) => !protectedKeys.has(item.key)
    && Date.parse(item.lastModified) < cutoff && (knownKeys.has(item.key) || expiredManifests.has(item.key)))
  const objects = deletions.filter((item) => !expiredManifests.has(item.key))
  const removableManifests = deletions.filter((item) => expiredManifests.has(item.key) &&
    records.get(item.key.split('/')[1]).objects.every((key) => protectedKeys.has(key) || !seen.has(key)
      || deletions.some((entry) => entry.key === key)))
  // Preserve orphaned pre-manifest releases. Age alone never authorizes deletion.
  return { schemaVersion: 1, active: active.release, previous: active.previous,
    keptReleases: keep.map((m) => m.release).sort(),
    before: specification, after: next,
    objects, manifests: removableManifests,
    bytes: [...objects, ...removableManifests].reduce((sum, item) => sum + item.size, 0) }
}

export async function applyCleanup(plan, cloud) {
  const assertUnchanged = async (expected) => {
    await cloud.assertReady()
    if (!gatewaySpecificationsEqual(await cloud.specification(), expected)) throw new Error('Gateway changed; cleanup stopped')
  }
  await assertUnchanged(plan.before)
  await cloud.backup(plan)
  if (!isDeepStrictEqual(plan.before, plan.after)) {
    await cloud.activate(plan.after)
    await assertUnchanged(plan.after)
  }
  // Verify current entrypoints before deleting anything. On failure do not delete.
  await cloud.verifyActive()
  for (const batch of [plan.objects, plan.manifests]) {
    for (let offset = 0; offset < batch.length; offset += 6) {
      await assertUnchanged(plan.after)
      const items = batch.slice(offset, offset + 6)
      await releaseBatch(items, (item) => cloud.assertObjectUnchanged(item))
      await releaseBatch(items, (item) => cloud.remove(item.key))
    }
  }
  await assertUnchanged(plan.after)
  await cloud.verifyActive()
}

export function cleanupCloud({ directory, token, run = promisify(execFile), request = fetch }) {
  const api = `https://serverless-apigateway.api.cloud.yandex.net/apigateways/v1/apigateways/${target.gateway}`
  const json = async (url) => {
    const res = await request(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) })
    if (!res.ok) throw new Error(`Cleanup read failed: HTTP ${res.status}`)
    return res.json()
  }
  const yc = async (args) => {
    try { return await run('yc', args, { timeout: 120_000, maxBuffer: 8_000_000 }) }
    catch { throw new Error(`Cleanup command failed: ${args.slice(0, 3).join(' ')}`) }
  }
  const objectArgs = (key) => {
    if (!isReleaseObject(key)) throw new Error('Unsafe cleanup key')
    return ['--bucket', target.bucket, '--key', key]
  }
  return {
    specification: async () => JSON.parse((await json(`${api}:spec?format=JSON`)).openapiSpec),
    assertReady: async () => {
      const state = await json(api)
      if (state.status !== 'ACTIVE' || state.logOptions?.disabled !== true) throw new Error('Gateway not ready')
    },
    inventory: async () => {
      const items = []
      const tokens = new Set()
      let token
      do {
        const { stdout } = await yc(['storage', 's3api', 'list-objects-v2', '--bucket', target.bucket,
          '--prefix', 'releases/', '--max-keys', '1000', ...(token ? ['--continuation-token', token] : []), '--format', 'json'])
        const page = JSON.parse(stdout)
        if (!Array.isArray(page.contents)) throw new Error('Unknown list response')
        for (const item of page.contents) items.push({ key: item.key, size: inventorySize(item),
          lastModified: item.last_modified, etag: item.etag })
        token = page.is_truncated ? page.next_continuation_token : undefined
        if (page.is_truncated && (!token || tokens.has(token))) throw new Error('Incomplete inventory')
        tokens.add(token)
      } while (token)
      return items
    },
    readManifest: async (key) => {
      const file = join(directory, digest(Buffer.from(key)))
      await yc(['storage', 's3api', 'get-object', ...objectArgs(key), file])
      const m = JSON.parse(await readFile(file, 'utf8'))
      if (manifestKey(m.release) !== key) throw new Error('Manifest key mismatch')
      return m
    },
    backup: async (plan) => writeFile(join(directory, 'cleanup-plan.json'), JSON.stringify(plan), { flag: 'wx' }),
    activate: async (spec) => {
      validateSpecification(spec)
      const file = join(directory, 'cleanup-gateway.json')
      await writeFile(file, JSON.stringify(spec))
      await yc(['serverless', 'api-gateway', 'update', target.gateway, '--spec', file])
    },
    assertObjectUnchanged: async (item) => {
      const { stdout } = await yc(['storage', 's3api', 'head-object', ...objectArgs(item.key), '--format', 'json'])
      const head = JSON.parse(stdout)
      const headTime = Date.parse(head.last_modified_at)
      const listedTime = Date.parse(item.lastModified)
      // HEAD uses HTTP Last-Modified (whole seconds), while ListObjectsV2
      // retains milliseconds. Compare at the available server precision;
      // ETag and exact size must still match before any DELETE.
      if (!item.etag || head.etag !== item.etag || inventorySize({ size: head.content_length }) !== item.size
          || !Number.isFinite(headTime) || !Number.isFinite(listedTime)
          || Math.floor(headTime / 1000) !== Math.floor(listedTime / 1000)) throw new Error('Object changed; cleanup stopped')
    },
    remove: async (key) => {
      await yc(['storage', 's3api', 'delete-object', ...objectArgs(key)])
      // A regular DELETE respects bucket versioning; never purge object versions.
      // Confirm absence via list, avoiding broad/recursive delete commands.
      const { stdout } = await yc(['storage', 's3api', 'list-objects-v2', '--bucket', target.bucket,
        '--prefix', key, '--max-keys', '1', '--format', 'json'])
      if ((JSON.parse(stdout).contents ?? []).some((item) => item.key === key)) throw new Error('Deletion not confirmed')
    },
    verifyActive: async () => {
      for (const path of ['/auth', '/sw.js']) {
        const a = await request(`${target.frontendOrigin}${path}`, { signal: AbortSignal.timeout(20_000) })
        const b = await request(`${target.customOrigin}${path}`, { signal: AbortSignal.timeout(20_000) })
        if (a.status !== 200 || b.status !== 200 || digest(Buffer.from(await a.arrayBuffer())) !== digest(Buffer.from(await b.arrayBuffer()))) {
          throw new Error('Active site smoke failed; cleanup stopped')
        }
      }
    },
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [directory, mode] = process.argv.slice(2)
  if (!directory || !['--plan', '--apply'].includes(mode) || !process.env.YC_IAM_TOKEN) throw new Error('Expected directory and --plan/--apply')
  await mkdir(directory, { recursive: true })
  const cloud = cleanupCloud({ directory, token: process.env.YC_IAM_TOKEN })
  await cloud.assertReady()
  const specification = await cloud.specification()
  const inventory = await cloud.inventory()
  // Keep a safe diagnostic artifact even if manifest/inventory validation fails.
  await writeFile(join(directory, 'cleanup-inventory-summary.json'), JSON.stringify({
    schemaVersion: 1, objects: inventory.length,
    folderMarkers: inventory.filter(legacyFolderMarker).length,
    invalidSizes: inventory.filter((item) => !Number.isSafeInteger(item.size) || item.size < 0).length,
    invalidDates: inventory.filter((item) => !Number.isFinite(Date.parse(item.lastModified))).length,
  }))
  const keys = inventory.filter((item) => item.key.endsWith('/release-manifest.json')).map((item) => item.key)
  const manifests = await releaseBatch(keys, (key) => cloud.readManifest(key))
  const plan = planCleanup({ specification, manifests, inventory })
  await writeFile(join(directory, 'cleanup-dry-run.json'), JSON.stringify(plan))
  console.log(JSON.stringify({ mode, kept: plan.keptReleases.length, objects: plan.objects.length,
    manifests: plan.manifests.length, bytes: plan.bytes }))
  if (mode === '--apply') await applyCleanup(plan, cloud)
}
