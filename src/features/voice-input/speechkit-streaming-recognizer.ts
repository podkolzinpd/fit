const DEFAULT_RELAY_URL = 'wss://93-77-184-41.sslip.io/stt'
const SOCKET_CONNECT_TIMEOUT_MS = 5_000

export interface StreamingSpeechSession {
  start(onPartial: (text: string) => void, onFinal: (text: string) => void): Promise<void>
  rotate(): Promise<void>
  stop(): Promise<void>
}

export class SpeechKitStreamingSession implements StreamingSpeechSession {
  private socket: WebSocket | null = null
  private context: AudioContext | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private processor: ScriptProcessorNode | null = null
  private stream: MediaStream | null = null
  private stopped = false
  private onPartial: ((text: string) => void) | null = null
  private onFinal: ((text: string) => void) | null = null

  async start(onPartial: (text: string) => void, onFinal: (text: string) => void): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia || typeof WebSocket === 'undefined') throw new Error('Потоковое распознавание недоступно в этом браузере.')
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
    if (this.stopped) {
      stream.getTracks().forEach((track) => track.stop())
      throw new Error('Запрос микрофона отменён.')
    }
    this.stream = stream
    const configuredUrl = (import.meta.env as unknown as { VITE_SPEECHKIT_RELAY_URL?: string }).VITE_SPEECHKIT_RELAY_URL
    const url = configuredUrl || DEFAULT_RELAY_URL
    this.onPartial = onPartial
    this.onFinal = onFinal
    this.context = new AudioContext()
    this.source = this.context.createMediaStreamSource(this.stream)
    this.processor = this.context.createScriptProcessor(4096, 1, 1)
    this.processor.onaudioprocess = (event) => {
      if (this.stopped || this.socket?.readyState !== WebSocket.OPEN) return
      this.socket.send(resampleToPcm16(event.inputBuffer.getChannelData(0), this.context!.sampleRate, 16000))
    }
    this.source.connect(this.processor)
    this.processor.connect(this.context.destination)
    await this.connectSocket(url)
  }

  private async connectSocket(url: string): Promise<void> {
    this.socket = new WebSocket(url)
    this.socket.binaryType = 'arraybuffer'
    await new Promise<void>((resolve, reject) => {
      const socket = this.socket!
      let settled = false
      let timeout: number | null = null
      const finish = (result: 'open' | 'error') => {
        if (settled) return
        settled = true
        if (timeout !== null) window.clearTimeout(timeout)
        if (result === 'open') {
          socket.send(JSON.stringify({ type: 'config' }))
          resolve()
          return
        }
        reject(new Error('Не удалось подключиться к потоковому распознаванию.'))
      }
      timeout = window.setTimeout(() => {
        finish('error')
        socket.close()
      }, SOCKET_CONNECT_TIMEOUT_MS)
      socket.onopen = () => finish('open')
      socket.onerror = () => finish('error')
      socket.onclose = () => finish('error')
    })
    this.socket.onmessage = (event) => {
      const message = JSON.parse(String(event.data)) as { type: string; text?: string; message?: string }
      if (message.type === 'partial' && message.text) this.onPartial?.(message.text)
      if (message.type === 'final' && message.text) this.onFinal?.(message.text)
      if (message.type === 'error') this.onPartial?.(message.message || 'Ошибка распознавания')
    }
  }

  async rotate(): Promise<void> {
    if (this.stopped || !this.socket) return
    const oldSocket = this.socket
    if (oldSocket.readyState === WebSocket.OPEN) oldSocket.send(JSON.stringify({ type: 'stop' }))
    await new Promise<void>((resolve) => window.setTimeout(resolve, 500))
    oldSocket.close()
    const configuredUrl = (import.meta.env as unknown as { VITE_SPEECHKIT_RELAY_URL?: string }).VITE_SPEECHKIT_RELAY_URL
    await this.connectSocket(configuredUrl || DEFAULT_RELAY_URL)
  }

  async stop(): Promise<void> {
    this.stopped = true
    this.processor?.disconnect(); this.source?.disconnect()
    this.stream?.getTracks().forEach((track) => track.stop())
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ type: 'stop' }))
      // SpeechKit may emit several final chunks around a pause. Give the
      // server time to flush all of them before closing the WebSocket.
      await new Promise<void>((resolve) => { window.setTimeout(resolve, 1_500) })
    }
    this.socket?.close(); await this.context?.close()
    this.processor = null; this.source = null; this.stream = null; this.socket = null; this.context = null
  }
}

function resampleToPcm16(input: Float32Array, sourceRate: number, targetRate: number): ArrayBuffer {
  const ratio = sourceRate / targetRate
  const length = Math.max(1, Math.round(input.length / ratio))
  const output = new ArrayBuffer(length * 2)
  const view = new DataView(output)
  for (let i = 0; i < length; i += 1) {
    const sample = Math.max(-1, Math.min(1, input[Math.min(input.length - 1, Math.floor(i * ratio))] ?? 0))
    view.setInt16(i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true)
  }
  return output
}
