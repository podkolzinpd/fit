import type { ReactNode } from 'react'
import { VoiceNoteField } from '../voice-input'

interface WorkoutComposerProps {
  name: string
  source: string
  value: string
  label?: string
  voiceLabel?: string
  placeholder?: string
  onValueChange: (value: string) => void
  onClear: () => void
  onManualValueChange?: (value: string) => void
  onTranscriptValueChange?: (value: string) => void
  onTranscriptAppended?: (event: { previousValue: string; value: string; transcript: string }) => void | Promise<void>
  primaryAction: ReactNode
  secondaryAction?: ReactNode
  children?: ReactNode
}

// Общая оболочка текстового и голосового ввода. Разбор остаётся у экрана-владельца:
// на главной он открывает проверку, в редакторе плана — добавляет упражнения.
export function WorkoutComposer({ name, source, value, label = 'Тренировка', voiceLabel = 'Надиктовать', placeholder = 'Присед 3×8 — 80 кг\nПланка 3×45 сек', onValueChange, onClear, onManualValueChange, onTranscriptValueChange, onTranscriptAppended, primaryAction, secondaryAction, children }: WorkoutComposerProps) {
  return <section className="workout-composer">
    <div className="workout-composer-card">
      <VoiceNoteField name={name} source={source} label={label} voiceLabel={voiceLabel} placeholder={placeholder} value={value} autoResize onValueChange={onValueChange} onManualValueChange={onManualValueChange} onTranscriptValueChange={onTranscriptValueChange} onTranscriptAppended={onTranscriptAppended} />
      {value && <div className="workout-composer-clear"><button type="button" className="link" onClick={onClear}>Очистить</button></div>}
    </div>
    {children}
    <div className="workout-composer-actions">
      {primaryAction}
      {secondaryAction}
    </div>
  </section>
}
