import assert from 'node:assert/strict'
import { EventEmitter, once } from 'node:events'
import test from 'node:test'
import WebSocket from 'ws'
import { authenticateCloudruSpeech, buildCloudruSpeechRelay, closeCloudruSpeechRelay } from './cloudru-server.mjs'

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
    assert.equal(url, 'http://127.0.0.1:18080/v1/legal/acceptance')
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

test('gracefully stops open WebSocket sessions without waiting for the systemd timeout', async () => {
  const { server, wss } = buildCloudruSpeechRelay()
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const socket = new WebSocket(`ws://127.0.0.1:${server.address().port}/stt`)
  await once(socket, 'open')
  const closed = once(socket, 'close')
  await closeCloudruSpeechRelay({ server, wss, timeoutMs: 100 })
  const [code] = await closed
  assert.equal(code, 1006)
  assert.equal(server.listening, false)
})

test('emits bounded request lifecycle diagnostics without audio, transcript or session data', async t => {
  const stream = new SyntheticStream()
  const events = []
  let time = 1_000
  let markStreaming
  let markClosed
  const streaming = new Promise(resolve => { markStreaming = resolve })
  const closedLogged = new Promise(resolve => { markClosed = resolve })
  const url = await relay(t, { authenticate: async () => true, createStream: () => stream,
    log: event => { events.push(event); if (event.status === 'streaming') markStreaming(); if (event.status === 'closed') markClosed() }, now: () => time })
  const socket = new WebSocket(url)
  t.after(() => socket.terminate())
  await once(socket, 'open')
  socket.send(JSON.stringify({ type: 'config', sessionToken: token }))
  await streaming
  socket.send(Buffer.alloc(64))
  stream.emit('data', { chunks: [{ final: false, alternatives: [{ text: 'секретная расшифровка' }] }] })
  socket.send(JSON.stringify({ type: 'stop' }))
  time = 1_025
  socket.close()
  await once(socket, 'close')
  await closedLogged

  assert.deepEqual(events.map(event => event.status), ['connected', 'streaming', 'upstream_done', 'closed'])
  const closed = events.at(-1)
  assert.deepEqual(closed, { event: 'cloudru_speech_session', sessionId: 1, status: 'closed', stage: 'stopping',
    outcome: 'client_stop', closeCode: 1005, durationMs: 25, audioBytes: 64, partialResults: 1, finalResults: 0 })
  assert.equal(JSON.stringify(events).includes('секретная расшифровка'), false)
  assert.equal(JSON.stringify(events).includes(token), false)
})
