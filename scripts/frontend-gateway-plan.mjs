import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { verifyRelease } from './frontend-release.mjs'
import { gzipSync } from 'node:zlib'
import { createHash } from 'node:crypto'

export function gatewayUpload(file) {
  const compressed = file.size > 2_400_000 && file.key.endsWith('.js')
    && file.cacheControl.includes('immutable')
  const bytes = compressed ? gzipSync(Buffer.from(file.content, 'base64'), { level: 9 })
    : Buffer.from(file.content, 'base64')
  return { content: bytes.toString('base64'), size: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    contentEncoding: compressed ? 'gzip' : null }
}

// Compile a reviewed release into a candidate spec. Never upload or activate here.
export function gatewayPlan(active, previous, { bucket, reader, frontendOrigin }) {
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket ?? '')
      || !/^[a-z0-9]{20}$/.test(reader ?? '')) throw new Error('Invalid hosting target')
  if (frontendOrigin !== undefined) {
    const url = new URL(frontendOrigin)
    if (url.protocol !== 'https:' || url.origin !== frontendOrigin) throw new Error('Expected HTTPS frontend origin')
  }
  for (const bundle of [active, ...previous]) verifyRelease(bundle)
  const files = new Map()
  const objects = new Map()
  for (const bundle of [active, ...previous]) {
    for (const file of bundle.files) {
      const immutable = file.cacheControl.includes('immutable')
      if (bundle !== active && !immutable) continue
      // Reserve headroom below API Gateway's documented 2.5 MB response limit.
      const upload = gatewayUpload(file)
      const direct = upload.size > 2_400_000
      if (direct && (!immutable || !file.key.endsWith('.wasm') || !frontendOrigin)) {
        throw new Error(`File exceeds gateway response budget: ${file.key}`)
      }
      const existing = files.get(file.key)
      if (existing && immutable && existing.sha256 !== file.sha256) {
        throw new Error('Conflicting immutable asset')
      }
      if (existing) continue
      const object = `releases/${bundle.release}/${file.key}`
      const entry = { ...file, upload, object, delivery: direct ? 'public-object-redirect' : 'private-gateway',
        cacheControl: immutable ? file.cacheControl : 'no-store' }
      files.set(file.key, entry)
      objects.set(object, entry)
    }
  }
  const operation = (object) => ({
    responses: { 200: { description: 'Frontend file' } },
    'x-yc-apigateway-integration': {
      type: 'object_storage', bucket, object, service_account_id: reader,
    },
  })
  const pair = (op) => ({ get: op, head: structuredClone(op) })
  const paths = {}
  for (const [key, file] of files) {
    paths[`/${key}`] = pair(file.delivery === 'public-object-redirect' ? {
      responses: { 307: { description: 'Version-pinned public WASM object' } },
      'x-yc-apigateway-integration': { type: 'dummy', http_code: 307,
        http_headers: {
          Location: `https://storage.yandexcloud.net/${bucket}/${file.object}`,
          'Cache-Control': 'no-store',
        }, content: { '*': '' } },
    } : operation(file.object))
  }
  paths['/'] = pair(operation(files.get('index.html').object))
  const parameter = (name) => [{ name, in: 'path', required: true, schema: { type: 'string' } }]
  paths['/assets/{file+}.js'] = {
    parameters: parameter('file'), ...pair(operation(files.get('asset-recovery.js').object)),
  }
  paths['/assets/{file+}'] = {
    parameters: parameter('file'),
    ...pair({ responses: { 404: { description: 'Asset not found' } },
      'x-yc-apigateway-integration': { type: 'dummy', http_code: 404,
        http_headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
        content: { '*': 'Not found' } } }),
  }
  paths['/{path+}'] = {
    parameters: parameter('path'), ...pair(operation(files.get('index.html').object)),
  }
  const specification = { openapi: '3.0.0', info: { title: 'FIT frontend candidate', version: active.release }, paths }
  if (Buffer.byteLength(JSON.stringify(specification)) > 3_400_000) throw new Error('Gateway specification too large')
  return {
    schemaVersion: 1, release: active.release, deployable: false,
    gates: ['review-public-build-config', 'upload-and-verify-all-objects', 'save-current-gateway-spec',
      'review-route-limits-and-precedence', 'verify-public-wasm-acl-and-browser-cors', 'explicit-activation'],
    // Exact object list, not a bucket-wide public access policy. CORS is not authorization.
    publicReadObjects: [...objects.values()].filter((f) => f.delivery === 'public-object-redirect').map((f) => f.object),
    requiredCors: frontendOrigin ? { allowedOrigins: [frontendOrigin], allowedMethods: ['GET', 'HEAD'],
      allowedHeaders: ['Range'], exposeHeaders: ['ETag', 'Content-Length', 'Content-Range'], maxAgeSeconds: 3600 } : null,
    objects: [...objects.values()],
    specification,
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [input, bucket, reader, output, ...retained] = process.argv.slice(2)
  if (!input || !output) throw new Error('Usage: frontend-gateway-plan.mjs RELEASE BUCKET READER OUTPUT [RETAINED_RELEASE...]')
  const load = async (path) => JSON.parse(await readFile(path, 'utf8'))
  const plan = gatewayPlan(await load(input), await Promise.all(retained.map(load)), {
    bucket, reader, frontendOrigin: process.env.FIT_FRONTEND_ORIGIN,
  })
  await writeFile(output, JSON.stringify(plan, null, 2) + '\n', { flag: 'wx' })
  console.log(`Prepared ${plan.objects.length} objects; activation disabled`)
}
