import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SpeechKitStreamingSession } from './speechkit-streaming-recognizer'

class FakeWebSocket {
  static readonly OPEN = 1
  static instances: FakeWebSocket[] = []

  readyState = 0
  binaryType = ''
  sent: unknown[] = []
  onopen: (() => void) | null = null
  onerror: (() => void) | null = null
  onclose: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this)
    queueMicrotask(() => {
      this.readyState = FakeWebSocket.OPEN
      this.onopen?.()
    })
  }

  send(value: unknown) { this.sent.push(value) }
  close() { this.readyState = 3; this.onclose?.() }
  emit(value: object) { this.onmessage?.({ data: JSON.stringify(value) }) }
}

class FakeAudioContext {
  sampleRate = 48_000
  destination = {}
  createMediaStreamSource() { return { connect: vi.fn(), disconnect: vi.fn() } }
  createScriptProcessor() { return { connect: vi.fn(), disconnect: vi.fn(), onaudioprocess: null } }
  close() { return Promise.resolve() }
}

describe('SpeechKitStreamingSession final flush', () => {
  beforeEach(() => {
    FakeWebSocket.instances = []
    vi.stubGlobal('WebSocket', FakeWebSocket)
    vi.stubGlobal('AudioContext', FakeAudioContext)
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }] }) },
    })
  })

  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs() })

  // Missing/explicitly empty config previously selected the legacy default;
  // an explicit legacy URL must also be rejected by the production runtime.
  it.each([undefined, '', 'wss://89-169-132-80.sslip.io/stt'])('rejects production relay configuration %s before microphone or network access', async (url) => {
    vi.stubEnv('PROD', true)
    vi.stubEnv('VITE_SPEECHKIT_RELAY_URL', url)
    const microphoneRequest = vi.spyOn(navigator.mediaDevices, 'getUserMedia')
    await expect(new SpeechKitStreamingSession().start(vi.fn(), vi.fn())).rejects.toThrow('Потоковое распознавание недоступно')
    expect(microphoneRequest).not.toHaveBeenCalled()
    expect(FakeWebSocket.instances).toHaveLength(0)
  })

  it('waits for the relay acknowledgement and keeps the final chunk before closing', async () => {
    vi.stubEnv('PROD', true)
    vi.stubEnv('VITE_SPEECHKIT_RELAY_URL', 'wss://api.fit-training.ru/stt')
    const onFinal = vi.fn()
    const session = new SpeechKitStreamingSession()
    await session.start(vi.fn(), onFinal)
    const socket = FakeWebSocket.instances[0]!
    expect(socket.url).toBe('wss://api.fit-training.ru/stt')

    let stopped = false
    const stopping = session.stop().then(() => { stopped = true })
    await Promise.resolve()
    expect(socket.sent).toContain(JSON.stringify({ type: 'stop' }))
    expect(stopped).toBe(false)

    socket.emit({ type: 'final', text: 'жим лёжа 3 по 10', endOfUtterance: true })
    socket.emit({ type: 'done' })
    await stopping

    expect(onFinal).toHaveBeenCalledWith('жим лёжа 3 по 10', { endOfUtterance: true })
    expect(socket.readyState).toBe(3)
  })

  it('rotates the stream through the same validated production relay after acknowledgement', async () => {
    vi.stubEnv('PROD', true)
    vi.stubEnv('VITE_SPEECHKIT_RELAY_URL', 'wss://api.fit-training.ru/stt')
    const session = new SpeechKitStreamingSession()
    await session.start(vi.fn(), vi.fn())
    const first = FakeWebSocket.instances[0]!
    const rotating = session.rotate()
    expect(first.sent).toContain(JSON.stringify({ type: 'stop' }))
    expect(FakeWebSocket.instances).toHaveLength(1)
    first.emit({ type: 'done' })
    await rotating
    expect(first.readyState).toBe(3)
    expect(FakeWebSocket.instances).toHaveLength(2)
    const next = FakeWebSocket.instances[1]!
    expect(next.url).toBe(first.url)
    const stopping = session.stop()
    next.emit({ type: 'done' })
    await stopping
  })
})
