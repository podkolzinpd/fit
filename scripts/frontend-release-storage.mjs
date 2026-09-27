import { createHash } from 'node:crypto'

export const releaseId = /^[a-f0-9]{40}-[a-f0-9]{64}$/
export const isReleaseObject = (key) => typeof key === 'string'
  && /^releases\/[a-f0-9]{40}-[a-f0-9]{64}\/[a-zA-Z0-9_./-]+$/.test(key)
  && key.split('/').every((part) => part && !part.startsWith('.'))
export const manifestKey = (release) => {
  if (!releaseId.test(release)) throw new Error('Invalid release ID')
  return `releases/${release}/release-manifest.json`
}
export const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')

// Bounded workers; drain in-flight work on error before cleanup or activation.
export async function releaseBatch(items, action, concurrency = 6) {
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 6) throw new Error('Invalid concurrency')
  let cursor = 0
  let failure
  const results = new Array(items.length)
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (!failure && cursor < items.length) {
      const index = cursor++
      try { results[index] = await action(items[index], index) }
      catch (error) { failure ??= error }
    }
  }))
  if (failure) throw failure
  return results
}

export function routeObject(route, bucket) {
  const op = route?.get?.['x-yc-apigateway-integration']
  if (op?.type === 'object_storage' && op.bucket === bucket && isReleaseObject(op.object)) return op.object
  const prefix = `https://storage.yandexcloud.net/${bucket}/`
  if (op?.type === 'dummy' && op.http_code === 307 && op.http_headers?.Location?.startsWith(prefix)) {
    const key = op.http_headers.Location.slice(prefix.length)
    if (isReleaseObject(key) && key.endsWith('.wasm')) return key
  }
  throw new Error('Unknown release object route')
}

// Reuse verified objects in the existing approved releases/* namespace. No new
// bucket policy or global mutable asset directory is required.
export async function reuseReleaseObjects(plan, before, cloud, bucket) {
  const remap = new Map()
  await releaseBatch(plan.objects, async (object) => {
    const old = before.paths[`/${object.key}`]
    if (!old) return
    const oldHash = digest(await cloud.routeBytes(old))
    if (oldHash !== object.sha256) {
      if (object.cacheControl.includes('immutable')) throw new Error('Conflicting immutable asset')
      return
    }
    const reused = routeObject(old, bucket)
    remap.set(object.object, reused)
    object.object = reused
    object.reused = true
  })
  for (const route of Object.values(plan.specification.paths)) {
    for (const method of ['get', 'head']) {
      const op = route[method]?.['x-yc-apigateway-integration']
      if (op?.type === 'object_storage') op.object = remap.get(op.object) ?? op.object
      else if (op?.http_code === 307) {
        const key = routeObject({ get: route[method] }, bucket)
        op.http_headers.Location = `https://storage.yandexcloud.net/${bucket}/${remap.get(key) ?? key}`
      }
    }
  }
  plan.publicReadObjects = plan.publicReadObjects.map((key) => remap.get(key) ?? key)
  return plan
}

export function releaseManifest(plan, previous, now = new Date()) {
  return {
    schemaVersion: 1, release: plan.release, previous,
    createdAt: now.toISOString(),
    objects: [...new Set(plan.objects.map((object) => object.object))].sort(),
    // Only this release's routes, not the accumulated compatibility routes.
    specification: structuredClone(plan.specification),
  }
}
