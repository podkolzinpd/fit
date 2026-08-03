const DEFAULT_RELAY_URL = 'wss://93-77-184-41.sslip.io/stt'

export class SpeechKitStreamingSession {
  private socket: WebSocket | null = null
  private context: AudioContext | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private processor: ScriptProcessorNode | null = null
  private stream: MediaStream | null = null
  private stopped = false
  private finalResolver: (() => void) | null = null

  async start(onPartial: (text: string) => void, onFinal: (text: string) => void): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia || typeof WebSocket === 'undefined') throw new Error('Потоковое распознавание недоступно в этом браузере.')
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
    const configuredUrl = (import.meta.env as unknown as { VITE_SPEECHKIT_RELAY_URL?: string }).VITE_SPEECHKIT_RELAY_URL
    const url = configuredUrl || DEFAULT_RELAY_URL
    this.socket = new WebSocket(url)
    this.socket.binaryType = 'arraybuffer'
    await new Promise<void>((resolve, reject) => {
      const socket = this.socket!
      socket.onopen = () => { socket.send(JSON.stringify({ type: 'config' })); resolve() }
      socket.onerror = () => reject(new Error('Не удалось подключиться к потоковому распознаванию.'))
    })
    this.socket.onmessage = (event) => {
      const message = JSON.parse(String(event.data)) as { type: string; text?: string; message?: string }
      if (message.type === 'partial' && message.text) onPartial(message.text)
      if (message.type === 'final' && message.text) { onFinal(message.text); this.finalResolver?.(); this.finalResolver = null }
      if (message.type === 'error') onPartial(message.message || 'Ошибка распознавания')
    }
    this.context = new AudioContext()
    this.source = this.context.createMediaStreamSource(this.stream)
    this.processor = this.context.createScriptProcessor(4096, 1, 1)
    this.processor.onaudioprocess = (event) => {
      if (this.stopped || this.socket?.readyState !== WebSocket.OPEN) return
      this.socket.send(resampleToPcm16(event.inputBuffer.getChannelData(0), this.context!.sampleRate, 16000))
    }
    this.source.connect(this.processor)
    this.processor.connect(this.context.destination)
  }

  async stop(): Promise<void> {
    this.stopped = true
    this.processor?.disconnect(); this.source?.disconnect()
    this.stream?.getTracks().forEach((track) => track.stop())
    if (this.socket?.readyState === WebSocket.OPEN) {
      await new Promise<void>((resolve) => {
        const timer = window.setTimeout(resolve, 1_500)
        this.finalResolver = () => { window.clearTimeout(timer); resolve() }
      })
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
