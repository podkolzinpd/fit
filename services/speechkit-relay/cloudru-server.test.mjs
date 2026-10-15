import assert from 'node:assert/strict'
import { EventEmitter, once } from 'node:events'
import test from 'node:test'
import WebSocket from 'ws'
import { authenticateCloudruSpeech, buildCloudruSpeechRelay } from './cloudru-server.mjs'

const token = 'a'.repeat(43)
class SyntheticStream extends EventEmitter {
  writes = []
  write(value) { this.writes.push(value) }
  end() { this.emit('end') }
  cancel() {}
  destroy() {}
}

async function relay(t, options) {
  const { server, wss } = buildCloudruSpeechRelay(options)
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => {
    for (const client of wss.clients) client.terminate()
    await new Promise(resolve => wss.close(resolve))
    await new Promise(resolve => server.close(resolve))
  })
  return `ws://127.0.0.1:${server.address().port}/stt`
}

test('validates the current app-session against only the local Cloud.ru API without reading profile data', async () => {
  let calls = 0
  assert.equal(await authenticateCloudruSpeech('invalid', async () => { calls++; return new Response() }), false)
  assert.equal(calls, 0)
  assert.equal(await authenticateCloudruSpeech(token, async (url, options) => {
    calls++
    assert.equal(url, 'http://127.0.0.1:18080/v1/profile')
    assert.equal(options.headers['x-fit-session'], token)
    assert.equal(options.redirect, 'error')
    return new Response('{}', { status: 200 })
  }), true)
  assert.equal(calls, 1)
  assert.equal(await authenticateCloudruSpeech(token, async () => new Response('{}', { status: 401 })), false)
})

test('never opens a billed SpeechKit stream for an unauthenticated socket', async t => {
  let streams = 0
  const url = await relay(t, { authenticate: async () => false, createStream: () => { streams++; return new SyntheticStream() } })
  const socket = new WebSocket(url)
  await once(socket, 'open')
  const closed = once(socket, 'close')
  socket.send(JSON.stringify({ type: 'config', sessionToken: token }))
  const [code] = await closed
  assert.equal(code, 1008)
  assert.equal(streams, 0)
})

test('preserves config, buffered PCM and stop ordering through authentication and acknowledges final flush', async t => {
  const stream = new SyntheticStream()
  let authorize
  const authorized = new Promise(resolve => { authorize = resolve })
  const url = await relay(t, { authenticate: () => authorized, createStream: () => stream, folderId: 'synthetic-folder' })
  const socket = new WebSocket(url)
  t.after(() => socket.terminate())
  await once(socket, 'open')
  const done = once(socket, 'message')
  socket.send(JSON.stringify({ type: 'config', sessionToken: token }))
  socket.send(Buffer.alloc(32))
  socket.send(JSON.stringify({ type: 'stop' }))
  authorize(true)
  const [raw] = await done
  assert.deepEqual(JSON.parse(String(raw)), { type: 'done' })
  assert.equal(stream.writes.length, 2)
  assert.equal(stream.writes[0].config.folder_id, 'synthetic-folder')
  assert.equal(stream.writes[0].config.specification.sample_rate_hertz, 16000)
  assert.deepEqual(stream.writes[1].audio_content, Buffer.alloc(32))
})

test('rejects foreign browser origins before authenticating or opening an upstream stream', async t => {
  let authenticated = false
  const url = await relay(t, { authenticate: async () => { authenticated = true; return true } })
  const socket = new WebSocket(url, { origin: 'https://untrusted.example' })
  const [code] = await once(socket, 'close')
  assert.equal(code, 1008)
  assert.equal(authenticated, false)
})

test('an oversized unauthenticated frame closes only its socket and leaves the relay healthy', async t => {
  let authenticated = false
  const url = await relay(t, { authenticate: async () => { authenticated = true; return true } })
  const socket = new WebSocket(url)
  await once(socket, 'open')
  const closed = once(socket, 'close')
  socket.send(Buffer.alloc(100_000))
  const [code] = await closed
  assert.equal(code, 1009)
  assert.equal(authenticated, false)
  const response = await fetch(url.replace('ws:', 'http:').replace('/stt', '/health'))
  assert.equal(response.status, 200)
})
