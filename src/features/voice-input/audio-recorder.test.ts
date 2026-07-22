import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BrowserAudioRecorder, decodeAudioToPcm16, floatSamplesToPcm16 } from './audio-recorder'

const originalMediaDevices = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices')

class FakeMediaRecorder extends EventTarget {
  static supportedType = 'audio/webm;codecs=opus'
  static throwOnCreate = false
  static isTypeSupported(type: string) {
    return type === FakeMediaRecorder.supportedType
  }

  state: RecordingState = 'inactive'
  readonly mimeType: string

  constructor(_stream: MediaStream, options?: MediaRecorderOptions) {
    super()
    if (FakeMediaRecorder.throwOnCreate) throw new Error('constructor failed')
    this.mimeType = options?.mimeType ?? 'audio/unknown'
  }

  start() {
    this.state = 'recording'
  }

  stop() {
    this.state = 'inactive'
    this.dispatchEvent(new MessageEvent('dataavailable', { data: new Blob(['voice']) }))
    this.dispatchEvent(new Event('stop'))
  }
}

function installMicrophone(trackStop = vi.fn()) {
  const stream = { getTracks: () => [{ stop: trackStop }] } as unknown as MediaStream
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn().mockResolvedValue(stream) },
  })
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder)
  return { stream, trackStop }
}

beforeEach(() => {
  FakeMediaRecorder.supportedType = 'audio/webm;codecs=opus'
  FakeMediaRecorder.throwOnCreate = false
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  if (originalMediaDevices) Object.defineProperty(navigator, 'mediaDevices', originalMediaDevices)
  else Reflect.deleteProperty(navigator, 'mediaDevices')
})

describe('floatSamplesToPcm16', () => {
  it('clamps and converts float samples to little-endian signed PCM', () => {
    const result = floatSamplesToPcm16(new Float32Array([-2, -1, -0.5, 0, 0.5, 1, 2]))
    const view = new DataView(result)
    expect(Array.from({ length: 7 }, (_, index) => view.getInt16(index * 2, true)))
      .toEqual([-32768, -32768, -16384, 0, 16383, 32767, 32767])
  })
})

describe('BrowserAudioRecorder', () => {
  it('records a supported audio format and releases the microphone after stop', async () => {
    const { trackStop } = installMicrophone()
    const recorder = new BrowserAudioRecorder()

    await recorder.start()
    const result = await recorder.stop()

    expect(result.type).toBe('audio/webm;codecs=opus')
    expect(await result.text()).toBe('voice')
    expect(trackStop).toHaveBeenCalledOnce()
    await expect(recorder.stop()).rejects.toThrow('не запущена')
  })

  it('releases the microphone when recorder creation fails or recording is cancelled', async () => {
    const failed = installMicrophone()
    FakeMediaRecorder.throwOnCreate = true
    await expect(new BrowserAudioRecorder().start()).rejects.toThrow('constructor failed')
    expect(failed.trackStop).toHaveBeenCalledOnce()

    FakeMediaRecorder.throwOnCreate = false
    const active = installMicrophone()
    const recorder = new BrowserAudioRecorder()
    await recorder.start()
    recorder.cancel()
    expect(active.trackStop).toHaveBeenCalledOnce()
  })

  it('reports browsers without microphone recording support', async () => {
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined })
    await expect(new BrowserAudioRecorder().start()).rejects.toThrow('не поддерживает запись')
  })
})

describe('decodeAudioToPcm16', () => {
  it('decodes and resamples audio to mono 16 kHz PCM', async () => {
    const close = vi.fn().mockResolvedValue(undefined)
    const decodeAudioData = vi.fn().mockResolvedValue({ duration: 2 })
    const connect = vi.fn()
    const start = vi.fn()
    const source = { buffer: null, connect, start }
    const startRendering = vi.fn().mockResolvedValue({ getChannelData: () => new Float32Array([-1, 1]) })
    const offlineConstructor = vi.fn(function () {
      return { destination: {}, createBufferSource: () => source, startRendering }
    })
    vi.stubGlobal('AudioContext', vi.fn(function () { return { decodeAudioData, close } }))
    vi.stubGlobal('OfflineAudioContext', offlineConstructor)

    const result = await decodeAudioToPcm16(new Blob(['encoded']))

    expect(offlineConstructor).toHaveBeenCalledWith(1, 32_000, 16_000)
    expect(connect).toHaveBeenCalledOnce()
    expect(start).toHaveBeenCalledOnce()
    expect(Array.from(new Int16Array(result))).toEqual([-32768, 32767])
    expect(close).toHaveBeenCalledOnce()
  })

  it('turns decode failures into a user-facing error and closes the context', async () => {
    const close = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('AudioContext', vi.fn(function () {
      return { decodeAudioData: vi.fn().mockRejectedValue(new Error('codec')), close }
    }))
    vi.stubGlobal('OfflineAudioContext', vi.fn())

    await expect(decodeAudioToPcm16(new Blob(['broken']))).rejects.toThrow('Не удалось подготовить запись')
    expect(close).toHaveBeenCalledOnce()
  })
})
