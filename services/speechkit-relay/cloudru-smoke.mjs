import WebSocket from 'ws'
import { cloudruSpeechStream } from './cloudru-server.mjs'

async function upstream() {
  await new Promise((resolve, reject) => {
    const stream = cloudruSpeechStream()
    const timer = setTimeout(() => { stream.cancel(); reject(new Error('speech_timeout')) }, 12_000)
    stream.on('data', () => {})
    stream.once('error', () => { clearTimeout(timer); reject(new Error('speech_upstream_failed')) })
    stream.once('end', () => { clearTimeout(timer); resolve() })
    stream.write({ config: { specification: { language_code: 'ru-RU', model: 'general', audio_encoding: 'LINEAR16_PCM',
      sample_rate_hertz: 16000, audio_channel_count: 1, partial_results: true, single_utterance: false, raw_results: false }, folder_id: process.env.YANDEX_CLOUD_FOLDER_ID } })
    stream.write({ audio_content: Buffer.alloc(32_000) })
    stream.end()
  })
}

async function guard() {
  const port = Number(process.env.PORT ?? 18084)
  if (![18084, 18085].includes(port)) throw new Error('speech_port_rejected')
  await new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/stt`)
    const timer = setTimeout(() => { socket.terminate(); reject(new Error('speech_timeout')) }, 8000)
    socket.on('open', () => socket.send(JSON.stringify({ type: 'config' })))
    socket.on('error', () => { clearTimeout(timer); reject(new Error('speech_guard_failed')) })
    socket.on('close', code => { clearTimeout(timer); if (code === 1008) resolve(); else reject(new Error('speech_guard_failed')) })
  })
}

const mode = process.argv[2]
try {
  if (mode === 'upstream') await upstream()
  else if (mode === 'guard') await guard()
  else throw new Error('speech_mode_rejected')
  console.log(JSON.stringify({ event: 'cloudru_speech_smoke_passed', check: mode }))
} catch { console.error('cloudru_speech_smoke_failed'); process.exitCode = 1 }
