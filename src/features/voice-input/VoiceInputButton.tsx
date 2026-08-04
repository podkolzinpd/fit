import { useEffect, useRef, useState } from 'react'
import { MicIcon, StopIcon } from '../../shared/icons'
import { BrowserAudioRecorder, decodeAudioToPcm16, type AudioRecorder } from './audio-recorder'
import type { SpeechRecognizer } from './speech-recognizer'
import { WhisperCppRecognizer } from './whisper-cpp-recognizer'
import { SpeechKitStreamingSession } from './speechkit-streaming-recognizer'
import { trackGoal } from '../../shared/yandex-metrika'

type Phase = 'idle' | 'recording' | 'preparing' | 'loading' | 'transcribing'

interface VoiceInputButtonProps {
  onTranscript: (text: string) => void
  source: string
  recorderFactory?: () => AudioRecorder
  recognizerFactory?: () => SpeechRecognizer
  decodeAudio?: (blob: Blob) => Promise<ArrayBuffer>
  maxDurationMs?: number
  idleLabel?: string
  beta?: boolean
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
}: VoiceInputButtonProps) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [progress, setProgress] = useState(0)
  const [message, setMessage] = useState<string | null>(null)
  const recorderRef = useRef<AudioRecorder | null>(null)
  const recognizerRef = useRef<SpeechRecognizer | null>(null)
  const intervalRef = useRef<number | null>(null)
  const timeoutRef = useRef<number | null>(null)
  const stoppingRef = useRef(false)
  const mountedRef = useRef(true)
  const streamingRef = useRef<SpeechKitStreamingSession | null>(null)
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

  async function startRecording() {
    setMessage(null)
    setProgress(0)
    {
      const streaming = new SpeechKitStreamingSession()
      streamingTextRef.current = ''
      try {
        await streaming.start((text) => { if (mountedRef.current) setMessage(`Сейчас распознаю: ${text}`) }, (text) => { streamingTextRef.current += `${streamingTextRef.current ? ' ' : ''}${text}` })
        streamingRef.current = streaming
        setElapsedSeconds(0); setPhase('recording')
        intervalRef.current = window.setInterval(() => setElapsedSeconds((seconds) => seconds + 1), 1_000)
        timeoutRef.current = window.setTimeout(() => void finishStreaming(), maxDurationMs)
        return
      } catch { await streaming.stop() }
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
    try { await streaming.stop(); const text = streamingTextRef.current.trim(); if (!text) throw new Error('Речь не распознана. Попробуйте говорить ближе к микрофону.'); onTranscript(text); setMessage('Текст добавлен в заметку. Проверьте его перед сохранением.') }
    catch (error) { if (mountedRef.current) setMessage(error instanceof Error ? error.message : 'Не удалось распознать запись.') }
    finally { stoppingRef.current = false; if (mountedRef.current) setPhase('idle') }
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
      onTranscript(text)
      setMessage('Текст добавлен в заметку. Проверьте его перед сохранением.')
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
    {message && <small className={message.startsWith('Текст добавлен') ? 'success' : 'error'} role="status">{message}</small>}
  </div>
}

function voiceButtonLabel(phase: Phase, elapsedSeconds: number, progress: number, idleLabel: string) {
  if (phase === 'recording') return `Остановить · ${formatDuration(elapsedSeconds)}`
  if (phase === 'preparing') return 'Подготавливаю запись…'
  if (phase === 'loading') return 'Загружаю модель…'
  if (phase === 'transcribing') return `Распознаю… ${progress}%`
  return idleLabel
}

function formatDuration(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

function recordingErrorMessage(error: unknown) {
  if (error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'SecurityError')) {
    return 'Нет доступа к микрофону. Разрешите его в настройках браузера и попробуйте снова.'
  }
  return error instanceof Error ? error.message : 'Не удалось включить микрофон.'
}

function clearTimers(intervalRef: { current: number | null }, timeoutRef: { current: number | null }) {
  if (intervalRef.current !== null) window.clearInterval(intervalRef.current)
  if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current)
  intervalRef.current = null
  timeoutRef.current = null
}
