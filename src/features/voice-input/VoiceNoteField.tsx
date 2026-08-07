import { useEffect, useId, useRef, useState } from 'react'
import { VoiceInputButton } from './VoiceInputButton'

interface VoiceNoteFieldProps {
  name: string
  // Экран/форма, где стоит поле — см. VoiceInputButtonProps.source.
  source: string
  defaultValue?: string
  value?: string
  onValueChange?: (value: string) => void
  onManualValueChange?: (value: string) => void
  onTranscriptValueChange?: (value: string) => void
  onTranscriptAppended?: (event: { previousValue: string; value: string; transcript: string }) => void | Promise<void>
  label?: string
  voiceLabel?: string
  voiceBeta?: boolean
  placeholder?: string
  hideLabel?: boolean
  autoResize?: boolean
  maxHeightPx?: number
  showVoice?: boolean
}

export function VoiceNoteField({ name, source, defaultValue, value, onValueChange, onManualValueChange, onTranscriptValueChange, onTranscriptAppended, label = 'Заметка', voiceLabel, voiceBeta, placeholder, hideLabel = false, autoResize = false, maxHeightPx = 264, showVoice = true }: VoiceNoteFieldProps) {
  const id = useId()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [isTranscriptProcessing, setIsTranscriptProcessing] = useState(false)

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
      ref={textareaRef}
      id={id}
      name={name}
      aria-label={hideLabel ? label : undefined}
      placeholder={placeholder}
      defaultValue={onValueChange ? undefined : defaultValue}
      value={onValueChange ? value ?? '' : undefined}
      onChange={onValueChange ? (event) => {
        const nextValue = event.target.value
        onValueChange(nextValue)
        onManualValueChange?.(nextValue)
        window.requestAnimationFrame(resizeTextarea)
      } : undefined}
    />
    {showVoice && <VoiceInputButton source={source} idleLabel={voiceLabel} beta={voiceBeta} onTranscript={(text) => {
      if (!textareaRef.current) return
      const previous = textareaRef.current.value
      const nextValue = appendTranscript(previous, text)
      if (onTranscriptValueChange) onTranscriptValueChange(nextValue)
      else if (onValueChange) onValueChange(nextValue)
      else {
        textareaRef.current.value = nextValue
        textareaRef.current.dispatchEvent(new Event('input', { bubbles: true }))
      }
      if (onTranscriptAppended) {
        setIsTranscriptProcessing(true)
        const processing = onTranscriptAppended({ previousValue: previous, value: nextValue, transcript: text.trim() })
        if (processing && typeof processing.then === 'function') void processing.finally(() => setIsTranscriptProcessing(false))
        else setIsTranscriptProcessing(false)
      }
      textareaRef.current.focus()
      return () => {
        if (!textareaRef.current || textareaRef.current.value !== nextValue) return
        if (onTranscriptValueChange) onTranscriptValueChange(previous)
        else if (onValueChange) onValueChange(previous)
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

// Backward-compatible name for callers that only need normalization.
export function replaceWithTranscript(transcript: string): string {
  return transcript.trim()
}
