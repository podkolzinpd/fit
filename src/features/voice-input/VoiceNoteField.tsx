import { useId, useRef } from 'react'
import { VoiceInputButton } from './VoiceInputButton'

interface VoiceNoteFieldProps {
  name: string
  // Экран/форма, где стоит поле — см. VoiceInputButtonProps.source.
  source: string
  defaultValue?: string
  value?: string
  onValueChange?: (value: string) => void
  onTranscriptAppended?: (event: { previousValue: string; value: string; transcript: string }) => void
  label?: string
  voiceLabel?: string
  voiceBeta?: boolean
  placeholder?: string
  hideLabel?: boolean
}

export function VoiceNoteField({ name, source, defaultValue, value, onValueChange, onTranscriptAppended, label = 'Заметка', voiceLabel, voiceBeta, placeholder, hideLabel = false }: VoiceNoteFieldProps) {
  const id = useId()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
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
      onChange={onValueChange ? (event) => onValueChange(event.target.value) : undefined}
    />
    <VoiceInputButton source={source} idleLabel={voiceLabel} beta={voiceBeta} onTranscript={(text) => {
      if (!textareaRef.current) return
      const previous = textareaRef.current.value
      const nextValue = appendTranscript(previous, text)
      if (onValueChange) onValueChange(nextValue)
      else {
        textareaRef.current.value = nextValue
        textareaRef.current.dispatchEvent(new Event('input', { bubbles: true }))
      }
      onTranscriptAppended?.({ previousValue: previous, value: nextValue, transcript: text.trim() })
      textareaRef.current.focus()
      return () => {
        if (!textareaRef.current || textareaRef.current.value !== nextValue) return
        if (onValueChange) onValueChange(previous)
        else {
          textareaRef.current.value = previous
          textareaRef.current.dispatchEvent(new Event('input', { bubbles: true }))
        }
      }
    }} />
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
