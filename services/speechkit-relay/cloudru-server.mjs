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

export function buildCloudruSpeechRelay({ authenticate = authenticateCloudruSpeech,
  createStream = cloudruSpeechStream, folderId = process.env.YANDEX_CLOUD_FOLDER_ID } = {}) {
  const server = http.createServer((req, res) => {
    res.writeHead(req.url === '/health' ? 200 : 404, { 'content-type': 'application/json' })
      .end(JSON.stringify({ status: req.url === '/health' ? 'ok' : 'not_found' }))
  })
  const wss = new WebSocketServer({ server, path: '/stt', maxPayload: 65_536, perMessageDeflate: false })
  wss.on('connection', (socket, request) => {
    socket.on('error', () => socket.terminate())
    const origins = ['https://fit-training.ru', 'https://www.fit-training.ru', 'capacitor://localhost', 'https://localhost']
    if ((request.headers.origin && !origins.includes(request.headers.origin)) || wss.clients.size > 100) {
      socket.close(1008); return
    }
    let state = 'initial'
    let stream
    let pending = []
    let pendingBytes = 0
    let totalBytes = 0
    const send = value => { if (socket.readyState === 1) socket.send(JSON.stringify(value)) }
    const fail = () => { send({ type: 'error', message: 'Распознавание временно недоступно' }); socket.close(1011) }
    const authDeadline = setTimeout(() => socket.close(1008), 5_000)
    const sessionDeadline = setTimeout(() => socket.close(1000), 10 * 60_000)
    function handle(raw, binary) {
      if (state !== 'streaming') return
      if (binary) {
        totalBytes += raw.byteLength
        if (totalBytes > 20_000_000) { socket.close(1009); return }
        stream.write({ audio_content: raw })
      } else {
        let value
        try { value = JSON.parse(String(raw)) } catch { socket.close(1008); return }
        if (value.type !== 'stop') { socket.close(1008); return }
        state = 'stopping'
        stream.end()
      }
    }
    socket.on('message', async (raw, binary) => {
      if (state === 'authenticating') {
        pendingBytes += raw.byteLength
        if (pendingBytes > 262_144) { socket.close(1009); return }
        pending.push([raw, binary]); return
      }
      if (state !== 'initial') { handle(raw, binary); return }
      if (binary) { socket.close(1008); return }
      let value
      try { value = JSON.parse(String(raw)) } catch { socket.close(1008); return }
      if (value.type !== 'config') { socket.close(1008); return }
      state = 'authenticating'
      let authenticated = false
      try { authenticated = await authenticate(value.sessionToken) } catch { /* Fail closed without upstream calls. */ }
      if (!authenticated || socket.readyState !== 1) { socket.close(1008); return }
      clearTimeout(authDeadline)
      try { stream = createStream() } catch { fail(); return }
      stream.on('data', response => {
        for (const chunk of response.chunks ?? []) {
          const text = chunk.alternatives?.[0]?.text
          if (text) send({ type: chunk.final ? 'final' : 'partial', text, endOfUtterance: Boolean(chunk.end_of_utterance) })
        }
      })
      stream.on('error', fail)
      stream.on('end', () => send({ type: 'done' }))
      stream.write({ config: { specification: { language_code: 'ru-RU', model: 'general', audio_encoding: 'LINEAR16_PCM',
        sample_rate_hertz: 16000, audio_channel_count: 1, partial_results: true, single_utterance: false, raw_results: false }, folder_id: folderId } })
      state = 'streaming'
      for (const [message, isBinary] of pending) handle(message, isBinary)
      pending = []
    })
    socket.on('close', () => {
      clearTimeout(authDeadline); clearTimeout(sessionDeadline)
      pending = []
      if (stream) { stream.cancel(); stream.destroy() }
    })
  })
  return { server, wss }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.env.YANDEX_CLOUD_API_KEY || !process.env.YANDEX_CLOUD_FOLDER_ID) throw new Error('speech_credentials_missing')
  const port = Number(process.env.PORT ?? 18084)
  if (![18084, 18085].includes(port)) throw new Error('speech_port_rejected')
  const { server } = buildCloudruSpeechRelay()
  server.listen(port, '127.0.0.1', () => console.log('{"event":"cloudru_speech_listening"}'))
}
