const TARGET_SAMPLE_RATE = 16_000

export interface AudioRecorder {
  start(): Promise<void>
  stop(): Promise<Blob>
  cancel(): void
}

export class BrowserAudioRecorder implements AudioRecorder {
  private chunks: Blob[] = []
  private recorder: MediaRecorder | null = null
  private stream: MediaStream | null = null

  async start(): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      throw new Error('Этот браузер не поддерживает запись с микрофона.')
    }

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    })
    try {
      this.recorder = new MediaRecorder(this.stream, preferredRecorderOptions())
      this.recorder.addEventListener('dataavailable', (event) => {
        if (event.data.size > 0) this.chunks.push(event.data)
      })
      this.recorder.start()
    } catch (error) {
      this.releaseStream()
      throw error
    }
  }

  stop(): Promise<Blob> {
    const recorder = this.recorder
    if (!recorder || recorder.state === 'inactive') {
      return Promise.reject(new Error('Запись с микрофона не запущена.'))
    }

    return new Promise((resolve, reject) => {
      recorder.addEventListener('stop', () => {
        const blob = new Blob(this.chunks, { type: recorder.mimeType })
        this.reset()
        resolve(blob)
      }, { once: true })
      recorder.addEventListener('error', () => {
        this.reset()
        reject(new Error('Не удалось записать аудио.'))
      }, { once: true })
      recorder.stop()
    })
  }

  cancel(): void {
    if (this.recorder?.state !== 'inactive') this.recorder?.stop()
    this.reset()
  }

  private reset() {
    this.releaseStream()
    this.recorder = null
    this.chunks = []
  }

  private releaseStream() {
    this.stream?.getTracks().forEach((track) => track.stop())
    this.stream = null
  }
}

function preferredRecorderOptions(): MediaRecorderOptions | undefined {
  const supported = ['audio/webm;codecs=opus', 'audio/mp4'].find((type) => MediaRecorder.isTypeSupported(type))
  return supported ? { mimeType: supported } : undefined
}

export async function decodeAudioToPcm16(blob: Blob): Promise<ArrayBuffer> {
  if (typeof AudioContext === 'undefined' || typeof OfflineAudioContext === 'undefined') {
    throw new Error('Этот браузер не поддерживает обработку аудио.')
  }

  const context = new AudioContext()
  try {
    const decoded = await context.decodeAudioData(await blob.arrayBuffer())
    const frameCount = Math.max(1, Math.ceil(decoded.duration * TARGET_SAMPLE_RATE))
    const offline = new OfflineAudioContext(1, frameCount, TARGET_SAMPLE_RATE)
    const source = offline.createBufferSource()
    source.buffer = decoded
    source.connect(offline.destination)
    source.start()
    const rendered = await offline.startRendering()
    return floatSamplesToPcm16(rendered.getChannelData(0))
  } catch {
    throw new Error('Не удалось подготовить запись для распознавания.')
  } finally {
    await context.close()
  }
}

export function floatSamplesToPcm16(samples: Float32Array): ArrayBuffer {
  const output = new ArrayBuffer(samples.length * Int16Array.BYTES_PER_ELEMENT)
  const view = new DataView(output)
  samples.forEach((sample, index) => {
    const value = Math.max(-1, Math.min(1, sample))
    view.setInt16(index * Int16Array.BYTES_PER_ELEMENT, value < 0 ? value * 0x8000 : value * 0x7fff, true)
  })
  return output
}
