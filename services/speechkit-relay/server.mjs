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
      if (text) socket.send(JSON.stringify({ type: chunk.final ? 'final' : 'partial', text }))
    }
  })
  stream.on('error', (error) => socket.send(JSON.stringify({ type:'error', message:error.message })))
  socket.on('message', (raw, binary) => {
    if (binary) call.write({ audio_content: raw })
    else {
      const message = JSON.parse(String(raw))
      if (message.type === 'config') stream.write({ config: { specification: { language_code: 'ru-RU', audio_encoding: 'LINEAR16_PCM', sample_rate_hertz: 16000, audio_channel_count: 1, partial_results: true }, folder_id: process.env.YANDEX_CLOUD_FOLDER_ID || '' } })
    }
  })
  socket.on('close', () => stream.end())
})
server.listen(PORT, () => console.log(`speechkit relay listening on ${PORT}`))
