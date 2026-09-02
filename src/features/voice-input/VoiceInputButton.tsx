import { useEffect, useRef, useState, type ReactNode } from 'react'
import { CloseIcon, MicIcon, StopIcon } from '../../shared/icons'
import { BrowserAudioRecorder, decodeAudioToPcm16, type AudioRecorder } from './audio-recorder'
import type { SpeechRecognizer } from './speech-recognizer'
import { WhisperCppRecognizer } from './whisper-cpp-recognizer'
import { SpeechKitStreamingSession, type StreamingSpeechSession } from './speechkit-streaming-recognizer'
import { trackGoal } from '../../shared/yandex-metrika'

export type VoiceInputPhase = 'idle' | 'requesting' | 'recording' | 'preparing' | 'loading' | 'transcribing'

interface VoiceInputButtonProps {
  onTranscript: (text: string) => void | (() => void) | Promise<void | (() => void)>
  /** Cumulative transcript snapshot while a streaming session is recording. */
  onInterimTranscript?: (text: string) => void
  source: string
  recorderFactory?: () => AudioRecorder
  recognizerFactory?: () => SpeechRecognizer
  decodeAudio?: (blob: Blob) => Promise<ArrayBuffer>
  maxDurationMs?: number
  idleLabel?: string
  beta?: boolean
  variant?: 'inline' | 'hero' | 'icon'
  onPhaseChange?: (phase: VoiceInputPhase) => void
  onStart?: () => void
  onCancel?: () => void
  streamingFactory?: () => StreamingSpeechSession
  startupTimeoutMs?: number
  disabled?: boolean
  showTranscriptStatus?: boolean
  /** Idle-only extra control rendered inside the hero card's label area (e.g. a text-entry alternative). */
  secondaryAction?: ReactNode
}

export function VoiceInputButton({
  onTranscript,
  onInterimTranscript,
  source,
  recorderFactory = () => new BrowserAudioRecorder(),
  recognizerFactory = () => new WhisperCppRecognizer(),
  decodeAudio = decodeAudioToPcm16,
  maxDurationMs = 270_000,
  idleLabel = 'Надиктовать заметку',
  beta = false,
  variant = 'inline',
  onPhaseChange,
  onStart,
  onCancel,
  streamingFactory = () => new SpeechKitStreamingSession(),
  startupTimeoutMs = 30_000,
  disabled = false,
  showTranscriptStatus = true,
  secondaryAction,
}: VoiceInputButtonProps) {
  const [phase, setPhase] = useState<VoiceInputPhase>('idle')
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [progress, setProgress] = useState(0)
  const [message, setMessage] = useState<string | null>(null)
  const [undo, setUndo] = useState<(() => void) | null>(null)
  const recorderRef = useRef<AudioRecorder | null>(null)
  const recognizerRef = useRef<SpeechRecognizer | null>(null)
  const intervalRef = useRef<number | null>(null)
  const timeoutRef = useRef<number | null>(null)
  const stoppingRef = useRef(false)
  const mountedRef = useRef(true)
  const streamingRef = useRef<StreamingSpeechSession | null>(null)
  const startingStreamingRef = useRef<StreamingSpeechSession | null>(null)
  const streamingTextRef = useRef('')
  const streamingInterimTextRef = useRef('')
  const sessionGenerationRef = useRef(0)
  const isCurrentSession = (sessionId: number) => mountedRef.current && sessionGenerationRef.current === sessionId

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      sessionGenerationRef.current += 1
      clearTimers(intervalRef, timeoutRef)
      recorderRef.current?.cancel()
      void startingStreamingRef.current?.stop()
      void streamingRef.current?.stop()
      if (recognizerRef.current) void recognizerRef.current.dispose()
    }
  }, [])

  useEffect(() => { onPhaseChange?.(phase) }, [onPhaseChange, phase])

  async function startRecording() {
    if (disabled) return
    const sessionId = ++sessionGenerationRef.current
    onStart?.()
    setMessage(null)
    setUndo(null)
    setProgress(0)
    setPhase('requesting')
    {
      const streaming = streamingFactory()
      startingStreamingRef.current = streaming
      streamingTextRef.current = ''
      streamingInterimTextRef.current = ''
      try {
        await withTimeout(
          streaming.start(
            (text) => {
              if (!isCurrentSession(sessionId)) return
              streamingInterimTextRef.current = text.trim()
              const cumulative = joinStreamingTranscript(streamingTextRef.current, streamingInterimTextRef.current)
              onInterimTranscript?.(cumulative)
              if (variant !== 'icon') setMessage(`Сейчас распознаю: ${text}`)
            },
            (text) => {
              if (!isCurrentSession(sessionId)) return
              streamingTextRef.current = joinStreamingTranscript(streamingTextRef.current, text)
              streamingInterimTextRef.current = ''
              onInterimTranscript?.(streamingTextRef.current)
            },
          ),
          startupTimeoutMs,
        )
        const stillStarting = startingStreamingRef.current === streaming
        if (stillStarting) startingStreamingRef.current = null
        if (!isCurrentSession(sessionId)) {
          if (stillStarting) await streaming.stop()
          return
        }
        streamingRef.current = streaming
        setElapsedSeconds(0); setPhase('recording')
        intervalRef.current = window.setInterval(() => setElapsedSeconds((seconds) => seconds + 1), 1_000)
        timeoutRef.current = window.setTimeout(() => void rotateStreaming(sessionId), maxDurationMs)
        return
      } catch (error) {
        if (startingStreamingRef.current === streaming) {
          startingStreamingRef.current = null
          await streaming.stop()
        }
        if (!isCurrentSession(sessionId)) return
        if (isMicrophoneStartFailure(error)) {
          if (mountedRef.current) {
            setMessage(recordingErrorMessage(error))
            setPhase('idle')
          }
          return
        }
      }
    }
    if (!isCurrentSession(sessionId)) return
    const recorderSessionId = ++sessionGenerationRef.current
    const recorder = recorderFactory()
    try {
      await recorder.start()
      if (!isCurrentSession(recorderSessionId)) {
        recorder.cancel()
        return
      }
      recorderRef.current = recorder
      setElapsedSeconds(0)
      setPhase('recording')
      intervalRef.current = window.setInterval(() => setElapsedSeconds((seconds) => seconds + 1), 1_000)
      timeoutRef.current = window.setTimeout(() => void finishRecording(recorderSessionId), maxDurationMs)
    } catch (error) {
      recorder.cancel()
      if (!isCurrentSession(recorderSessionId)) return
      setMessage(recordingErrorMessage(error))
      setPhase('idle')
    }
  }

  async function finishStreaming(sessionId = sessionGenerationRef.current) {
    if (!streamingRef.current || stoppingRef.current || !isCurrentSession(sessionId)) return
    stoppingRef.current = true; clearTimers(intervalRef, timeoutRef)
    const streaming = streamingRef.current; streamingRef.current = null
    const wasCurrent = isCurrentSession(sessionId)
    try {
      await streaming.stop()
      if (!wasCurrent || !isCurrentSession(sessionId)) return
      const text = joinStreamingTranscript(streamingTextRef.current, streamingInterimTextRef.current).trim()
      streamingInterimTextRef.current = ''
      sessionGenerationRef.current += 1
      if (!text) throw new Error('Речь не распознана. Попробуйте говорить ближе к микрофону.')
      setPhase('transcribing')
      const revert = await onTranscript(text)
      if (!mountedRef.current) return
      setUndo(() => revert ?? null)
      setMessage(variant === 'hero' || !showTranscriptStatus ? null : 'Текст добавлен в заметку. Проверьте его перед сохранением.')
    } catch (error) {
      if (mountedRef.current && wasCurrent) setMessage(error instanceof Error ? error.message : 'Не удалось распознать запись.')
    } finally {
      stoppingRef.current = false
      if (mountedRef.current && wasCurrent) setPhase('idle')
    }
  }

  async function rotateStreaming(sessionId = sessionGenerationRef.current) {
    const streaming = streamingRef.current
    if (!streaming || stoppingRef.current || !isCurrentSession(sessionId)) return
    try {
      await streaming.rotate()
      if (isCurrentSession(sessionId) && streamingRef.current === streaming) timeoutRef.current = window.setTimeout(() => void rotateStreaming(sessionId), maxDurationMs)
    } catch (error) {
      if (isCurrentSession(sessionId)) setMessage(error instanceof Error ? error.message : 'Не удалось продолжить распознавание.')
    }
  }

  async function finishRecording(sessionId = sessionGenerationRef.current) {
    if (stoppingRef.current || !recorderRef.current || !isCurrentSession(sessionId)) return
    stoppingRef.current = true
    clearTimers(intervalRef, timeoutRef)
    const recorder = recorderRef.current
    recorderRef.current = null
    const wasCurrent = isCurrentSession(sessionId)
    try {
      setPhase('preparing')
      const pcm = await decodeAudio(await recorder.stop())
      if (!isCurrentSession(sessionId)) return
      const recognizer = recognizerRef.current ?? recognizerFactory()
      recognizerRef.current = recognizer
      setPhase('loading')
      await recognizer.prepare()
      setPhase('transcribing')
      const text = await recognizer.transcribe(pcm, (value) => {
        if (mountedRef.current) setProgress(Math.max(0, Math.min(100, Math.round(value))))
      })
      if (!text) throw new Error('Речь не распознана. Попробуйте говорить ближе к микрофону.')
      if (!isCurrentSession(sessionId)) return
      sessionGenerationRef.current += 1
      const revert = await onTranscript(text)
      if (mountedRef.current) {
        setUndo(() => revert ?? null)
        setMessage(variant === 'hero' || !showTranscriptStatus ? null : 'Текст добавлен в заметку. Проверьте его перед сохранением.')
      }
    } catch (error) {
      if (!mountedRef.current || !wasCurrent) return
      setMessage(error instanceof Error ? error.message : 'Не удалось распознать запись.')
    } finally {
      stoppingRef.current = false
      if (mountedRef.current && wasCurrent) setPhase('idle')
    }
  }

  const recording = phase === 'recording'
  const busy = phase !== 'idle' && !recording
  const finishCurrentRecording = () => void (streamingRef.current ? finishStreaming() : finishRecording())
  const startVoiceInput = () => {
    trackGoal(`voice_note_start_click_${source}`)
    void startRecording()
  }
  function cancelRecording() {
    sessionGenerationRef.current += 1
    clearTimers(intervalRef, timeoutRef)
    recorderRef.current?.cancel()
    recorderRef.current = null
    const streaming = streamingRef.current
    streamingRef.current = null
    if (streaming) void streaming.stop()
    const startingStreaming = startingStreamingRef.current
    startingStreamingRef.current = null
    if (startingStreaming) void startingStreaming.stop()
    streamingTextRef.current = ''
    streamingInterimTextRef.current = ''
    stoppingRef.current = false
    setElapsedSeconds(0)
    setProgress(0)
    setMessage(null)
    setPhase('idle')
    onCancel?.()
  }

  if (variant === 'hero') return <section className={`voice-action voice-action-${phase}`} aria-live="polite">
    {!recording && <button
      type="button"
      className="voice-action-hitarea"
      aria-label={busy ? voiceHeroStatus(phase) : idleLabel}
      disabled={busy || disabled}
      onClick={startVoiceInput}
    />}
    <div className="voice-action-copy">
      <h2>{recording ? 'Слушаю…' : busy ? voiceHeroStatus(phase) : 'Что будем делать?'}</h2>
      {recording && <p className="voice-action-guidance">Назовите упражнения, подходы, повторения и вес</p>}
      {recording && message?.startsWith('Сейчас распознаю:') && <p className="voice-action-transcript">«{message.replace('Сейчас распознаю:', '').trim()}»</p>}
    </div>
    {recording ? <button
      type="button"
      className="voice-action-button"
      aria-label={`Завершить запись, ${formatDuration(elapsedSeconds)}`}
      aria-pressed="true"
      onClick={finishCurrentRecording}
    >
      <StopIcon />
      <span className="voice-action-ring" aria-hidden="true" />
    </button> : <span className="voice-action-button voice-action-button-visual" aria-hidden="true">
      <MicIcon />
      <span className="voice-action-ring" />
    </span>}
    {recording ? <div className="voice-action-recording-controls"><button type="button" className="primary wide" onClick={finishCurrentRecording}>Готово</button><button type="button" className="link" onClick={cancelRecording}>Отменить</button></div> : <div className="voice-action-label">{!busy && <strong>{idleLabel}</strong>}{busy && <span>Это займёт несколько секунд</span>}{!busy && secondaryAction}</div>}
    {message && !message.startsWith('Сейчас распознаю:') && <div className="voice-action-error" role="alert"><strong>{message}</strong></div>}
  </section>

  if (variant === 'icon') return <div className="voice-input voice-input-icon">
    <button
      type="button"
      className={`assistant-icon-button ${recording ? 'recording' : ''}`}
      aria-label={recording ? `Завершить голосовой ввод, ${formatDuration(elapsedSeconds)}` : phase === 'requesting' ? 'Отменить запрос к микрофону' : busy ? voiceHeroStatus(phase) : idleLabel}
      aria-pressed={recording}
      disabled={(busy && phase !== 'requesting') || disabled}
      onClick={() => { if (phase === 'requesting') { cancelRecording(); return }; if (recording) { void (streamingRef.current ? finishStreaming() : finishRecording()); return }; trackGoal(`voice_note_start_click_${source}`); void startRecording() }}
    >
      {recording || phase === 'requesting' ? <StopIcon /> : <MicIcon />}
    </button>
    {message && <VoiceInputStatus message={message} undo={undo} onUndo={() => { undo?.(); setUndo(null); setMessage(null) }} onDismiss={() => setMessage(null)} />}
  </div>

  return <div className="voice-input">
    <button
      type="button"
      className={`voice-input-button secondary ${recording ? 'recording' : ''}`}
      disabled={busy || disabled}
      onClick={() => { if (recording) { void (streamingRef.current ? finishStreaming() : finishRecording()); return }; trackGoal(`voice_note_start_click_${source}`); void startRecording() }}
    >
      {recording ? <StopIcon /> : <MicIcon />}
      {voiceButtonLabel(phase, elapsedSeconds, progress, idleLabel)}
      {beta && phase === 'idle' && <span className="voice-beta">beta</span>}
    </button>
    {phase === 'loading' && <small className="muted">При первом запуске загружается локальная модель (~31 МБ).</small>}
    {message && <VoiceInputStatus message={message} undo={undo} onUndo={() => { undo?.(); setUndo(null); setMessage(null) }} onDismiss={() => setMessage(null)} />}
  </div>
}

function VoiceInputStatus({ message, undo, onUndo, onDismiss }: { message: string; undo: (() => void) | null; onUndo: () => void; onDismiss: () => void }) {
  const successful = message.startsWith('Текст добавлен')
  return <div className="voice-input-status" role={successful ? 'status' : 'alert'}>
    <small className={successful ? 'success' : 'error'}>{message}</small>
    {undo && <button type="button" className="link" onClick={onUndo}>Отменить</button>}
    <button type="button" className="voice-status-dismiss" aria-label="Закрыть сообщение" onClick={onDismiss}><CloseIcon /></button>
  </div>
}

function voiceButtonLabel(phase: VoiceInputPhase, elapsedSeconds: number, progress: number, idleLabel: string) {
  if (phase === 'recording') return `Остановить · ${formatDuration(elapsedSeconds)}`
  if (phase === 'preparing') return 'Подготавливаю запись…'
  if (phase === 'loading') return 'Загружаю модель…'
  if (phase === 'transcribing') return `Распознаю… ${progress}%`
  return idleLabel
}

function voiceHeroStatus(phase: VoiceInputPhase) {
  if (phase === 'requesting') return 'Запрашиваю доступ…'
  if (phase === 'preparing') return 'Подготавливаю запись…'
  if (phase === 'loading') return 'Загружаю распознавание…'
  if (phase === 'transcribing') return 'Разбираю тренировку…'
  return 'Слушаю…'
}

function formatDuration(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

function recordingErrorMessage(error: unknown) {
  if (error instanceof VoiceStartupTimeoutError) {
    return 'Микрофон не ответил. Проверьте разрешение микрофона для Fit или браузера и попробуйте снова.'
  }
  if (error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'SecurityError')) {
    return 'Нет доступа к микрофону. Разрешите его в настройках Fit или браузера и попробуйте снова.'
  }
  return error instanceof Error ? error.message : 'Не удалось включить микрофон.'
}

function joinStreamingTranscript(committed: string, next: string): string {
  const normalized = next.trim()
  if (!normalized) return committed
  const existing = committed.trim()
  return existing ? `${existing} ${normalized}` : normalized
}

function isMicrophoneStartFailure(error: unknown) {
  return error instanceof VoiceStartupTimeoutError
    || (error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'SecurityError'))
}

class VoiceStartupTimeoutError extends Error {
  constructor() {
    super('Микрофон не ответил.')
    this.name = 'VoiceStartupTimeoutError'
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: number | null = null
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = window.setTimeout(() => reject(new VoiceStartupTimeoutError()), timeoutMs)
      }),
    ])
  } finally {
    if (timeout !== null) window.clearTimeout(timeout)
  }
}

function clearTimers(intervalRef: { current: number | null }, timeoutRef: { current: number | null }) {
  if (intervalRef.current !== null) window.clearInterval(intervalRef.current)
  if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current)
  intervalRef.current = null
  timeoutRef.current = null
}
