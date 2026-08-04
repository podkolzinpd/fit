import http from 'node:http'
import { WebSocketServer } from 'ws'
import grpc from '@grpc/grpc-js'
import protoLoader from '@grpc/proto-loader'

const PORT = Number(process.env.PORT || 8080)
const packageDefinition = protoLoader.loadSync('./proto/stt_service.proto', { keepCase: true, longs: String, enums: String, defaults: true, oneofs: true })
const stt = grpc.loadPackageDefinition(packageDefinition).yandex.cloud.ai.stt.v2
const server = http.createServer((req, res) => { res.writeHead(200, {'content-type':'application/json'}); res.end(JSON.stringify({ok:true})) })
const wss = new WebSocketServer({ server, path: '/stt' })

async function getIamToken() {
  if (process.env.YANDEX_CLOUD_API_KEY) return { value: process.env.YANDEX_CLOUD_API_KEY, prefix: 'Api-Key' }
  const response = await fetch('http://169.254.169.254/computeMetadata/v1/instance/service-accounts/default/token', { headers: { 'Metadata-Flavor': 'Google' } })
  if (!response.ok) throw new Error(`Не удалось получить IAM-токен: ${response.status}`)
  const body = await response.json()
  return { value: body.access_token, prefix: 'Bearer' }
}

wss.on('connection', async (socket) => {
  const sessionId = Math.random().toString(36).slice(2, 10)
  let bytes = 0
  let partials = 0
  let finals = 0
  const pendingMessages = []
  let handleMessage = (raw, binary) => { pendingMessages.push([raw, binary]) }
  socket.on('message', (raw, binary) => handleMessage(raw, binary))
  console.log(JSON.stringify({ event: 'ws_open', sessionId }))
  let auth
  try { auth = await getIamToken() } catch (error) { socket.send(JSON.stringify({ type: 'error', message: error.message })); socket.close(1011); return }
  const client = new stt.SttService('stt.api.cloud.yandex.net:443', grpc.credentials.createSsl())
  const metadata = new grpc.Metadata()
  metadata.set('authorization', `${auth.prefix} ${auth.value}`)
  const stream = client.StreamingRecognize(metadata)
  stream.on('data', (response) => {
    const chunks = response.chunks || []
    for (const chunk of chunks) {
      const alternatives = chunk.alternatives || []
      const text = alternatives[0]?.text || ''
      if (text) {
        if (chunk.final) finals += 1
        else partials += 1
        socket.send(JSON.stringify({ type: chunk.final ? 'final' : 'partial', text }))
      }
    }
  })
  stream.on('error', (error) => { console.error(JSON.stringify({ event: 'speechkit_error', sessionId, message: error.message, bytes, partials, finals })); socket.send(JSON.stringify({ type:'error', message:error.message })) })
  handleMessage = (raw, binary) => {
    if (binary) { bytes += raw.byteLength; stream.write({ audio_content: raw }) }
    else {
      const message = JSON.parse(String(raw))
      if (message.type === 'config') stream.write({ config: { specification: { language_code: 'ru-RU', audio_encoding: 'LINEAR16_PCM', sample_rate_hertz: 16000, audio_channel_count: 1, partial_results: true }, folder_id: process.env.YANDEX_CLOUD_FOLDER_ID || '' } })
      if (message.type === 'stop') { console.log(JSON.stringify({ event: 'ws_stop', sessionId, bytes, partials, finals })); stream.end() }
    }
  }
  for (const [raw, binary] of pendingMessages) handleMessage(raw, binary)
  pendingMessages.length = 0
  socket.on('close', () => { console.log(JSON.stringify({ event: 'ws_close', sessionId, bytes, partials, finals })); stream.end() })
})
server.listen(PORT, () => console.log(`speechkit relay listening on ${PORT}`))
