import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { packageRelease, supportedRouting } from './frontend-release.mjs'
import { gatewayPlan } from './frontend-gateway-plan.mjs'
import { target, retainAssets, createCloud } from './deploy-yandex-frontend.mjs'
import { releaseBatch, releaseManifest, reuseReleaseObjects, manifestKey } from './frontend-release-storage.mjs'
import { planCleanup, applyCleanup, cleanupCloud } from './cleanup-yandex-frontend.mjs'
import { uploadCandidate } from './upload-frontend-candidate.mjs'

async function fixture(t, revision) {
  const directory = await mkdtemp(join(tmpdir(), 'fit-retention-test-'))
  t.after(() => rm(directory, { force: true, recursive: true }))
  await mkdir(join(directory, 'assets'))
  const files = { 'index.html': `html${revision}`, 'sw.js': '//worker', 'site.webmanifest': '{}',
    'asset-recovery.js': '// recovery', 'assets/font-12345678.woff2': 'same font',
    [`assets/app-${revision.repeat(8)}.js`]: `app${revision}` }
  for (const [key, content] of Object.entries(files)) await writeFile(join(directory, key), content)
  return packageRelease(directory, revision.repeat(40), supportedRouting)
}

test('six workers drain in-flight operations on error; no unbounded launch', async () => {
  let active = 0
  let max = 0
  await releaseBatch(Array.from({ length: 30 }), async () => {
    active += 1; max = Math.max(max, active)
    await Promise.resolve()
    active -= 1
  })
  assert.equal(max, 6)
  let drained = false
  await assert.rejects(releaseBatch([1, 2, 3], async (item) => {
    if (item === 1) throw new Error('failure')
    await Promise.resolve(); drained = true
  }), /failure/)
  assert.equal(drained, true)
  await assert.rejects(releaseBatch([], () => {}, 100), /concurrency/)
})

test('different commits reuse unchanged files and upload only changed bytes; exact repeat has no PUT', async (t) => {
  const old = await fixture(t, 'a')
  const next = await fixture(t, 'b')
  const before = gatewayPlan(old, [], target)
  const stored = new Map(before.objects.map((o) => [o.object, Buffer.from(o.upload.content, 'base64')]))
  const plan = gatewayPlan(next, [], target)
  await reuseReleaseObjects(plan, before.specification, {
    routeBytes: async (route) => stored.get(route.get['x-yc-apigateway-integration'].object),
  }, target.bucket)
  assert.equal(plan.objects.filter((o) => o.reused).length, 4)
  let puts = 0
  const run = async (_cli, args) => {
    const key = args[args.indexOf('--key') + 1]
    if (args[2] === 'get-object') {
      if (!stored.has(key)) throw Object.assign(new Error('missing'), { stderr: 'NoSuchKey' })
      await writeFile(args.at(-1), stored.get(key))
    } else if (args[2] === 'put-object') {
      puts += 1
      stored.set(key, await readFile(args[args.indexOf('--body') + 1]))
    } else throw new Error('Unexpected operation')
    return { stdout: '{}' }
  }
  await uploadCandidate(next, run, plan)
  assert.equal(puts, 2)
  await uploadCandidate(next, run, plan)
  assert.equal(puts, 2)
  const shared = plan.objects.find((o) => o.key.endsWith('.woff2'))
  assert.ok(shared.object.startsWith(`releases/${old.release}/`))
  assert.equal(plan.specification.paths[`/${shared.key}`].get['x-yc-apigateway-integration'].object, shared.object)
})

async function history(t) {
  const plans = []
  for (const rev of ['a', 'b', 'c', 'd']) plans.push(gatewayPlan(await fixture(t, rev), [], target))
  const manifests = plans.map((p, index) => ({
    ...releaseManifest(p, plans[Math.max(0, index - 1)].release, new Date(index === 1 ? '2026-09-26' : '2026-01-01')),
    previousSpecification: plans[Math.max(0, index - 1)].specification,
  }))
  let specification = plans[0].specification
  for (const p of plans.slice(1)) specification = retainAssets(p.specification, specification)
  const inventory = manifests.flatMap((m) => [...m.objects, manifestKey(m.release)].map((key) => ({
    key, size: 10, lastModified: m.createdAt, etag: 'etag',
  })))
  return { specification, manifests, inventory, now: new Date('2026-09-27') }
}

test('retention protects active and previous regardless of age, plus the last 3 days; prunes obsolete routes first', async (t) => {
  const data = await history(t)
  const plan = planCleanup(data)
  assert.deepEqual(plan.keptReleases, data.manifests.slice(1).map((m) => m.release).sort())
  assert.ok(plan.objects.length > 0)
  assert.equal(plan.manifests.length, 1)
  assert.equal(plan.after.paths['/assets/app-aaaaaaaa.js'], undefined)
  assert.ok(plan.after.paths['/assets/app-bbbbbbbb.js'])
  assert.ok(plan.after.paths['/assets/app-cccccccc.js'])
  assert.ok(plan.after.paths['/assets/app-dddddddd.js'])
  const events = []
  let spec = plan.before
  const cloud = { assertReady: async () => {}, specification: async () => spec,
    backup: async () => { events.push('backup') }, activate: async (s) => { events.push('activate'); spec = s },
    verifyActive: async () => { events.push('smoke') }, assertObjectUnchanged: async () => {},
    remove: async (key) => { events.push(key) } }
  await applyCleanup(plan, cloud)
  assert.deepEqual(events.slice(0, 3), ['backup', 'activate', 'smoke'])
  assert.equal(events.at(-1), 'smoke')
  assert.ok(events.indexOf(plan.manifests[0].key) > events.indexOf(plan.objects.at(-1).key))
})

test('shared objects referenced by retained manifests survive, unknown legacy uploads survive', async (t) => {
  const data = await history(t)
  const old = data.manifests[0]
  const current = data.manifests[3]
  const key = old.objects.find((s) => s.endsWith('.woff2'))
  const own = current.objects.find((s) => s.endsWith('.woff2'))
  current.objects = current.objects.map((s) => s === own ? key : s)
  for (const spec of [data.specification, current.specification]) {
    for (const method of ['get', 'head']) spec.paths['/assets/font-12345678.woff2'][method]['x-yc-apigateway-integration'].object = key
  }
  const unknown = `releases/${'e'.repeat(40)}-${'f'.repeat(64)}/orphan.js`
  data.inventory.push({ key: unknown, size: 1, lastModified: '2025-01-01', etag: 'x' })
  data.inventory.push({ key: 'releases/frontend-release.json', size: 1, lastModified: '2025-01-01', etag: 'x' })
  const plan = planCleanup(data)
  assert.ok(!plan.objects.some((o) => o.key === key || o.key === unknown || o.key === 'releases/frontend-release.json'))
})

test('cleanup accepts cloud-expanded defaults but refuses real parameter drift before deletion', async (t) => {
  const data = await history(t)
  const expand = (spec) => {
    const copy = structuredClone(spec)
    for (const route of Object.values(copy.paths)) {
      for (const p of route.parameters ?? []) Object.assign(p, { style: 'simple', explode: false })
    }
    return copy
  }
  const plan = planCleanup({ ...data, specification: expand(data.specification) })
  assert.ok(plan.objects.length > 0)
  const changed = expand(data.specification)
  changed.paths['/{path+}'].parameters[0].explode = true
  assert.throws(() => planCleanup({ ...data, specification: changed }), /differs from manifest/)
  let current = data.specification
  const unexpandedPlan = planCleanup(data)
  let removed = 0
  await applyCleanup(unexpandedPlan, {
    assertReady: async () => {}, specification: async () => expand(current), backup: async () => {},
    activate: async (s) => { current = s }, verifyActive: async () => {},
    assertObjectUnchanged: async () => {}, remove: async () => { removed++ },
  })
  assert.equal(removed, plan.objects.length + plan.manifests.length)
  removed = 0
  await assert.rejects(applyCleanup(unexpandedPlan, {
    assertReady: async () => {}, specification: async () => changed,
    remove: async () => { removed++ },
  }), /Gateway changed/)
  assert.equal(removed, 0)
})

test('3-day cutoff retains an exact-boundary release and expires it only after the boundary', async (t) => {
  const data = await history(t)
  const recent = data.manifests[1]
  recent.createdAt = '2026-09-24T00:00:00.000Z'
  const exact = planCleanup(data)
  assert.ok(exact.keptReleases.includes(recent.release))
  assert.ok(!exact.manifests.some((item) => item.key === manifestKey(recent.release)))
  for (const item of data.inventory) {
    if (recent.objects.includes(item.key) || item.key === manifestKey(recent.release)) item.lastModified = recent.createdAt
  }
  const expired = planCleanup({ ...data, now: new Date('2026-09-27T00:00:00.001Z') })
  assert.ok(!expired.keptReleases.includes(recent.release))
  assert.ok(expired.manifests.some((item) => item.key === manifestKey(recent.release)))
  assert.ok(expired.keptReleases.includes(expired.active))
  assert.ok(expired.keptReleases.includes(expired.previous))
})

for (const failure of ['manifest-missing', 'invalid-path', 'missing-protected', 'future-manifest', 'gateway-drift', 'duplicate-inventory']) {
  test(`cleanup fails closed: ${failure}`, async (t) => {
    const data = await history(t)
    if (failure === 'manifest-missing') data.manifests.pop()
    if (failure === 'invalid-path') data.inventory[0].key = 'releases/../../elsewhere'
    if (failure === 'missing-protected') data.inventory.pop()
    if (failure === 'future-manifest') data.manifests[0].createdAt = '2099-01-01'
    if (failure === 'gateway-drift') data.specification.paths['/auth'] = data.specification.paths['/']
    if (failure === 'gateway-drift') data.specification.paths['/'].get.responses = {}
    if (failure === 'duplicate-inventory') data.inventory.push(data.inventory[0])
    assert.throws(() => planCleanup(data))
  })
}

test('gateway changes, failed prune or smoke cause zero deletions', async (t) => {
  const plan = planCleanup(await history(t))
  for (const failure of ['changed', 'activate', 'smoke', 'object']) {
    let spec = failure === 'changed' ? {} : plan.before
    let deleted = 0
    const cloud = { assertReady: async () => {}, specification: async () => spec, backup: async () => {},
      activate: async (s) => { if (failure === 'activate') throw new Error('failure'); spec = s },
      verifyActive: async () => { if (failure === 'smoke') throw new Error('failure') },
      assertObjectUnchanged: async () => { if (failure === 'object') throw new Error('failure') },
      remove: async () => { deleted++ } }
    await assert.rejects(applyCleanup(plan, cloud))
    assert.equal(deleted, 0)
  }
})

test('manifest persistence rejects permission failures and verifies new manifest readback', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'fit-manifest-test-'))
  t.after(() => rm(directory, { force: true, recursive: true }))
  let calls = 0
  const cloud = createCloud({ directory, run: async () => { calls++; throw { stderr: 'AccessDenied' } } })
  const data = await history(t)
  await assert.rejects(cloud.recordManifest(data.manifests[0]), /Yandex command failed/)
  assert.equal(calls, 1)
  let stored
  const adapter = createCloud({ directory, run: async (_cli, args) => {
    if (args[2] === 'get-object') {
      if (!stored) throw Object.assign(new Error('missing'), { stderr: 'NoSuchKey' })
      await writeFile(args.at(-1), stored)
    } else if (args[2] === 'put-object') stored = await readFile(args[args.indexOf('--body') + 1])
    else throw new Error('Unexpected operation')
    return { stdout: '{}' }
  } })
  await adapter.recordManifest(data.manifests[0])
  assert.deepEqual(JSON.parse(stored), data.manifests[0])
  await adapter.recordManifest({ ...data.manifests[0], createdAt: '2026-09-27' })
  assert.equal(JSON.parse(stored).createdAt, data.manifests[0].createdAt)
})

test('first manifest pins the full legacy rollback graph; newly modified old objects keep their manifest', async (t) => {
  const data = await history(t)
  data.manifests = data.manifests.slice(3)
  const plan = planCleanup(data)
  assert.equal(plan.objects.length, 0)
  const data2 = await history(t)
  const oldKey = data2.manifests[0].objects.find((key) => key.endsWith('index.html'))
  data2.inventory.find((item) => item.key === oldKey).lastModified = '2026-09-26'
  assert.equal(planCleanup(data2).manifests.length, 0)
})

test('daily cleanup is opt-in, defaults to a plan and shares the deploy lock/environment', async () => {
  const workflow = await readFile(new URL('../.github/workflows/cleanup-yandex-frontend.yml', import.meta.url), 'utf8')
  assert.match(workflow, /cron: '17 3 \* \* \*'/)
  assert.match(workflow, /default: plan/)
  assert.match(workflow, /group: yandex-frontend-production/)
  assert.match(workflow, /cancel-in-progress: false/)
  assert.match(workflow, /environment: fit-frontend-production/)
  assert.match(workflow, /YC_FRONTEND_CLEANUP_ENABLED/)
  assert.match(workflow, /test "\$CLEANUP_ENABLED" = true/)
  assert.match(workflow, /github.ref == 'refs\/heads\/main'/)
  assert.doesNotMatch(workflow, /pull_request_target|secrets.YC_|terraform apply|--recursive|--version-id/)
})

test('inventory follows pagination; delete adapter refuses keys outside release scope', async () => {
  let count = 0
  const cloud = cleanupCloud({ run: async (_cli, args) => {
    if (++count === 1) return { stdout: JSON.stringify({ contents: [], is_truncated: true, next_continuation_token: 'next' }) }
    assert.ok(args.includes('next'))
    return { stdout: JSON.stringify({ contents: [], is_truncated: false }) }
  } })
  assert.deepEqual(await cloud.inventory(), [])
  assert.equal(count, 2)
  await assert.rejects(cloud.remove('other-bucket/key'), /Unsafe/)
})

test('partial deletion can be replanned, without losing retained objects or deleting the manifest early', async (t) => {
  const data = await history(t)
  const plan = planCleanup(data)
  let spec = plan.before
  const removed = new Set()
  let calls = 0
  await assert.rejects(applyCleanup(plan, {
    assertReady: async () => {}, specification: async () => spec, backup: async () => {},
    activate: async (next) => { spec = next }, verifyActive: async () => {},
    assertObjectUnchanged: async () => {},
    remove: async (key) => { if (++calls === 2) throw new Error('delete failed'); removed.add(key) },
  }), /delete failed/)
  assert.ok(removed.size > 0)
  assert.ok(!removed.has(plan.manifests[0].key))
  const next = planCleanup({ ...data, specification: spec, inventory: data.inventory.filter((item) => !removed.has(item.key)) })
  assert.deepEqual(next.keptReleases, plan.keptReleases)
  assert.equal(next.manifests.length, 1)
  assert.ok(next.objects.every((item) => !removed.has(item.key)))
})

test('truncated or malformed inventory cannot be mistaken for a full bucket', async () => {
  for (const response of [{}, { contents: [], is_truncated: true }]) {
    const cloud = cleanupCloud({ run: async () => ({ stdout: JSON.stringify(response) }) })
    await assert.rejects(cloud.inventory(), /Unknown list response|Incomplete inventory/)
  }
})
