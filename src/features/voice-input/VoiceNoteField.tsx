import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { VoiceInputButton, type VoiceInputPhase } from './VoiceInputButton'

interface VoiceNoteFieldProps {
  name: string
  disabled?: boolean
  onBusyChange?: (busy: boolean) => void
  // Экран/форма, где стоит поле — см. VoiceInputButtonProps.source.
  source: string
  defaultValue?: string
  value?: string
  onValueChange?: (value: string) => void
  onManualValueChange?: (value: string) => void
  onTranscriptValueChange?: (value: string) => void
  /** Return the formatted value so undo still owns that automatic replacement. */
  onTranscriptAppended?: (event: { previousValue: string; value: string; transcript: string }) => string | void | Promise<string | void>
  label?: string
  voiceLabel?: string
  voiceBeta?: boolean
  placeholder?: string
  hideLabel?: boolean
  autoResize?: boolean
  maxHeightPx?: number
  showVoice?: boolean
  showVoiceCancel?: boolean
  compactVoice?: boolean
}

export function VoiceNoteField({ disabled = false, onBusyChange, name, source, defaultValue, value, onValueChange, onManualValueChange, onTranscriptValueChange, onTranscriptAppended, label = 'Заметка', voiceLabel, voiceBeta, placeholder, hideLabel = false, autoResize = false, maxHeightPx = 264, showVoice = true, showVoiceCancel = false, compactVoice = false }: VoiceNoteFieldProps) {
  const id = useId()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [isTranscriptProcessing, setIsTranscriptProcessing] = useState(false)
  const [voiceBusy, setVoiceBusy] = useState(false)
  const locked = useRef(disabled)
  useLayoutEffect(() => { locked.current = disabled }, [disabled])
  const onPhaseChange = useCallback((phase: VoiceInputPhase) => setVoiceBusy(phase !== 'idle'), [])
  useEffect(() => { onBusyChange?.(voiceBusy || isTranscriptProcessing) }, [voiceBusy, isTranscriptProcessing, onBusyChange])
  useEffect(() => () => onBusyChange?.(false), [onBusyChange])

  const resizeTextarea = () => {
    if (!autoResize || !textareaRef.current) return
    const textarea = textareaRef.current
    textarea.style.height = 'auto'
    const height = Math.min(textarea.scrollHeight, maxHeightPx)
    textarea.style.height = `${height}px`
    textarea.style.overflowY = textarea.scrollHeight > maxHeightPx ? 'auto' : 'hidden'
  }

  useEffect(() => {
    resizeTextarea()
  }, [autoResize, maxHeightPx, value])
  return <div className="field voice-note-field">
    {!hideLabel && <label htmlFor={id}>{label}</label>}
    <textarea
      disabled={disabled}
      ref={textareaRef}
      id={id}
      name={name}
      rows={compactVoice ? 1 : undefined}
      aria-label={hideLabel ? label : undefined}
      placeholder={placeholder}
      defaultValue={onValueChange ? undefined : defaultValue}
      value={onValueChange ? value ?? '' : undefined}
      onChange={onValueChange ? (event) => {
        if (locked.current) return
        const nextValue = event.target.value
        onValueChange(nextValue)
        onManualValueChange?.(nextValue)
        window.requestAnimationFrame(resizeTextarea)
      } : undefined}
    />
    {showVoice && <VoiceInputButton disabled={disabled} onPhaseChange={onPhaseChange} onStart={() => setVoiceBusy(true)} variant={compactVoice ? 'icon' : 'inline'} source={source} idleLabel={voiceLabel} beta={voiceBeta} showCancel={showVoiceCancel} onTranscript={(text) => {
      if (!textareaRef.current || locked.current) return
      const previous = textareaRef.current.value
      const nextValue = appendTranscript(previous, text)
      let appliedValue = nextValue
      if (onTranscriptValueChange) onTranscriptValueChange(nextValue)
      else if (onValueChange) onValueChange(nextValue)
      else {
        textareaRef.current.value = nextValue
        textareaRef.current.dispatchEvent(new Event('input', { bubbles: true }))
      }
      if (onTranscriptAppended) {
        setIsTranscriptProcessing(true)
        const processing = onTranscriptAppended({ previousValue: previous, value: nextValue, transcript: text.trim() })
        if (processing && typeof processing !== 'string' && typeof processing.then === 'function') {
          void processing.then((formatted) => {
            if (typeof formatted === 'string') appliedValue = formatted
          }).finally(() => setIsTranscriptProcessing(false))
        } else {
          if (typeof processing === 'string') appliedValue = processing
          setIsTranscriptProcessing(false)
        }
      }
      textareaRef.current.focus()
      return () => {
        if (!textareaRef.current || locked.current || textareaRef.current.value !== appliedValue) return
        // Undo is a user edit: invalidate pending parsing and derived previews.
        if (onValueChange) onValueChange(previous)
        else if (onTranscriptValueChange) onTranscriptValueChange(previous)
        else {
          textareaRef.current.value = previous
          textareaRef.current.dispatchEvent(new Event('input', { bubbles: true }))
        }
      }
    }} />}
    {isTranscriptProcessing && <div className="voice-input-status" role="status"><small>Текст распознан. Обрабатываем упражнения…</small></div>}
  </div>
}

export function appendTranscript(current: string, transcript: string): string {
  const next = transcript.trim()
  if (!next) return current
  const existing = current.trimEnd()
  return existing ? `${existing}\n${next}` : next
}
