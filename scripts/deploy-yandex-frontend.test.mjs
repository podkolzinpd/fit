import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { packageRelease, supportedRouting } from './frontend-release.mjs'
import { gatewayPlan } from './frontend-gateway-plan.mjs'
import { deployFrontend, retainAssets, target, validateSpecification, smoke, createCloud, verifyStorageAccess } from './deploy-yandex-frontend.mjs'

async function fixture(t, name = 'old', wasm = false) {
  const directory = await mkdtemp(join(tmpdir(), 'fit-deploy-test-'))
  t.after(() => rm(directory, { force: true, recursive: true }))
  await mkdir(join(directory, 'assets'))
  const files = { 'index.html': `<html>${name}</html>`, 'sw.js': `// ${name}`, 'asset-recovery.js': '// recovery',
    'site.webmanifest': '{}', [`assets/${name}-12345678.js`]: `// ${name}`, 'assets/theme-12345678.css': 'body {}' }
  if (wasm) files['assets/engine-12345678.wasm'] = Buffer.alloc(2_500_000)
  for (const [key, bytes] of Object.entries(files)) await writeFile(join(directory, key), bytes)
  return packageRelease(directory, name === 'old' ? 'a'.repeat(40) : 'b'.repeat(40), supportedRouting)
}

function fakeCloud(beforeBundle) {
  const before = gatewayPlan(beforeBundle, [], target).specification
  let current = structuredClone(before)
  const events = []
  const cloud = {
    events, before,
    specification: async () => structuredClone(current),
    assertReady: async () => { events.push('ready') },
    assertCurrentCommit: async () => { events.push('current') },
    routeBytes: async (route) => {
      const key = route.get['x-yc-apigateway-integration'].object.split('/').slice(2).join('/')
      return Buffer.from(beforeBundle.files.find((file) => file.key === key).content, 'base64')
    },
    backup: async () => { events.push('backup') },
    upload: async () => { events.push('upload') },
    verifyMetadata: async () => { events.push('metadata') },
    verifyStorageAccess: async () => { events.push('storage-access') },
    activate: async (spec) => { events.push('activate'); current = structuredClone(spec) },
    smoke: async () => { events.push('smoke') },
    verifyRollback: async (bytes) => { events.push('rollback-verified'); assert.equal(bytes.toString(), '<html>old</html>') },
  }
  return cloud
}

test('uploads and validates before switching; keeps old hashed assets and unchanged extensions', async (t) => {
  const old = await fixture(t)
  const next = await fixture(t, 'new', true)
  const cloud = fakeCloud(old)
  const result = await deployFrontend(next, cloud)
  assert.equal(result.status, 'verified')
  assert.ok(cloud.events.indexOf('backup') < cloud.events.indexOf('upload'))
  assert.ok(cloud.events.lastIndexOf('metadata') < cloud.events.indexOf('activate'))
  assert.ok(cloud.events.indexOf('current') < cloud.events.indexOf('activate'))
  assert.ok(cloud.events.indexOf('storage-access') < cloud.events.indexOf('activate'))
  const current = await cloud.specification()
  assert.deepEqual(current.paths['/assets/old-12345678.js'], cloud.before.paths['/assets/old-12345678.js'])
  const previous = { ...cloud.before, 'x-yc-apigateway': { rateLimit: { allRequests: { rps: 100 } } } }
  assert.deepEqual(retainAssets(gatewayPlan(next, [], target).specification, previous)['x-yc-apigateway'], previous['x-yc-apigateway'])
})

for (const stage of ['backup', 'upload', 'verifyMetadata', 'verifyStorageAccess', 'assertCurrentCommit']) {
  test(`${stage} failure never activates or rolls back`, async (t) => {
    const cloud = fakeCloud(await fixture(t))
    cloud[stage] = async () => { throw new Error('failure') }
    await assert.rejects(deployFrontend(await fixture(t, 'new', true), cloud), /failure/)
    assert.ok(!cloud.events.includes('activate'))
    assert.deepEqual(await cloud.specification(), cloud.before)
  })
}

test('smoke failure restores exact previous spec and verifies old HTML', async (t) => {
  const cloud = fakeCloud(await fixture(t))
  cloud.smoke = async () => { throw new Error('bad asset') }
  await assert.rejects(deployFrontend(await fixture(t, 'new'), cloud), /previous gateway restored and verified/)
  assert.equal(cloud.events.filter((e) => e === 'activate').length, 2)
  assert.deepEqual(await cloud.specification(), cloud.before)
  assert.ok(cloud.events.includes('rollback-verified'))
})

test('an update which committed but lost its response is rolled back after status/readback', async (t) => {
  const cloud = fakeCloud(await fixture(t))
  const activate = cloud.activate
  let calls = 0
  cloud.activate = async (spec) => { await activate(spec); if (++calls === 1) throw new Error('lost response') }
  await assert.rejects(deployFrontend(await fixture(t, 'new'), cloud), /restored and verified/)
  assert.deepEqual(await cloud.specification(), cloud.before)
})

test('does not overwrite a concurrent external update during rollback', async (t) => {
  const cloud = fakeCloud(await fixture(t))
  cloud.smoke = async () => {
    const other = await cloud.specification()
    other.info.version = 'external'
    await cloud.activate(other)
    throw new Error('external change')
  }
  await assert.rejects(deployFrontend(await fixture(t, 'new'), cloud), /automatic rollback refused/)
  assert.equal((await cloud.specification()).info.version, 'external')
})

test('an unsettled gateway operation is not blindly retried or rolled back', async (t) => {
  const cloud = fakeCloud(await fixture(t))
  cloud.activate = async () => { throw new Error('timeout') }
  let checks = 0
  cloud.assertReady = async () => { if (++checks > 2) throw new Error('UPDATING') }
  await assert.rejects(deployFrontend(await fixture(t, 'new'), cloud), /UPDATING/)
  assert.ok(!cloud.events.includes('rollback-verified'))
})

test('lost activation response with old spec still visible requires operator inspection', async (t) => {
  const cloud = fakeCloud(await fixture(t))
  cloud.activate = async () => { throw new Error('lost response before commit') }
  await assert.rejects(deployFrontend(await fixture(t, 'new'), cloud), /Activation outcome uncertain/)
  assert.ok(!cloud.events.includes('rollback-verified'))
})

test('conflicting immutable bytes and unexpected gateway targets fail before upload', async (t) => {
  const cloud = fakeCloud(await fixture(t))
  cloud.routeBytes = async () => Buffer.from('collision')
  await assert.rejects(deployFrontend(await fixture(t, 'new'), cloud), /Conflicting immutable/)
  assert.ok(!cloud.events.includes('upload'))
  const changed = structuredClone(cloud.before)
  changed.paths['/'].get['x-yc-apigateway-integration'].bucket = 'other-bucket'
  assert.throws(() => validateSpecification(changed), /outside/)
})

function responses(bundle, broken = '') {
  const plan = gatewayPlan(bundle, [], target)
  return async (url, options) => {
    const path = new URL(url).pathname
    const asset = path.startsWith(`/${target.bucket}/`) ? plan.objects.find((o) => path.endsWith(o.object)) : undefined
    if (asset) return new Response(Buffer.from(asset.content, 'base64'), { headers: { 'access-control-allow-origin': options.headers.Origin } })
    if (path === '/assets/fit-deploy-missing.css') return new Response('Not found', { status: 404 })
    const key = ['/', '/auth', '/today', '/auth/yandex/callback'].includes(path) ? 'index.html'
      : path === '/assets/fit-deploy-missing.js' ? 'asset-recovery.js' : path.slice(1)
    const file = plan.objects.find((o) => o.key === key)
    if (file.delivery === 'public-object-redirect') return new Response(null, { status: 307,
      headers: { location: `https://storage.yandexcloud.net/${target.bucket}/${file.object}` } })
    return new Response(broken === key ? 'broken' : Buffer.from(file.content, 'base64'), {
      headers: { 'content-type': file.contentType, 'cache-control': file.cacheControl },
    })
  }
}

test('smoke checks routes, all asset hashes, caches, WASM redirect/CORS and missing asset behavior', async (t) => {
  const bundle = await fixture(t, 'new', true)
  await smoke(bundle, target.frontendOrigin, responses(bundle))
  await assert.rejects(smoke(bundle, target.frontendOrigin, responses(bundle, 'assets/new-12345678.js')), /smoke failed/)
})

test('cloud adapter only updates spec and has no ACL mutation operation', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'fit-adapter-test-'))
  t.after(() => rm(directory, { force: true, recursive: true }))
  const calls = []
  const cloud = createCloud({ directory, run: async (...args) => { calls.push(args); return { stdout: '{}' } } })
  assert.equal(cloud.publishWasm, undefined)
  assert.equal(calls.length, 0)
  const spec = gatewayPlan(await fixture(t), [], target).specification
  await cloud.activate(spec)
  assert.deepEqual(calls[0][1], ['serverless', 'api-gateway', 'update', target.gateway, '--spec', join(directory, 'activate-gateway.json'), '--format', 'json'])
})

test('metadata guard uses actual yc snake_case fields and rejects stale cache metadata', async (t) => {
  const object = gatewayPlan(await fixture(t), [], target).objects[0]
  const metadata = { content_type: object.contentType, cache_control: object.cacheControl,
    content_encoding: object.upload.contentEncoding, content_length: String(object.upload.size) }
  const cloud = createCloud({ run: async () => ({ stdout: JSON.stringify(metadata) }) })
  await cloud.verifyMetadata(object)
  metadata.cache_control = 'public, max-age=3600'
  await assert.rejects(cloud.verifyMetadata(object), /metadata mismatch/)
})

test('storage access is read-only: public WASM for both origins, all other files and listing private', async (t) => {
  const plan = gatewayPlan(await fixture(t, 'new', true), [], target)
  const requests = []
  await verifyStorageAccess(plan, async (url, options) => {
    requests.push({ url, options })
    assert.equal(options.headers?.Authorization, undefined)
    assert.ok(options.method === undefined || options.method === 'HEAD')
    const wasm = plan.objects.find((object) => url.endsWith(object.object) && object.key.endsWith('.wasm'))
    return wasm ? new Response(Buffer.from(wasm.content, 'base64'), { headers: {
      'content-type': wasm.contentType, 'access-control-allow-origin': options.headers.Origin,
    } }) : new Response(null, { status: 403 })
  })
  assert.equal(requests.filter(({ options }) => options.method === 'HEAD').length, plan.objects.length - 1)
  assert.deepEqual(requests.filter(({ options }) => options.headers?.Origin).map(({ options }) => options.headers.Origin),
    [target.frontendOrigin, target.customOrigin])
  assert.ok(requests.some(({ url }) => url.endsWith('?list-type=2&max-keys=1')))
})

for (const failure of ['wasm-private', 'wasm-bytes', 'wasm-cors', 'wasm-mime', 'html-public', 'listing-public']) {
  test(`storage preflight rejects ${failure} before activation`, async (t) => {
    const bundle = await fixture(t, 'new', true)
    const cloud = fakeCloud(await fixture(t))
    cloud.verifyStorageAccess = (plan) => verifyStorageAccess(plan, async (url, options) => {
      const wasm = plan.objects.find((object) => url.endsWith(object.object) && object.key.endsWith('.wasm'))
      if (wasm) return new Response(failure === 'wasm-bytes' ? 'wrong' : Buffer.from(wasm.content, 'base64'), {
        status: failure === 'wasm-private' ? 403 : 200,
        headers: { 'content-type': failure === 'wasm-mime' ? 'text/plain' : wasm.contentType,
          'access-control-allow-origin': failure === 'wasm-cors' ? 'https://wrong.invalid' : options.headers.Origin },
      })
      const publicFile = failure === 'html-public' && url.endsWith('/index.html')
      const publicListing = failure === 'listing-public' && url.includes('?list-type=')
      return new Response(null, { status: publicFile || publicListing ? 200 : 403 })
    })
    await assert.rejects(deployFrontend(bundle, cloud), /activation refused/)
    assert.ok(!cloud.events.includes('activate'))
  })
}

test('gateway change during upload is detected before activation', async (t) => {
  const cloud = fakeCloud(await fixture(t))
  const read = cloud.specification
  let calls = 0
  cloud.specification = async () => {
    const spec = await read()
    if (++calls > 1) spec.info.version = 'concurrent'
    return spec
  }
  await assert.rejects(deployFrontend(await fixture(t, 'new'), cloud), /changed during upload/)
  assert.ok(!cloud.events.includes('activate'))
})

test('CORS failure and HTML fallback for missing CSS are rejected', async (t) => {
  const bundle = await fixture(t, 'new', true)
  const good = responses(bundle)
  await assert.rejects(smoke(bundle, target.frontendOrigin, async (url, options) => {
    const response = await good(url, options)
    if (url.startsWith('https://storage.yandexcloud.net/')) response.headers.delete('access-control-allow-origin')
    return response
  }), /CORS mismatch/)
  await assert.rejects(smoke(bundle, target.frontendOrigin, async (url, options) => {
    if (url.endsWith('fit-deploy-missing.css')) return new Response('<html>fallback</html>')
    return good(url, options)
  }), /must return 404/)
})

test('workflow is gated by successful exact-main CI, least privilege OIDC and serialized activation', async () => {
  const workflow = await readFile(new URL('../.github/workflows/deploy-yandex-frontend.yml', import.meta.url), 'utf8')
  const ci = await readFile(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8')
  assert.match(ci, /push:\n    branches: \[main\]/)
  assert.match(workflow, /workflows: \[CI\]/)
  assert.match(workflow, /YC_FRONTEND_AUTODEPLOY_ENABLED == 'true'/)
  assert.match(workflow, /\.path == "\.github\/workflows\/ci.yml"/)
  assert.match(workflow, /\.head_branch == "main"/)
  assert.match(workflow, /\.conclusion == "success"/)
  assert.match(workflow, /cancel-in-progress: false/)
  assert.match(workflow, /environment: fit-frontend-production/)
  assert.match(workflow, /vars.YC_FRONTEND_DEPLOY_SA_ID/)
  assert.match(workflow, /scripts\/yandex-github-oidc.sh/)
  assert.match(workflow, /if: always\(\)/)
  assert.doesNotMatch(workflow, /pull_request_target|secrets.YC_|service-account-key|supabase db|terraform apply/)
})
