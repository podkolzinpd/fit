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

  afterEach(() => vi.unstubAllGlobals())

  it('waits for the relay acknowledgement and keeps the final chunk before closing', async () => {
    const onFinal = vi.fn()
    const session = new SpeechKitStreamingSession()
    await session.start(vi.fn(), onFinal)
    const socket = FakeWebSocket.instances[0]!

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
})
