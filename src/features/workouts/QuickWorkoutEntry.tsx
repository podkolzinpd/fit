import { useMemo, useState } from 'react'
import type { ExerciseSnapshot } from '../../shared/domain'
import { VoiceNoteField } from '../voice-input'
import { parseQuickWorkoutEntry, quickWorkoutExerciseName, resolveQuickWorkoutLine, type ParsedWorkoutExercise } from './quick-workout-entry'
import { trackGoal } from '../../shared/yandex-metrika'

interface QuickWorkoutEntryProps {
  catalog: readonly ExerciseSnapshot[]
  onAdd: (exercises: ParsedWorkoutExercise[]) => void
  defaultOpen?: boolean
  preferredExerciseRefs?: readonly string[]
  onOpenCatalog?: (search: string) => void
}

export function QuickWorkoutEntry({ catalog, onAdd, defaultOpen = false, preferredExerciseRefs = [], onOpenCatalog }: QuickWorkoutEntryProps) {
  const [open, setOpen] = useState(defaultOpen)
  const [text, setText] = useState('')
  const [choices, setChoices] = useState<Record<string, ExerciseSnapshot>>({})
  const parsed = useMemo(() => parseQuickWorkoutEntry(text, catalog, { preferredExerciseRefs }), [text, catalog, preferredExerciseRefs])
  const resolved = useMemo(() => [
    ...parsed.parsed,
    ...parsed.unparsed.flatMap((item) => choices[item.line] ? [resolveQuickWorkoutLine(item.line, choices[item.line]!)] : []),
  ], [choices, parsed])
  const unresolved = useMemo(() => parsed.unparsed.filter((item) => !choices[item.line]), [choices, parsed.unparsed])
  const clarification = useMemo(() => {
    const hasAmbiguous = unresolved.some((item) => item.reason === 'ambiguous')
    const hasNotFound = unresolved.some((item) => item.reason === 'not-found')
    if (hasAmbiguous && hasNotFound) return { title: 'Уточните упражнения', text: 'Выберите вариант ниже или дополните название.' }
    if (hasAmbiguous) return { title: 'Уточните упражнение', text: 'Выберите вариант ниже или допишите деталь: положение, тренажёр или оборудование.' }
    if (hasNotFound) return { title: 'Не нашли упражнение', text: 'Допишите название точнее или выберите его из каталога.' }
    return null
  }, [unresolved])

  function add() {
    if (!resolved.length) return
    if (unresolved.some((item) => item.reason === 'ambiguous')) trackGoal('workout_parse_ambiguous')
    if (unresolved.some((item) => item.reason === 'not-found')) trackGoal('workout_parse_not_found')
    onAdd(resolved)
    setText('')
    setChoices({})
    setOpen(false)
  }

  return <section className="quick-workout-entry">
    <button type="button" className="secondary wide" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
      {open ? 'Скрыть быстрый ввод' : '⌁ Добавить из текста или голоса'}
    </button>
    {open && <div className="quick-workout-entry-panel">
      <p className="muted">По одной строке: <strong>Присед со штангой 3×8 80 кг</strong>, <strong>80×8×3 RPE 8</strong>, <strong>80×8, 85×6, 90×5</strong> или <strong>Планка 3 по 45 сек</strong>. В голосовой записи разделяйте упражнения словом «затем».</p>
      <VoiceNoteField name="quick-workout-entry" source="workout_quick_entry" label="Запись тренировки" voiceLabel="Надиктовать тренировку" value={text} onValueChange={setText} />
      {text.trim() && <div className="quick-workout-preview" aria-live="polite">
        {resolved.length > 0 && <><p><strong>Распознано: {resolved.length}</strong></p><ul>{resolved.map((item, index) => <li key={`${item.exercise.ref}-${index}`}>{item.exercise.name} · {item.sets.length} {item.sets.length === 1 ? 'подход' : item.sets.length < 5 ? 'подхода' : 'подходов'}</li>)}</ul></>}
        {clarification && <section className="quick-workout-clarification" aria-label={clarification.title}><strong>{clarification.title}</strong><p>{clarification.text}</p></section>}
        {unresolved.length > 0 && <div className="quick-workout-unparsed">{unresolved.map((item) => <div className="quick-workout-unparsed-line" key={item.line}><p>«{item.line}» — {item.reason === 'ambiguous' ? 'выберите вариант' : 'не нашли совпадение'}</p>{item.candidates.length > 0 && <div className="quick-workout-candidates">{item.candidates.map((exercise) => <button type="button" className={choices[item.line]?.ref === exercise.ref ? 'secondary selected' : 'secondary'} key={exercise.ref} onClick={() => { trackGoal('workout_parse_candidate_selected'); setChoices((current) => ({ ...current, [item.line]: exercise })) }}>{exercise.name}</button>)}</div>}{onOpenCatalog && <button type="button" className="link quick-workout-all-options" onClick={() => { trackGoal('workout_parse_catalog_opened'); onOpenCatalog(quickWorkoutExerciseName(item.line)) }}>Все варианты</button>}</div>)}</div>}
      </div>}
      <button type="button" disabled={!resolved.length} onClick={add}>Добавить распознанные{resolved.length ? ` (${resolved.length})` : ''}</button>
    </div>}
  </section>
}
