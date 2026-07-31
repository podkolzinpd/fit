import { useMemo, useState } from 'react'
import type { ExerciseSnapshot } from '../../shared/domain'
import { VoiceNoteField } from '../voice-input'
import { parseQuickWorkoutEntry, type ParsedWorkoutExercise } from './quick-workout-entry'

interface QuickWorkoutEntryProps {
  catalog: readonly ExerciseSnapshot[]
  onAdd: (exercises: ParsedWorkoutExercise[]) => void
}

export function QuickWorkoutEntry({ catalog, onAdd }: QuickWorkoutEntryProps) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const parsed = useMemo(() => parseQuickWorkoutEntry(text, catalog), [text, catalog])

  function add() {
    if (!parsed.parsed.length) return
    onAdd(parsed.parsed)
    setText('')
    setOpen(false)
  }

  return <section className="quick-workout-entry">
    <button type="button" className="secondary wide" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
      {open ? 'Скрыть быстрый ввод' : '⌁ Добавить из текста или голоса'}
    </button>
    {open && <div className="quick-workout-entry-panel">
      <p className="muted">По одной строке: <strong>Присед со штангой 3×8 80 кг</strong> или <strong>Планка 3×45 сек</strong>. Сначала проверим разбор, затем добавим упражнения в форму.</p>
      <VoiceNoteField name="quick-workout-entry" source="workout_quick_entry" label="Запись тренировки" value={text} onValueChange={setText} />
      {text.trim() && <div className="quick-workout-preview" aria-live="polite">
        {parsed.parsed.length > 0 && <><p><strong>Распознано: {parsed.parsed.length}</strong></p><ul>{parsed.parsed.map((item, index) => <li key={`${item.exercise.ref}-${index}`}>{item.exercise.name} · {item.sets.length} {item.sets.length === 1 ? 'подход' : item.sets.length < 5 ? 'подхода' : 'подходов'}</li>)}</ul></>}
        {parsed.unparsed.length > 0 && <div className="quick-workout-unparsed"><p><strong>Нужно выбрать через каталог:</strong></p><ul>{parsed.unparsed.map((item) => <li key={item.line}>«{item.line}» — {item.reason === 'ambiguous' ? 'несколько похожих упражнений' : 'не нашли точное совпадение'}</li>)}</ul></div>}
      </div>}
      <button type="button" disabled={!parsed.parsed.length} onClick={add}>Добавить распознанные{parsed.parsed.length ? ` (${parsed.parsed.length})` : ''}</button>
    </div>}
  </section>
}
