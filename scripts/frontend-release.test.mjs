import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { packageRelease, planRelease, supportedRouting, verifyRelease } from './frontend-release.mjs'
import { frontendHandler } from './frontend-rehearsal-server.mjs'

const commit = 'a'.repeat(40)
async function release(t, version = 'one', asset = 'app-12345678.js') {
  const dir = await mkdtemp(join(tmpdir(), 'fit-release-test-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  await mkdir(join(dir, 'assets'))
  for (const [name, bytes] of Object.entries({
    'index.html': `<html>${version}</html>`, 'sw.js': `// sw ${version}`,
    'asset-recovery.js': '// recover', 'site.webmanifest': '{}',
    [`assets/${asset}`]: `// ${version}`, 'assets/theme-12345678.css': 'body {}',
  })) await writeFile(join(dir, name), bytes)
  return packageRelease(dir, commit, supportedRouting)
}
async function server(t, active, previous = []) {
  const instance = createServer(frontendHandler(active, previous))
  await new Promise((resolve) => instance.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise((resolve, reject) => {
    instance.closeAllConnections()
    instance.close((error) => error ? reject(error) : resolve())
  }))
  return `http://127.0.0.1:${instance.address().port}`
}

test('source Vercel contract is explicitly supported', async () => {
  const { routes } = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url)))
  assert.deepEqual(routes, supportedRouting)
})
test('release identity includes bytes, not just commit; upload plan cannot activate', async (t) => {
  const one = await release(t)
  const same = await release(t)
  const changed = await release(t, 'two')
  assert.equal(one.release, same.release)
  assert.notEqual(one.release, changed.release)
  const plan = planRelease(one)
  assert.equal(plan.deployable, false)
  assert.equal(plan.activation, 'not-implemented')
  assert.ok(plan.objects.every((file) => file.key.startsWith(`releases/${one.release}/`)
    && file.overwrite === false && !('content' in file)))
})
test('corrupt bytes, metadata, identity and routing are rejected before serving', async (t) => {
  const original = await release(t)
  for (const mutate of [
    (b) => { b.files[0].content = Buffer.from('changed').toString('base64') },
    (b) => { b.files[0].key = '../private' },
    (b) => { b.files.push(b.files[0]) },
    (b) => { b.files[0].contentType = 'text/plain\r\nX-Injected: yes' },
    (b) => { b.files[0].cacheControl = 'private' },
    (b) => { b.release = commit },
    (b) => { b.deployable = true },
    (b) => { b.routing = [] },
  ]) {
    const bundle = structuredClone(original)
    mutate(bundle)
    assert.throws(() => verifyRelease(bundle))
    assert.throws(() => frontendHandler(bundle))
  }
})
test('real HTTP deep links and callback query return HTML without redirect', async (t) => {
  const url = await server(t, await release(t))
  for (const path of ['/', '/trainer', '/client', '/auth/yandex/callback?code=synthetic&state=test', '/invite?source=test', '/join?code=synthetic']) {
    const response = await fetch(url + path, { redirect: 'manual' })
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('location'), null)
    assert.equal(response.headers.get('cache-control'), 'no-cache')
    assert.match(response.headers.get('content-type'), /text\/html/)
    assert.equal(await response.text(), '<html>one</html>')
  }
})
test('static files, HEAD and conditional requests preserve metadata', async (t) => {
  const url = await server(t, await release(t))
  const response = await fetch(url + '/assets/app-12345678.js?v=test')
  assert.equal(response.status, 200)
  assert.match(response.headers.get('content-type'), /javascript/)
  assert.match(response.headers.get('cache-control'), /immutable/)
  assert.equal(await response.text(), '// one')
  const head = await fetch(url + '/assets/app-12345678.js', { method: 'HEAD' })
  assert.equal(head.headers.get('content-length'), '6')
  assert.equal(await head.text(), '')
  const cached = await fetch(url + '/assets/app-12345678.js', {
    headers: { 'If-None-Match': response.headers.get('etag') },
  })
  assert.equal(cached.status, 304)
  assert.equal(await cached.text(), '')
  for (const path of ['/sw.js', '/site.webmanifest', '/asset-recovery.js']) {
    assert.equal((await fetch(url + path)).headers.get('cache-control'), 'no-cache')
  }
})
test('missing JS recovers without caching; other missing assets are 404', async (t) => {
  const url = await server(t, await release(t))
  const recovery = await fetch(url + '/assets/missing.js')
  assert.equal(recovery.status, 200)
  assert.equal(recovery.headers.get('cache-control'), 'no-store')
  assert.match(recovery.headers.get('content-type'), /javascript/)
  assert.equal(await recovery.text(), '// recover')
  for (const path of ['/assets/missing.css', '/assets/missing.png']) {
    const response = await fetch(url + path)
    assert.equal(response.status, 404)
    assert.equal(response.headers.get('cache-control'), 'no-store')
  }
})
test('invalid paths and write methods fail closed', async (t) => {
  const url = await server(t, await release(t))
  for (const path of ['/%ZZ', '/%00', '/.env', '/assets/%2e%2e%2fprivate', '/assets/%252e%252e', '//example.test']) {
    assert.equal((await fetch(url + path)).status, 400)
  }
  const response = await fetch(url + '/client', { method: 'POST' })
  assert.equal(response.status, 405)
  assert.equal(response.headers.get('allow'), 'GET, HEAD')
})
test('forward and rollback selection keep both asset generations but only active entrypoints', async (t) => {
  const old = await release(t, 'old', 'app-11111111.js')
  const next = await release(t, 'next', 'app-22222222.js')
  for (const [active, retained, version] of [[next, old, 'next'], [old, next, 'old']]) {
    const url = await server(t, active, [retained])
    assert.equal(await (await fetch(url + '/client')).text(), `<html>${version}</html>`)
    assert.equal(await (await fetch(url + '/sw.js')).text(), `// sw ${version}`)
    assert.equal(await (await fetch(url + '/assets/app-11111111.js')).text(), '// old')
    assert.equal(await (await fetch(url + '/assets/app-22222222.js')).text(), '// next')
  }
})
test('same immutable URL with different bytes prevents startup', async (t) => {
  const old = await release(t, 'old')
  const next = await release(t, 'next')
  assert.throws(() => frontendHandler(next, [old]), /Conflicting immutable asset/)
})
