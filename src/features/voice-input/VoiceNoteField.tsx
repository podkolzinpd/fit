import { useId, useRef, useState } from 'react'
import { VoiceInputButton } from './VoiceInputButton'

interface VoiceNoteFieldProps {
  name: string
  // Экран/форма, где стоит поле — см. VoiceInputButtonProps.source.
  source: string
  defaultValue?: string
  value?: string
  onValueChange?: (value: string) => void
  label?: string
  voiceLabel?: string
  collapsible?: boolean
}

export function VoiceNoteField({ name, source, defaultValue, value, onValueChange, label = 'Заметка', voiceLabel, collapsible = false }: VoiceNoteFieldProps) {
  const id = useId()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [draftValue, setDraftValue] = useState(defaultValue ?? '')
  const currentValue = onValueChange ? value ?? '' : draftValue
  const [open, setOpen] = useState(Boolean(currentValue))
  if (collapsible && !open) return <div className="voice-note-disclosure">
    <button type="button" className="secondary" aria-expanded="false" onClick={() => setOpen(true)}>Добавить заметку</button>
  </div>
  return <div className="field voice-note-field">
    <label htmlFor={id}>{label}</label>
    <textarea
      ref={textareaRef}
      id={id}
      name={name}
      value={currentValue}
      onChange={(event) => {
        if (onValueChange) onValueChange(event.target.value)
        else setDraftValue(event.target.value)
      }}
    />
    <VoiceInputButton source={source} idleLabel={voiceLabel} onTranscript={(text) => {
      if (!textareaRef.current) return
      const transcript = replaceWithTranscript(text)
      if (onValueChange) onValueChange(transcript)
      else setDraftValue(transcript)
      textareaRef.current.focus()
    }} />
    {collapsible && <button type="button" className="link voice-note-hide" onClick={() => setOpen(false)}>Скрыть заметку</button>}
  </div>
}

export function replaceWithTranscript(transcript: string): string {
  return transcript.trim()
}
