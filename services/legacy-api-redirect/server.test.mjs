import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import test from 'node:test'
import { legacyRedirect } from './server.mjs'

test('legacy API preserves method and path through reversible 307 without touching the body', async () => {
  const server = createServer(legacyRedirect).listen(0, '127.0.0.1')
  await once(server, 'listening')
  const base = `http://127.0.0.1:${server.address().port}`
  try {
    for (const method of ['GET', 'POST', 'PATCH', 'DELETE']) {
      const response = await fetch(base + '/v1/synthetic', { method, redirect: 'manual',
        headers: { origin: 'capacitor://localhost', 'x-fit-session': 'synthetic' },
        ...(method === 'GET' ? {} : { body: '{"fixture":true}' }) })
      assert.equal(response.status, 307)
      assert.equal(response.headers.get('location'), 'https://api.fit-training.ru/v1/synthetic')
      assert.equal(response.headers.get('cache-control'), 'no-store')
      assert.equal(response.headers.get('access-control-allow-origin'), 'capacitor://localhost')
      assert.equal(await response.text(), '')
    }
    const preflight = await fetch(base + '/v1/synthetic', { method: 'OPTIONS', headers: { origin: 'https://fit-training.ru' } })
    assert.equal(preflight.status, 204)
    assert.match(preflight.headers.get('access-control-allow-headers'), /x-fit-session/)
    const denied = await fetch(base + '/v1/synthetic', { headers: { origin: 'https://untrusted.invalid' }, redirect: 'manual' })
    assert.equal(denied.status, 403)
    assert.equal(denied.headers.get('location'), null)
    const escaped = await fetch(base + '//untrusted.invalid/path', { redirect: 'manual' })
    assert.equal(escaped.headers.get('location'), 'https://api.fit-training.ru//untrusted.invalid/path')
  } finally { await new Promise(resolve => server.close(resolve)) }
})
