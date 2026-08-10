import { useState } from 'react'
import type { ParsedWorkoutExercise } from './quick-workout-entry'
import type { WorkoutSetDraft } from '../../shared/domain'
import { WorkoutSetTable } from './WorkoutSetTable'

function setSummary(item: ParsedWorkoutExercise): string {
  const first = item.sets[0]
  if (!item.hasValues || !first) return 'без значений'
  if (first.durationSec !== undefined) return `${item.sets.length} × ${first.durationSec} сек`
  if (first.distanceKm !== undefined) return `${item.sets.length} × ${first.distanceKm} км`
  const value = [first.weightKg !== undefined ? `${first.weightKg} кг` : '', first.reps !== undefined ? `${first.reps} повт.` : ''].filter(Boolean).join(' × ')
  return `${item.sets.length} × ${value || 'значения'}`
}

interface ExerciseCardProps {
  item: ParsedWorkoutExercise
  showRpe: boolean
  onToggleRpe: () => void
  onReplace: () => void
  onRemove: () => void
  onUpdateSet: (setIndex: number, patch: Partial<WorkoutSetDraft>) => void
  onAddSet: () => void
  onRemoveSet: (setIndex: number) => void
}

/** Карточка упражнения с подходами — переиспользуется и в чат-ленте, и (при необходимости) на других экранах ввода. */
export function ExerciseCard({ item, showRpe, onToggleRpe, onReplace, onRemove, onUpdateSet, onAddSet, onRemoveSet }: ExerciseCardProps) {
  // Раскрываем один раз при появлении карточки без значений; дальше пользователь
  // управляет сворачиванием сам — иначе details.open, пересчитываемый на каждый
  // ввод, схлопывал редактор ровно тогда, когда появлялось первое значение.
  const [open, setOpen] = useState(() => setSummary(item) === 'без значений')
  return <article className="today-exercise planned-exercise">
    <header className="today-exercise-title">
      <div><strong>{item.exercise.name}</strong><p className={setSummary(item) === 'без значений' ? 'today-exercise-missing' : undefined}>{setSummary(item)}</p></div>
      <button type="button" className="icon-button" aria-label={`Удалить ${item.exercise.name}`} onClick={onRemove}>×</button>
    </header>
    <details className="today-exercise-editor" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>{setSummary(item) === 'без значений' ? 'Добавить значения' : 'Править подходы'}</summary>
      <div className="today-exercise-actions">
        <button type="button" className="link" onClick={onReplace}>Заменить</button>
        <button type="button" className="link" aria-pressed={showRpe} onClick={onToggleRpe}>{showRpe ? 'Скрыть RPE' : 'Указать RPE'}</button>
      </div>
      <WorkoutSetTable variant="planned" inputKind={item.exercise.inputKind} layout="singleValue" showRpe={showRpe} className="today-set-list">
        {item.sets.map((set, setIndex) => <div className={`today-set-editor workout-set-row planned-set ${showRpe ? 'rpe-visible' : ''}`} key={set.position}>
          <strong className="workout-set-number planned-set-number">{setIndex + 1}</strong>
          {item.exercise.inputKind === 'strength' && <>
            <label><span className="sr-only">Кг</span><input className="planned-set-input" aria-label={`${item.exercise.name}: вес, подход ${setIndex + 1}`} type="number" inputMode="decimal" value={set.weightKg ?? ''} onChange={(event) => onUpdateSet(setIndex, { weightKg: event.target.value === '' ? undefined : Number(event.target.value) })} /></label>
            <label><span className="sr-only">Повт.</span><input className="planned-set-input" aria-label={`${item.exercise.name}: повторы, подход ${setIndex + 1}`} type="number" inputMode="numeric" value={set.reps ?? ''} onChange={(event) => onUpdateSet(setIndex, { reps: event.target.value === '' ? undefined : Number(event.target.value) })} /></label>
          </>}
          {item.exercise.inputKind === 'duration' && <>
            <label><span className="sr-only">Сек.</span><input className="planned-set-input" aria-label={`${item.exercise.name}: секунды, подход ${setIndex + 1}`} type="number" inputMode="numeric" value={set.durationSec ?? ''} onChange={(event) => onUpdateSet(setIndex, { durationSec: event.target.value === '' ? undefined : Number(event.target.value) })} /></label>
            <span />
          </>}
          {item.exercise.inputKind === 'reps' && <>
            <label><span className="sr-only">Повт.</span><input className="planned-set-input" aria-label={`${item.exercise.name}: повторы, подход ${setIndex + 1}`} type="number" inputMode="numeric" value={set.reps ?? ''} onChange={(event) => onUpdateSet(setIndex, { reps: event.target.value === '' ? undefined : Number(event.target.value) })} /></label>
            <span />
          </>}
          {item.exercise.inputKind === 'distance' && <>
            <label><span className="sr-only">Км</span><input className="planned-set-input" aria-label={`${item.exercise.name}: километры, подход ${setIndex + 1}`} type="number" inputMode="decimal" value={set.distanceKm ?? ''} onChange={(event) => onUpdateSet(setIndex, { distanceKm: event.target.value === '' ? undefined : Number(event.target.value) })} /></label>
            <span />
          </>}
          {showRpe && <label><span className="sr-only">RPE</span><input className="planned-set-rpe" aria-label={`${item.exercise.name}: RPE, подход ${setIndex + 1}`} type="number" min="1" max="10" step="0.5" inputMode="decimal" value={set.rpe ?? ''} onChange={(event) => onUpdateSet(setIndex, { rpe: event.target.value === '' ? undefined : Number(event.target.value) })} /></label>}
          {item.sets.length > 1 && <button type="button" className="link danger planned-set-remove" aria-label={`Удалить подход ${setIndex + 1}`} onClick={() => onRemoveSet(setIndex)}>×</button>}
        </div>)}
      </WorkoutSetTable>
      <div className="set-add-row"><button type="button" className="secondary today-add-set" onClick={onAddSet}>＋ Подход</button></div>
    </details>
  </article>
}
