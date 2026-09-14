import type { WhisperContext } from '@fugood/node-whisper-wasm'
import { normalizeTranscript, type SpeechRecognizer } from './speech-recognizer'

const MODEL_REVISION = '5359861c739e955e79d9a303bcbc70fb988958b1'
const MODEL_URL = `https://huggingface.co/ggerganov/whisper.cpp/resolve/${MODEL_REVISION}/ggml-base-q5_1.bin`
const MAX_MODEL_BYTES = 128 * 1024 * 1024
const TRANSCRIPTION_PROMPT = 'Русская заметка о тренировке. Упражнения: присед, жим, тяга, планка, выпады, подтягивания. Единицы: килограмм, кг, повторений, раз, секунд, минут, километров.'

export class WhisperCppRecognizer implements SpeechRecognizer {
  private context: WhisperContext | null = null
  private contextPromise: Promise<WhisperContext> | null = null

  async prepare(): Promise<void> {
    await this.getContext()
  }

  async transcribe(audio: ArrayBuffer, onProgress?: (progress: number) => void): Promise<string> {
    if (audio.byteLength === 0) throw new Error('Запись получилась пустой. Попробуйте ещё раз.')
    const context = await this.getContext()
    try {
      const { promise } = context.transcribeData(audio, {
        language: 'ru',
        temperature: 0,
        temperatureInc: 0.2,
        beamSize: 5,
        bestOf: 5,
        prompt: TRANSCRIPTION_PROMPT,
        maxThreads: Math.min(navigator.hardwareConcurrency || 2, 4),
        onProgress,
      })
      const result = await promise
      if (result.isAborted) throw new Error('Распознавание было остановлено.')
      return normalizeTranscript(result.result)
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Распознавание')) throw error
      throw new Error('Не удалось распознать запись. Попробуйте произнести заметку ещё раз.', { cause: error })
    }
  }

  async dispose(): Promise<void> {
    const context = this.context ?? await this.contextPromise?.catch(() => null)
    this.context = null
    this.contextPromise = null
    if (context) await context.release()
  }

  private async getContext(): Promise<WhisperContext> {
    if (this.context) return this.context
    this.contextPromise ??= import('@fugood/node-whisper-wasm')
      .then(({ initWhisper }) => initWhisper({
        filePath: MODEL_URL,
        maxModelBytes: MAX_MODEL_BYTES,
        useGpu: false,
      }))
    try {
      this.context = await this.contextPromise
      return this.context
    } catch {
      this.contextPromise = null
      throw new Error('Не удалось загрузить модель распознавания. Проверьте интернет и попробуйте снова.')
    }
  }
}
