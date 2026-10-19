import http from 'node:http'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { WebSocketServer } from 'ws'
import grpc from '@grpc/grpc-js'
import protoLoader from '@grpc/proto-loader'

export function cloudruSpeechStream(environment = process.env) {
  if (!environment.YANDEX_CLOUD_API_KEY || !environment.YANDEX_CLOUD_FOLDER_ID) throw new Error('speech_credentials_missing')
  const definition = protoLoader.loadSync(fileURLToPath(new URL('./proto/stt_service.proto', import.meta.url)),
    { keepCase: true, longs: String, enums: String, defaults: true, oneofs: true })
  const stt = grpc.loadPackageDefinition(definition).yandex.cloud.ai.stt.v2
  const client = new stt.SttService('stt.api.cloud.yandex.net:443', grpc.credentials.createSsl())
  const metadata = new grpc.Metadata()
  metadata.set('authorization', `Api-Key ${environment.YANDEX_CLOUD_API_KEY}`)
  const stream = client.StreamingRecognize(metadata)
  stream.once('end', () => client.close())
  stream.once('error', () => client.close())
  return stream
}

export async function authenticateCloudruSpeech(token, request = fetch) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) return false
  try {
    const response = await request('http://127.0.0.1:18080/v1/profile', {
      headers: { 'x-fit-session': token }, signal: AbortSignal.timeout(3_000), redirect: 'error',
    })
    await response.body?.cancel()
    return response.status === 200
  } catch { return false }
}

function grpcCode(error) {
  return Number.isInteger(error?.code) && error.code >= 0 && error.code <= 16 ? error.code : 'unknown'
}

export function buildCloudruSpeechRelay({ authenticate = authenticateCloudruSpeech,
  createStream = cloudruSpeechStream, folderId = process.env.YANDEX_CLOUD_FOLDER_ID,
  log = event => console.log(JSON.stringify(event)), now = () => Date.now() } = {}) {
  const server = http.createServer((req, res) => {
    res.writeHead(req.url === '/health' ? 200 : 404, { 'content-type': 'application/json' })
      .end(JSON.stringify({ status: req.url === '/health' ? 'ok' : 'not_found' }))
  })
  const wss = new WebSocketServer({ server, path: '/stt', maxPayload: 65_536, perMessageDeflate: false })
  let nextSessionId = 0
  wss.on('connection', (socket, request) => {
    const sessionId = ++nextSessionId
    const startedAt = now()
    let stage = 'connected'
    let outcome = 'client_closed'
    let totalBytes = 0
    let partialResults = 0
    let finalResults = 0
    const emit = (status, details = {}) => log({ event: 'cloudru_speech_session', sessionId, status, ...details })
    const close = (code, nextOutcome) => {
      outcome = nextOutcome
      socket.close(code)
    }
    emit('connected')
    socket.on('error', () => { emit('socket_error'); outcome = 'socket_error'; socket.terminate() })
    const origins = ['https://fit-training.ru', 'https://www.fit-training.ru', 'capacitor://localhost', 'https://localhost']
    if ((request.headers.origin && !origins.includes(request.headers.origin)) || wss.clients.size > 100) {
      emit('rejected', { reason: request.headers.origin && !origins.includes(request.headers.origin) ? 'origin' : 'capacity' })
      close(1008, 'rejected'); return
    }
    let state = 'initial'
    let stream
    let pending = []
    let pendingBytes = 0
    const send = value => { if (socket.readyState === 1) socket.send(JSON.stringify(value)) }
    const fail = () => { send({ type: 'error', message: 'Распознавание временно недоступно' }); close(1011, 'upstream_error') }
    const authDeadline = setTimeout(() => close(1008, 'auth_timeout'), 5_000)
    const sessionDeadline = setTimeout(() => close(1000, 'session_timeout'), 10 * 60_000)
    function handle(raw, binary) {
      if (state !== 'streaming') return
      if (binary) {
        totalBytes += raw.byteLength
        if (totalBytes > 20_000_000) { close(1009, 'payload_limit'); return }
        stream.write({ audio_content: raw })
      } else {
        let value
        try { value = JSON.parse(String(raw)) } catch { close(1008, 'protocol_rejected'); return }
        if (value.type !== 'stop') { close(1008, 'protocol_rejected'); return }
        state = 'stopping'
        stage = 'stopping'
        outcome = 'client_stop'
        stream.end()
      }
    }
    socket.on('message', async (raw, binary) => {
      if (state === 'authenticating') {
        pendingBytes += raw.byteLength
        if (pendingBytes > 262_144) { close(1009, 'auth_buffer_limit'); return }
        pending.push([raw, binary]); return
      }
      if (state !== 'initial') { handle(raw, binary); return }
      if (binary) { close(1008, 'protocol_rejected'); return }
      let value
      try { value = JSON.parse(String(raw)) } catch { close(1008, 'protocol_rejected'); return }
      if (value.type !== 'config') { close(1008, 'protocol_rejected'); return }
      state = 'authenticating'
      stage = 'authenticating'
      let authenticated = false
      try { authenticated = await authenticate(value.sessionToken) } catch { /* Fail closed without upstream calls. */ }
      if (!authenticated || socket.readyState !== 1) {
        if (socket.readyState === 1) emit('rejected', { reason: 'auth' })
        close(1008, 'auth_rejected'); return
      }
      clearTimeout(authDeadline)
      try { stream = createStream() } catch { emit('upstream_error', { grpcCode: 'unknown' }); fail(); return }
      stream.on('data', response => {
        for (const chunk of response.chunks ?? []) {
          const text = chunk.alternatives?.[0]?.text
          if (text) {
            if (chunk.final) finalResults += 1
            else partialResults += 1
            send({ type: chunk.final ? 'final' : 'partial', text, endOfUtterance: Boolean(chunk.end_of_utterance) })
          }
        }
      })
      stream.on('error', error => { emit('upstream_error', { grpcCode: grpcCode(error) }); fail() })
      stream.on('end', () => {
        if (outcome === 'upstream_error') return
        emit('upstream_done'); send({ type: 'done' })
      })
      stream.write({ config: { specification: { language_code: 'ru-RU', model: 'general', audio_encoding: 'LINEAR16_PCM',
        sample_rate_hertz: 16000, audio_channel_count: 1, partial_results: true, single_utterance: false, raw_results: false }, folder_id: folderId } })
      state = 'streaming'
      stage = 'streaming'
      emit('streaming')
      for (const [message, isBinary] of pending) handle(message, isBinary)
      pending = []
    })
    socket.on('close', code => {
      clearTimeout(authDeadline); clearTimeout(sessionDeadline)
      pending = []
      if (stream) { stream.cancel(); stream.destroy() }
      emit('closed', { stage, outcome, closeCode: code, durationMs: Math.max(0, now() - startedAt), audioBytes: totalBytes, partialResults, finalResults })
    })
  })
  return { server, wss }
}

export function closeCloudruSpeechRelay({ server, wss, timeoutMs = 8_000 } = {}) {
  return new Promise(resolve => {
    let finished = false
    const finish = () => {
      if (finished) return
      finished = true
      clearTimeout(deadline)
      resolve()
    }
    const deadline = setTimeout(finish, timeoutMs)
    deadline.unref?.()
    for (const client of wss.clients) client.terminate()
    try { server.close(finish) } catch { finish() }
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.env.YANDEX_CLOUD_API_KEY || !process.env.YANDEX_CLOUD_FOLDER_ID) throw new Error('speech_credentials_missing')
  const port = Number(process.env.PORT ?? 18084)
  if (![18084, 18085].includes(port)) throw new Error('speech_port_rejected')
  const relay = buildCloudruSpeechRelay()
  let stopping = false
  const shutdown = () => {
    if (stopping) return
    stopping = true
    void closeCloudruSpeechRelay(relay).finally(() => process.exit(0))
  }
  process.once('SIGTERM', shutdown)
  process.once('SIGINT', shutdown)
  const { server } = relay
  server.listen(port, '127.0.0.1', () => console.log('{"event":"cloudru_speech_listening"}'))
}
