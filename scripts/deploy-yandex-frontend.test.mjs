import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { packageRelease, supportedRouting } from './frontend-release.mjs'
import { frontendHealthBody, frontendHealthPath, gatewayPlan } from './frontend-gateway-plan.mjs'
import { gatewaySpecificationsEqual } from './frontend-gateway-specification.mjs'
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

function fakeCloud(beforeBundle, expandDefaults = false) {
  const before = gatewayPlan(beforeBundle, [], target).specification
  let current = structuredClone(before)
  const events = []
  const cloud = {
    events, before,
    specification: async () => {
      const spec = structuredClone(current)
      if (expandDefaults) {
        for (const route of Object.values(spec.paths)) {
          for (const owner of [route, route.get, route.head]) {
            for (const parameter of owner?.parameters ?? []) {
              parameter.style ??= 'simple'
              parameter.explode ??= false
            }
          }
        }
      }
      return spec
    },
    assertReady: async () => { events.push('ready') },
    assertCurrentCommit: async () => { events.push('current') },
    routeBytes: async (route) => {
      const key = route.get['x-yc-apigateway-integration'].object.split('/').slice(2).join('/')
      return Buffer.from(beforeBundle.files.find((file) => file.key === key).content, 'base64')
    },
    backup: async () => { events.push('backup') },
    recordManifest: async () => { events.push('manifest') },
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

for (const stage of ['backup', 'recordManifest', 'upload', 'verifyMetadata', 'verifyStorageAccess', 'assertCurrentCommit']) {
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

test('cloud-expanded path defaults pass activation and rollback without weakening comparison', async (t) => {
  const old = await fixture(t)
  const next = await fixture(t, 'new')
  for (const failure of [false, true]) {
    const cloud = fakeCloud(old, true)
    const before = await cloud.specification()
    if (failure) cloud.smoke = () => smoke(next, target.frontendOrigin, responses(next, 'index.html'))
    if (failure) {
      await assert.rejects(deployFrontend(next, cloud), /previous gateway restored and verified; stage=smoke: Frontend smoke failed: \//)
      assert.deepEqual(await cloud.specification(), before)
      assert.equal(cloud.events.filter((e) => e === 'activate').length, 2)
    } else {
      assert.equal((await deployFrontend(next, cloud)).status, 'verified')
      assert.equal(cloud.events.filter((e) => e === 'activate').length, 1)
    }
  }
})

test('only inline path defaults compare equal; input objects remain untouched', async (t) => {
  const spec = gatewayPlan(await fixture(t), [], target).specification
  const original = structuredClone(spec)
  const expanded = structuredClone(spec)
  for (const route of Object.values(expanded.paths)) {
    for (const p of route.parameters ?? []) Object.assign(p, { style: 'simple', explode: false })
  }
  assert.ok(gatewaySpecificationsEqual(spec, expanded))
  assert.ok(gatewaySpecificationsEqual(expanded, spec))
  assert.deepEqual(spec, original)
  const operationLevel = structuredClone(spec)
  operationLevel.paths['/'].get.parameters = [{ in: 'path', name: 'test', schema: { type: 'string' } }]
  const expandedOperation = structuredClone(operationLevel)
  Object.assign(expandedOperation.paths['/'].get.parameters[0], { style: 'simple', explode: false })
  assert.ok(gatewaySpecificationsEqual(operationLevel, expandedOperation))
  for (const change of [
    (s) => { s.paths['/{path+}'].parameters[0].explode = true },
    (s) => { s.paths['/{path+}'].parameters[0].style = 'label' },
    (s) => { s.paths['/{path+}'].parameters[0].style = null },
    (s) => { s.paths['/{path+}'].parameters[0].schema.type = 'integer' },
    (s) => { s.paths['/'].get['x-yc-apigateway-integration'].object += '.changed' },
    (s) => { s.paths['/'].get['x-yc-apigateway-integration'].service_account_id = 'other' },
    (s) => { s.paths['/'].get.security = [] },
    (s) => { s.servers = [{ url: 'https://other.invalid' }] },
    (s) => { s.info.version = 'other' },
    (s) => { s['x-yc-apigateway'] = { cors: { origin: '*' } } },
  ]) {
    const changed = structuredClone(expanded)
    change(changed)
    assert.equal(gatewaySpecificationsEqual(spec, changed), false)
  }
  for (const parameter of [
    { $ref: '#/components/parameters/path' },
    { in: 'query', name: 'search', schema: { type: 'string' } },
  ]) {
    const a = structuredClone(spec)
    a.paths['/'].get.parameters = [parameter]
    const b = structuredClone(a)
    Object.assign(b.paths['/'].get.parameters[0], { style: 'simple', explode: false })
    assert.equal(gatewaySpecificationsEqual(a, b), false)
  }
})

test('normalized readback still refuses a same-version concurrent route change', async (t) => {
  const cloud = fakeCloud(await fixture(t), true)
  cloud.smoke = async () => {
    const other = await cloud.specification()
    other.paths['/'].get['x-yc-apigateway-integration'].object += '.other'
    await cloud.activate(other)
  }
  await assert.rejects(deployFrontend(await fixture(t, 'new'), cloud), /stage=activation-readback: Activated gateway differs from candidate; stage=rollback-inspection: Concurrent/)
  assert.equal(cloud.events.filter((e) => e === 'activate').length, 2)
  assert.ok(!cloud.events.includes('rollback-verified'))
})

test('original smoke diagnostic survives rollback failure without exposing raw external errors', async (t) => {
  const next = await fixture(t, 'new')
  const cloud = fakeCloud(await fixture(t), true)
  cloud.smoke = () => smoke(next, target.frontendOrigin, responses(next, 'index.html'))
  cloud.verifyRollback = async () => { throw new Error('secret-token private-response-body') }
  await assert.rejects(deployFrontend(next, cloud), (error) => {
    assert.match(error.message, /stage=smoke: Frontend smoke failed: \//)
    assert.match(error.message, /stage=rollback-smoke: External operation failed/)
    assert.doesNotMatch(error.message, /secret-token|private-response-body/)
    assert.equal(error.cause.errors.length, 2)
    return true
  })
})

test('an update which committed but lost its response is rolled back after status/readback', async (t) => {
  const cloud = fakeCloud(await fixture(t), true)
  const before = await cloud.specification()
  const activate = cloud.activate
  let calls = 0
  cloud.activate = async (spec) => { await activate(spec); if (++calls === 1) throw new Error('lost response') }
  await assert.rejects(deployFrontend(await fixture(t, 'new'), cloud), /restored and verified/)
  assert.deepEqual(await cloud.specification(), before)
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
  await assert.rejects(deployFrontend(await fixture(t, 'new'), cloud), (error) => {
    assert.match(error.message, /stage=activate:.*stage=rollback-readiness:/)
    assert.equal(error.cause.errors[1].message, 'UPDATING')
    return true
  })
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

test('health route is exact, static and cannot be changed into another integration', async (t) => {
  const spec = gatewayPlan(await fixture(t), [], target).specification
  assert.equal(spec.paths[frontendHealthPath].get['x-yc-apigateway-integration'].type, 'dummy')
  assert.equal(spec.paths[frontendHealthPath].get['x-yc-apigateway-integration'].content['*'], frontendHealthBody)
  assert.doesNotThrow(() => validateSpecification(spec))
  for (const change of [
    (route) => { route.get['x-yc-apigateway-integration'].http_code = 301 },
    (route) => { route.get['x-yc-apigateway-integration'].content['*'] = 'private-data' },
    (route) => { route.get['x-yc-apigateway-integration'].type = 'object_storage' },
    (route) => { route.head['x-yc-apigateway-integration'].http_code = 404 },
  ]) {
    const candidate = structuredClone(spec)
    change(candidate.paths[frontendHealthPath])
    assert.throws(() => validateSpecification(candidate), /Unexpected gateway health route/)
  }
})

function responses(bundle, broken = '') {
  const plan = gatewayPlan(bundle, [], target)
  return async (url, options) => {
    const path = new URL(url).pathname
    if (path === frontendHealthPath) return new Response(frontendHealthBody, {
      headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
    })
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
  const working = responses(bundle)
  const requestedPaths = []
  await smoke(bundle, target.frontendOrigin, async (url, options) => {
    requestedPaths.push(new URL(url).pathname)
    return working(url, options)
  })
  assert.equal(requestedPaths[0], frontendHealthPath)
  await assert.rejects(smoke(bundle, target.frontendOrigin, responses(bundle, 'assets/new-12345678.js')), /smoke failed/)
  await assert.rejects(smoke(bundle, target.frontendOrigin, (url, options) =>
    new URL(url).pathname === frontendHealthPath
      ? Promise.resolve(new Response('<title>Fit</title>', { headers: { 'content-type': 'text/html' } }))
      : working(url, options)), /health route mismatch/)
})

test('smoke retries a transient request failure without replaying completed routes', async (t) => {
  const bundle = await fixture(t, 'new', true)
  const working = responses(bundle)
  const calls = new Map()
  const sleeps = []
  await smoke(bundle, target.customOrigin, async (url, options) => {
    const path = new URL(url).pathname
    calls.set(path, (calls.get(path) ?? 0) + 1)
    if (path === '/auth' && calls.get(path) < 3) throw new Error('temporary gateway timeout')
    return working(url, options)
  }, gatewayPlan(bundle, [], target), async (ms) => { sleeps.push(ms) })
  assert.equal(calls.get('/'), 1)
  assert.equal(calls.get('/auth'), 3)
  assert.deepEqual(sleeps, [5000, 5000])
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
  assert.match(workflow, /fetch-depth: 2/)
  assert.match(workflow, /grep -q '\^services\/api\//)
  assert.match(workflow, /deploy-yandex-stage.yml\/runs\?head_sha=\$SOURCE_COMMIT&event=push/)
  assert.match(workflow, /select\(\.head_sha == \$sha and \.head_branch == "main"\)/)
  assert.match(workflow, /if \[ "\$result" = success \]/)
  assert.match(workflow, /API rollout did not succeed/)
  assert.match(workflow, /Matching API rollout timed out/)
  assert.ok(workflow.indexOf('Require matching API rollout') < workflow.indexOf('Build with reviewed public production configuration'))
  assert.match(workflow, /environment: fit-frontend-production/)
  assert.match(workflow, /vars.YC_FRONTEND_DEPLOY_SA_ID/)
  assert.match(workflow, /scripts\/yandex-github-oidc.sh/)
  assert.match(workflow, /if: always\(\)/)
  assert.doesNotMatch(workflow, /pull_request_target|secrets.YC_|service-account-key|supabase db|terraform apply/)
})

test('API rollout gate fails closed and permits only matching successful deployments', async () => {
  const workflow = await readFile(new URL('../.github/workflows/deploy-yandex-frontend.yml', import.meta.url), 'utf8')
  const step = workflow.split('name: Require matching API rollout')[1].split('      - uses:')[0]
  const script = step.split('        run: |\n')[1].replace(/^          /gm, '')
  const sha = 'a'.repeat(40)
  const base = { head_sha: sha, head_branch: 'main', run_number: 1, status: 'completed', conclusion: 'success' }
  for (const [label, changed, runs, expected] of [
    ['frontend only', 'src/main.tsx', [], 0],
    ['matching success', 'services/api/src/server.ts', [base], 0],
    ['failure', 'services/api/src/server.ts', [{ ...base, conclusion: 'failure' }], 1],
    ['cancelled', 'services/api/src/server.ts', [{ ...base, conclusion: 'cancelled' }], 1],
    ['pending', 'services/api/src/server.ts', [{ ...base, status: 'in_progress' }], 1],
    ['missing', 'services/api/src/server.ts', [], 1],
    ['wrong commit', 'services/api/src/server.ts', [{ ...base, head_sha: 'b'.repeat(40) }], 1],
  ]) {
    const result = spawnSync('bash', [], {
      encoding: 'utf8',
      input: `git() { printf '%s' "$FIXTURE_CHANGED"; }; gh() { printf '%s' "$FIXTURE_RUNS"; }; seq() { echo 1; }; sleep() { :; };\n${script}`,
      env: { ...process.env, SOURCE_COMMIT: sha, GITHUB_REPOSITORY: 'fixture/fit', FIXTURE_CHANGED: changed, FIXTURE_RUNS: JSON.stringify({ workflow_runs: runs }) },
    })
    assert.equal(result.status, expected, `${label}: ${result.stderr}`)
  }
})
