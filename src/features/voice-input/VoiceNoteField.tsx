import { useId, useRef } from 'react'
import { VoiceInputButton } from './VoiceInputButton'

interface VoiceNoteFieldProps {
  name: string
  defaultValue?: string
  value?: string
  onValueChange?: (value: string) => void
  label?: string
}

export function VoiceNoteField({ name, defaultValue, value, onValueChange, label = 'Заметка' }: VoiceNoteFieldProps) {
  const id = useId()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  return <div className="field voice-note-field">
    <label htmlFor={id}>{label}</label>
    <textarea
      ref={textareaRef}
      id={id}
      name={name}
      defaultValue={onValueChange ? undefined : defaultValue}
      value={onValueChange ? value ?? '' : undefined}
      onChange={onValueChange ? (event) => onValueChange(event.target.value) : undefined}
    />
    <VoiceInputButton onTranscript={(text) => {
      if (!textareaRef.current) return
      const transcript = replaceWithTranscript(text)
      if (onValueChange) onValueChange(transcript)
      else {
        textareaRef.current.value = transcript
        textareaRef.current.dispatchEvent(new Event('input', { bubbles: true }))
      }
      textareaRef.current.focus()
    }} />
  </div>
}

export function replaceWithTranscript(transcript: string): string {
  return transcript.trim()
}
