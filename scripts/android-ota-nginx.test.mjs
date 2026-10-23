import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, rm, chmod } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { createServer } from 'node:net'

const available = spawnSync('nginx', ['-v']).status === 0
test('real Nginx serves immutable OTA ZIP/manifest, HEAD, CORS and no-store while denying writes and unknown paths',
  { skip: !available && 'Nginx is required in the release build job', timeout: 15000 }, async t => {
    const root = await mkdtemp(join(tmpdir(), 'fit-ota-nginx-'))
    let started = false
    t.after(async () => {
      if (started) spawnSync('nginx', ['-c', join(root, 'nginx.conf'), '-s', 'quit'])
      await rm(root, { recursive: true, force: true })
    })
    await chmod(root, 0o755)
    const hash = 'a'.repeat(64)
    await mkdir(join(root, 'android/bundles'), { recursive: true })
    await mkdir(join(root, `android/alpha/${hash}`), { recursive: true })
    await writeFile(join(root, `android/bundles/${hash}.zip`), 'ZIP fixture')
    await writeFile(join(root, `android/alpha/${hash}/latest.json`), '{"fixture":true}')
    const server = createServer()
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    const port = server.address().port
    await new Promise(resolve => server.close(resolve))
    const location = (await readFile(new URL('../infra/cloudru/mobile-updates/location.conf', import.meta.url), 'utf8'))
      .replace('/var/lib/fit-mobile-updates/android/', `${root}/android/`)
    const config = join(root, 'nginx.conf')
    await writeFile(config, `pid ${root}/nginx.pid; error_log stderr crit; events {} http { access_log off;
      server { listen 127.0.0.1:${port}; ${location} location / { return 404; } } }`)
    const checked = spawnSync('nginx', ['-t', '-c', config], { encoding: 'utf8' })
    assert.equal(checked.status, 0, checked.stderr)
    const result = spawnSync('nginx', ['-c', config], { encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    started = true
    const base = `http://127.0.0.1:${port}/mobile-updates/android`
    const response = await fetch(`${base}/alpha/${hash}/latest.json`, { signal: AbortSignal.timeout(5000) })
    assert.equal(response.status, 200)
    assert.equal(await response.text(), '{"fixture":true}')
    assert.equal(response.headers.get('cache-control'), 'no-store')
    assert.equal(response.headers.get('access-control-allow-origin'), 'https://localhost')
    const archive = await fetch(`${base}/bundles/${hash}.zip`)
    assert.equal(await archive.text(), 'ZIP fixture')
    assert.equal((await fetch(`${base}/bundles/${hash}.zip`, { method: 'HEAD' })).status, 200)
    assert.equal((await fetch(`${base}/bundles/${hash}.zip`, { method: 'POST', body: 'write' })).status, 403)
    for (const path of ['not-a-release', 'bundles/', `alpha/${hash}/other.json`, 'bundles/not-a-hash.zip']) {
      assert.equal((await fetch(`${base}/${path}`)).status, 404, path)
    }
  })
