import { useEffect, useRef, useState } from 'react'
import { MicIcon, StopIcon } from '../../shared/icons'
import { BrowserAudioRecorder, decodeAudioToPcm16, type AudioRecorder } from './audio-recorder'
import type { SpeechRecognizer } from './speech-recognizer'
import { WhisperCppRecognizer } from './whisper-cpp-recognizer'
import { SpeechKitStreamingSession, type StreamingSpeechSession } from './speechkit-streaming-recognizer'
import { trackGoal } from '../../shared/yandex-metrika'

export type VoiceInputPhase = 'idle' | 'requesting' | 'recording' | 'preparing' | 'loading' | 'transcribing'

interface VoiceInputButtonProps {
  onTranscript: (text: string) => void | (() => void) | Promise<void | (() => void)>
  source: string
  recorderFactory?: () => AudioRecorder
  recognizerFactory?: () => SpeechRecognizer
  decodeAudio?: (blob: Blob) => Promise<ArrayBuffer>
  maxDurationMs?: number
  idleLabel?: string
  beta?: boolean
  variant?: 'inline' | 'hero'
  onPhaseChange?: (phase: VoiceInputPhase) => void
  onStart?: () => void
  streamingFactory?: () => StreamingSpeechSession
  startupTimeoutMs?: number
}

export function VoiceInputButton({
  onTranscript,
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
  streamingFactory = () => new SpeechKitStreamingSession(),
  startupTimeoutMs = 30_000,
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
  const streamingTextRef = useRef('')

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      clearTimers(intervalRef, timeoutRef)
      recorderRef.current?.cancel()
      void streamingRef.current?.stop()
      if (recognizerRef.current) void recognizerRef.current.dispose()
    }
  }, [])

  useEffect(() => { onPhaseChange?.(phase) }, [onPhaseChange, phase])

  async function startRecording() {
    onStart?.()
    setMessage(null)
    setUndo(null)
    setProgress(0)
    setPhase('requesting')
    {
      const streaming = streamingFactory()
      streamingTextRef.current = ''
      try {
        await withTimeout(
          streaming.start((text) => { if (mountedRef.current) setMessage(`Сейчас распознаю: ${text}`) }, (text) => { streamingTextRef.current += `${streamingTextRef.current ? ' ' : ''}${text}` }),
          startupTimeoutMs,
        )
        streamingRef.current = streaming
        setElapsedSeconds(0); setPhase('recording')
        intervalRef.current = window.setInterval(() => setElapsedSeconds((seconds) => seconds + 1), 1_000)
        timeoutRef.current = window.setTimeout(() => void rotateStreaming(), maxDurationMs)
        return
      } catch (error) {
        await streaming.stop()
        if (isMicrophoneStartFailure(error)) {
          if (mountedRef.current) {
            setMessage(recordingErrorMessage(error))
            setPhase('idle')
          }
          return
        }
      }
    }
    const recorder = recorderFactory()
    try {
      await recorder.start()
      if (!mountedRef.current) {
        recorder.cancel()
        return
      }
      recorderRef.current = recorder
      setElapsedSeconds(0)
      setPhase('recording')
      intervalRef.current = window.setInterval(() => setElapsedSeconds((seconds) => seconds + 1), 1_000)
      timeoutRef.current = window.setTimeout(() => void finishRecording(), maxDurationMs)
    } catch (error) {
      recorder.cancel()
      if (!mountedRef.current) return
      setMessage(recordingErrorMessage(error))
      setPhase('idle')
    }
  }

  async function finishStreaming() {
    if (!streamingRef.current || stoppingRef.current) return
    stoppingRef.current = true; clearTimers(intervalRef, timeoutRef)
    const streaming = streamingRef.current; streamingRef.current = null
    try { await streaming.stop(); const text = streamingTextRef.current.trim(); if (!text) throw new Error('Речь не распознана. Попробуйте говорить ближе к микрофону.'); setPhase('transcribing'); const revert = await onTranscript(text); setUndo(() => revert ?? null); setMessage(variant === 'hero' ? null : 'Текст добавлен в заметку. Проверьте его перед сохранением.') }
    catch (error) { if (mountedRef.current) setMessage(error instanceof Error ? error.message : 'Не удалось распознать запись.') }
    finally { stoppingRef.current = false; if (mountedRef.current) setPhase('idle') }
  }

  async function rotateStreaming() {
    const streaming = streamingRef.current
    if (!streaming || stoppingRef.current) return
    try {
      await streaming.rotate()
      timeoutRef.current = window.setTimeout(() => void rotateStreaming(), maxDurationMs)
    } catch (error) {
      if (mountedRef.current) setMessage(error instanceof Error ? error.message : 'Не удалось продолжить распознавание.')
    }
  }

  async function finishRecording() {
    if (stoppingRef.current || !recorderRef.current) return
    stoppingRef.current = true
    clearTimers(intervalRef, timeoutRef)
    const recorder = recorderRef.current
    recorderRef.current = null
    try {
      setPhase('preparing')
      const pcm = await decodeAudio(await recorder.stop())
      const recognizer = recognizerRef.current ?? recognizerFactory()
      recognizerRef.current = recognizer
      setPhase('loading')
      await recognizer.prepare()
      setPhase('transcribing')
      const text = await recognizer.transcribe(pcm, (value) => {
        if (mountedRef.current) setProgress(Math.max(0, Math.min(100, Math.round(value))))
      })
      if (!text) throw new Error('Речь не распознана. Попробуйте говорить ближе к микрофону.')
      if (!mountedRef.current) return
      const revert = await onTranscript(text)
      setUndo(() => revert ?? null)
      setMessage(variant === 'hero' ? null : 'Текст добавлен в заметку. Проверьте его перед сохранением.')
    } catch (error) {
      if (!mountedRef.current) return
      setMessage(error instanceof Error ? error.message : 'Не удалось распознать запись.')
    } finally {
      stoppingRef.current = false
      if (mountedRef.current) setPhase('idle')
    }
  }

  const recording = phase === 'recording'
  const busy = phase !== 'idle' && !recording
  function cancelRecording() {
    clearTimers(intervalRef, timeoutRef)
    recorderRef.current?.cancel()
    recorderRef.current = null
    const streaming = streamingRef.current
    streamingRef.current = null
    if (streaming) void streaming.stop()
    streamingTextRef.current = ''
    stoppingRef.current = false
    setElapsedSeconds(0)
    setProgress(0)
    setMessage(null)
    setPhase('idle')
  }

  if (variant === 'hero') return <section className={`voice-action voice-action-${phase}`} aria-live="polite">
    <div className="voice-action-copy">
      <h2>{recording ? 'Слушаю…' : busy ? voiceHeroStatus(phase) : 'Что будем делать?'}</h2>
      {recording && <p className="voice-action-guidance">Назовите упражнения, подходы, повторения и вес</p>}
      {recording && message?.startsWith('Сейчас распознаю:') && <p className="voice-action-transcript">«{message.replace('Сейчас распознаю:', '').trim()}»</p>}
    </div>
    <button
      type="button"
      className="voice-action-button"
      aria-label={recording ? `Завершить запись, ${formatDuration(elapsedSeconds)}` : busy ? voiceHeroStatus(phase) : idleLabel}
      aria-pressed={recording}
      disabled={busy}
      onClick={() => { if (recording) { void (streamingRef.current ? finishStreaming() : finishRecording()); return }; trackGoal(`voice_note_start_click_${source}`); void startRecording() }}
    >
      {recording ? <StopIcon /> : <MicIcon />}
      <span className="voice-action-ring" aria-hidden="true" />
    </button>
    {recording ? <div className="voice-action-recording-controls"><button type="button" className="wide" onClick={() => void (streamingRef.current ? finishStreaming() : finishRecording())}>Готово</button><button type="button" className="link" onClick={cancelRecording}>Отменить</button></div> : <div className="voice-action-label">{!busy && <strong>{idleLabel}</strong>}{busy && <span>Это займёт несколько секунд</span>}</div>}
    {message && !message.startsWith('Сейчас распознаю:') && <div className="voice-action-error" role="alert"><strong>{message}</strong></div>}
  </section>

  return <div className="voice-input">
    <button
      type="button"
      className={`voice-input-button secondary ${recording ? 'recording' : ''}`}
      disabled={busy}
      onClick={() => { if (recording) { void (streamingRef.current ? finishStreaming() : finishRecording()); return }; trackGoal(`voice_note_start_click_${source}`); void startRecording() }}
    >
      {recording ? <StopIcon /> : <MicIcon />}
      {voiceButtonLabel(phase, elapsedSeconds, progress, idleLabel)}
      {beta && phase === 'idle' && <span className="voice-beta">beta</span>}
    </button>
    {phase === 'loading' && <small className="muted">При первом запуске загружается локальная модель (~31 МБ).</small>}
    {message && <div className="voice-input-status" role="status"><small className={message.startsWith('Текст добавлен') ? 'success' : 'error'}>{message}</small>{undo && <button type="button" className="link" onClick={() => { undo(); setUndo(null); setMessage(null) }}>Отменить</button>}</div>}
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
