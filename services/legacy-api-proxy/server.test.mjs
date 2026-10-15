import assert from 'node:assert/strict'
import { createServer, request } from 'node:http'
import { once } from 'node:events'
import test from 'node:test'
import { createLegacyApiProxy } from './server.mjs'

test('legacy API streams method/body/session and original CORS origin only to the canonical Cloud.ru API', async () => {
  let received
  const target = createServer((req, res) => {
    let body = ''
    req.on('data', chunk => { body += chunk })
    req.on('end', () => { received = { method: req.method, body, headers: req.headers }; res.end('synthetic-ok') })
  }).listen(0, '127.0.0.1')
  await once(target, 'listening')
  let connections = 0
  const server = createServer(createLegacyApiProxy({ connect: (options, callback) => {
    connections++
    assert.equal(options.hostname, 'api.fit-training.ru')
    assert.equal(options.servername, 'api.fit-training.ru')
    assert.equal(options.rejectUnauthorized, true)
    options.lookup('api.fit-training.ru', {}, (_error, address) => assert.equal(address, '87.242.117.210'))
    return request({ ...options, hostname: '127.0.0.1', port: target.address().port, lookup: undefined }, callback)
  } })).listen(0, '127.0.0.1')
  await once(server, 'listening')
  const base = `http://127.0.0.1:${server.address().port}`
  try {
    for (const method of ['POST', 'PATCH', 'DELETE']) {
      const response = await fetch(base + '/v1/synthetic', { method, redirect: 'error',
        headers: { origin: 'capacitor://localhost', 'x-fit-session': 'synthetic', cookie: 'must-not-forward' },
        body: '{"fixture":true}' })
      assert.equal(response.status, 200)
      assert.equal(await response.text(), 'synthetic-ok')
      assert.equal(response.headers.get('access-control-allow-origin'), 'capacitor://localhost')
      assert.equal(received.method, method)
      assert.equal(received.body, '{"fixture":true}')
      assert.equal(received.headers['x-fit-session'], 'synthetic')
      assert.equal(received.headers.origin, 'capacitor://localhost')
      assert.equal(received.headers.host, 'api.fit-training.ru')
      assert.equal(received.headers.cookie, undefined)
    }
    const before = connections
    const preflight = await fetch(base + '/v1/synthetic', { method: 'OPTIONS', headers: { origin: 'https://fit-training.ru' } })
    assert.equal(preflight.status, 204)
    const denied = await fetch(base + '/v1/synthetic', { headers: { origin: 'https://untrusted.invalid' } })
    assert.equal(denied.status, 403)
    assert.equal(connections, before)
  } finally { await Promise.all([server, target].map(value => new Promise(resolve => value.close(resolve)))) }
})
