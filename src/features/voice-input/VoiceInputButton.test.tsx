import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { AudioRecorder } from './audio-recorder'
import type { SpeechRecognizer } from './speech-recognizer'
import type { StreamingSpeechSession } from './speechkit-streaming-recognizer'
import { VoiceInputButton } from './VoiceInputButton'

function recorder(overrides: Partial<AudioRecorder> = {}): AudioRecorder {
  return {
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(new Blob(['audio'])),
    cancel: vi.fn(),
    ...overrides,
  }
}

function recognizer(overrides: Partial<SpeechRecognizer> = {}): SpeechRecognizer {
  return {
    prepare: vi.fn().mockResolvedValue(undefined),
    transcribe: vi.fn().mockImplementation((_audio: ArrayBuffer, onProgress?: (progress: number) => void) => {
      onProgress?.(64)
      return Promise.resolve('Жим лёжа 40 килограмм')
    }),
    dispose: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

describe('VoiceInputButton', () => {
  it('records, transcribes and returns editable text', async () => {
    const user = userEvent.setup()
    const stop = vi.fn().mockResolvedValue(new Blob(['audio']))
    const prepare = vi.fn().mockResolvedValue(undefined)
    const transcribe = vi.fn().mockResolvedValue('Жим лёжа 40 килограмм')
    const audioRecorder = recorder({ stop })
    const speechRecognizer = recognizer({ prepare, transcribe })
    const onTranscript = vi.fn()
    render(<VoiceInputButton
      onTranscript={onTranscript}
      source="test"
      recorderFactory={() => audioRecorder}
      recognizerFactory={() => speechRecognizer}
      decodeAudio={vi.fn().mockResolvedValue(new ArrayBuffer(4))}
    />)

    await user.click(screen.getByRole('button', { name: 'Надиктовать заметку' }))
    expect(screen.getByRole('button', { name: /Остановить/ })).toBeVisible()
    await user.click(screen.getByRole('button', { name: /Остановить/ }))

    await waitFor(() => expect(onTranscript).toHaveBeenCalledWith('Жим лёжа 40 килограмм'))
    expect(screen.getByText(/Текст добавлен в заметку\. Проверьте его перед сохранением/)).toBeVisible()
    expect(stop).toHaveBeenCalledOnce()
    expect(prepare).toHaveBeenCalledOnce()
    expect(transcribe).toHaveBeenCalledOnce()
  })

  it('shows microphone permission and recognition errors with retry available', async () => {
    const user = userEvent.setup()
    const denied = recorder({ start: vi.fn().mockRejectedValue(new DOMException('denied', 'NotAllowedError')) })
    const { rerender } = render(<VoiceInputButton onTranscript={vi.fn()} source="test" recorderFactory={() => denied} />)
    await user.click(screen.getByRole('button', { name: 'Надиктовать заметку' }))
    expect(screen.getByText(/Нет доступа к микрофону/)).toBeVisible()
    expect(screen.getByRole('button', { name: 'Надиктовать заметку' })).toBeEnabled()

    const failedRecognizer = recognizer({ transcribe: vi.fn().mockRejectedValue(new Error('Речь не распознана.')) })
    rerender(<VoiceInputButton
      onTranscript={vi.fn()}
      source="test"
      recorderFactory={() => recorder()}
      recognizerFactory={() => failedRecognizer}
      decodeAudio={vi.fn().mockResolvedValue(new ArrayBuffer(4))}
    />)
    await user.click(screen.getByRole('button', { name: 'Надиктовать заметку' }))
    await user.click(screen.getByRole('button', { name: /Остановить/ }))
    expect(await screen.findByText('Речь не распознана.')).toBeVisible()
  })

  it('leaves a stalled microphone request and keeps retry available', async () => {
    const user = userEvent.setup()
    const stop = vi.fn().mockResolvedValue(undefined)
    const start = vi.fn(() => new Promise<void>(() => undefined))
    const fallbackStart = vi.fn().mockResolvedValue(undefined)
    const fallbackRecorder = recorder({ start: fallbackStart })
    render(<VoiceInputButton
      variant="hero"
      idleLabel="Надиктовать тренировку"
      onTranscript={vi.fn()}
      source="today"
      recorderFactory={() => fallbackRecorder}
      streamingFactory={() => ({ start, stop, rotate: vi.fn() } satisfies StreamingSpeechSession)}
      startupTimeoutMs={10}
    />)

    await user.click(screen.getByRole('button', { name: 'Надиктовать тренировку' }))

    expect(await screen.findByText(/Микрофон не ответил/)).toBeVisible()
    expect(screen.getByRole('button', { name: 'Надиктовать тренировку' })).toBeEnabled()
    expect(stop).toHaveBeenCalledOnce()
    expect(fallbackStart).not.toHaveBeenCalled()
  })

  it('presents the reusable hero flow and cancels without returning a transcript', async () => {
    const user = userEvent.setup()
    const cancel = vi.fn()
    const onTranscript = vi.fn()
    const onStart = vi.fn()
    render(<VoiceInputButton
      variant="hero"
      idleLabel="Надиктовать тренировку"
      onTranscript={onTranscript}
      onStart={onStart}
      source="today"
      recorderFactory={() => recorder({ cancel })}
    />)

    expect(screen.getByRole('heading', { name: 'Что будем делать?' })).toBeVisible()
    expect(screen.queryByText('Назовите упражнения, подходы, повторения и вес')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Надиктовать тренировку' }))
    expect(onStart).toHaveBeenCalledOnce()
    expect(await screen.findByText('Назовите упражнения, подходы, повторения и вес')).toBeVisible()
    expect(await screen.findByRole('button', { name: /Завершить запись/ })).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: 'Отменить' }))

    expect(screen.getByRole('button', { name: 'Надиктовать тренировку' })).toBeVisible()
    expect(cancel).toHaveBeenCalledOnce()
    expect(onTranscript).not.toHaveBeenCalled()
  })

  it('renders a compact icon control for chat composers', async () => {
    const user = userEvent.setup()
    const onTranscript = vi.fn()
    render(<VoiceInputButton
      variant="icon"
      idleLabel="Голосовой ввод"
      onTranscript={onTranscript}
      source="assistant"
      streamingFactory={() => ({
        start: vi.fn((_partial: (text: string) => void, onFinal: (text: string) => void) => { onFinal('Покажи сводку Антона'); return Promise.resolve() }),
        stop: vi.fn().mockResolvedValue(undefined),
        rotate: vi.fn(),
      })}
    />)

    await user.click(screen.getByRole('button', { name: 'Голосовой ввод' }))
    await user.click(screen.getByRole('button', { name: /Завершить голосовой ввод/ }))

    await waitFor(() => expect(onTranscript).toHaveBeenCalledWith('Покажи сводку Антона'))
    expect(screen.getByText(/Текст добавлен в заметку/)).toBeVisible()
  })

  it('can suppress the intermediate transcript status when a chat sends it immediately', async () => {
    const user = userEvent.setup()
    render(<VoiceInputButton
      variant="icon"
      idleLabel="Голосовой ввод"
      showTranscriptStatus={false}
      onTranscript={vi.fn()}
      source="assistant"
      streamingFactory={() => ({
        start: vi.fn((onPartial: (text: string) => void, onFinal: (text: string) => void) => { onPartial('Привет'); onFinal('Привет'); return Promise.resolve() }),
        stop: vi.fn().mockResolvedValue(undefined),
        rotate: vi.fn(),
      })}
    />)

    await user.click(screen.getByRole('button', { name: 'Голосовой ввод' }))
    expect(screen.queryByText(/Сейчас распознаю/)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Завершить голосовой ввод/ }))

    await waitFor(() => expect(screen.queryByText(/Текст добавлен в заметку/)).not.toBeInTheDocument())
  })
})
