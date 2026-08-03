import { beforeEach, describe, expect, it, vi } from 'vitest'

const whisper = vi.hoisted(() => ({ init: vi.fn() }))
vi.mock('@fugood/node-whisper-wasm', () => ({ initWhisper: whisper.init }))

import { WhisperCppRecognizer } from './whisper-cpp-recognizer'

function context(result = '  Тестовая   заметка ') {
  return {
    transcribeData: vi.fn().mockReturnValue({ promise: Promise.resolve({ result, segments: [], isAborted: false }) }),
    release: vi.fn().mockResolvedValue(undefined),
  }
}

describe('WhisperCppRecognizer', () => {
  beforeEach(() => whisper.init.mockReset())

  it('loads the pinned Russian model once and normalizes the transcript', async () => {
    const runtime = context()
    whisper.init.mockResolvedValue(runtime)
    const recognizer = new WhisperCppRecognizer()
    const progress = vi.fn()

    await recognizer.prepare()
    expect(await recognizer.transcribe(new ArrayBuffer(4), progress)).toBe('Тестовая заметка')
    expect(whisper.init).toHaveBeenCalledOnce()
    expect(whisper.init.mock.calls[0]?.[0]).toMatchObject({
      filePath: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-base-q5_1.bin',
      useGpu: false,
    })
    expect(runtime.transcribeData).toHaveBeenCalledWith(expect.any(ArrayBuffer), expect.objectContaining({ language: 'ru', onProgress: progress }))

    await recognizer.dispose()
    expect(runtime.release).toHaveBeenCalledOnce()
  })

  it('rejects empty audio without loading the model', async () => {
    const recognizer = new WhisperCppRecognizer()
    await expect(recognizer.transcribe(new ArrayBuffer(0))).rejects.toThrow('Запись получилась пустой')
    expect(whisper.init).not.toHaveBeenCalled()
  })

  it('turns loading and inference failures into user-facing errors', async () => {
    whisper.init.mockRejectedValueOnce(new Error('network'))
    const loadingFailure = new WhisperCppRecognizer()
    await expect(loadingFailure.prepare()).rejects.toThrow('Не удалось загрузить модель')

    const runtime = context()
    runtime.transcribeData.mockReturnValueOnce({ promise: Promise.reject(new Error('runtime')) })
    whisper.init.mockResolvedValueOnce(runtime)
    const inferenceFailure = new WhisperCppRecognizer()
    await expect(inferenceFailure.transcribe(new ArrayBuffer(4))).rejects.toThrow('Не удалось распознать запись')
  })
})
