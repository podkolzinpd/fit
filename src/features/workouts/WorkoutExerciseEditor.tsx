import type { WorkoutExerciseDraft, WorkoutSetDraft } from '../../shared/domain'
import { nextSetDraft } from '../../data/repositories/workout-rules'

export function roundToStep(value: number, step: number): number {
  return Math.round(value / step) * step
}

export function adjustWorkoutLoad(
  exercises: readonly WorkoutExerciseDraft[],
  factor: number,
): WorkoutExerciseDraft[] {
  return exercises.map((exercise) => ({
    ...exercise,
    sets: exercise.sets.map((set) => ({
      ...set,
      weightKg: set.weightKg === undefined ? undefined : roundToStep(set.weightKg * factor, 2.5),
    })),
  }))
}

export function clearWorkoutLoad(exercises: readonly WorkoutExerciseDraft[]): WorkoutExerciseDraft[] {
  return exercises.map((exercise) => ({
    ...exercise,
    sets: exercise.sets.map((set) => ({ position: set.position })),
  }))
}

interface WorkoutExerciseEditorProps {
  exercises: readonly WorkoutExerciseDraft[]
  onChange: (exercises: WorkoutExerciseDraft[]) => void
  onOpenPicker: () => void
}

function inputNumber(value: string): number | undefined {
  return value === '' ? undefined : Number(value)
}

export function WorkoutExerciseEditor({ exercises, onChange, onOpenPicker }: WorkoutExerciseEditorProps) {
  function updateSet(exerciseIndex: number, setIndex: number, patch: Partial<WorkoutSetDraft>) {
    onChange(exercises.map((exercise, currentExercise) => currentExercise === exerciseIndex ? {
      ...exercise,
      sets: exercise.sets.map((set, currentSet) => currentSet === setIndex ? { ...set, ...patch } : set),
    } : exercise))
  }
  function addSet(exerciseIndex: number) {
    onChange(exercises.map((exercise, current) => current === exerciseIndex ? {
      ...exercise, sets: [...exercise.sets, nextSetDraft(exercise.sets, exercise.inputKind)],
    } : exercise))
  }
  function removeSet(exerciseIndex: number, setIndex: number) {
    onChange(exercises.map((exercise, current) => current === exerciseIndex ? {
      ...exercise,
      sets: exercise.sets.filter((_, index) => index !== setIndex).map((set, position) => ({ ...set, position })),
    } : exercise))
  }
  function removeExercise(exerciseIndex: number) {
    onChange(exercises.filter((_, index) => index !== exerciseIndex).map((exercise, position) => ({ ...exercise, position })))
  }

  return <section>
    <div className="workout-editor-heading"><h2>Упражнения</h2>{exercises.length > 0 && <div className="workout-tools"><button type="button" className="link" onClick={() => onChange(clearWorkoutLoad(exercises))}>Сбросить значения</button><button type="button" className="link" onClick={() => onChange(adjustWorkoutLoad(exercises, .95))}>−5%</button><button type="button" className="link" onClick={() => onChange(adjustWorkoutLoad(exercises, 1.05))}>+5%</button></div>}</div>
    {exercises.map((exercise, exerciseIndex) => <article className="exercise" key={`${exercise.ref}-${exerciseIndex}`}>
      <header><strong>{exercise.name}</strong><button type="button" className="link danger" onClick={() => removeExercise(exerciseIndex)}>Удалить</button></header>
      {exercise.sets.map((set, setIndex) => <div className="planned-set" key={setIndex}>
        <div className="planned-set-heading"><span>Подход {setIndex + 1}</span>{exercise.sets.length > 1 && <button type="button" className="link danger" aria-label={`Удалить подход ${setIndex + 1}`} onClick={() => removeSet(exerciseIndex, setIndex)}>×</button>}</div>
        <div className="set-row">
          {exercise.inputKind === 'strength' && <><input aria-label={`Вес, подход ${setIndex + 1}`} type="number" min="0" step="0.5" placeholder="кг" value={set.weightKg ?? ''} onChange={(event) => updateSet(exerciseIndex, setIndex, { weightKg: inputNumber(event.target.value) })} /><input aria-label={`Повторы, подход ${setIndex + 1}`} type="number" min="0" placeholder="повт." value={set.reps ?? ''} onChange={(event) => updateSet(exerciseIndex, setIndex, { reps: inputNumber(event.target.value) })} /></>}
          {exercise.inputKind === 'reps' && <><input aria-label={`Время, подход ${setIndex + 1}`} type="number" min="0" step="0.5" placeholder="мин" value={set.durationMin ?? ''} onChange={(event) => updateSet(exerciseIndex, setIndex, { durationMin: inputNumber(event.target.value) })} /><input aria-label={`Повторы, подход ${setIndex + 1}`} type="number" min="0" placeholder="повт." value={set.reps ?? ''} onChange={(event) => updateSet(exerciseIndex, setIndex, { reps: inputNumber(event.target.value) })} /></>}
          {exercise.inputKind === 'distance' && <><input aria-label={`Время, подход ${setIndex + 1}`} type="number" min="0" step="0.5" placeholder="мин" value={set.durationMin ?? ''} onChange={(event) => updateSet(exerciseIndex, setIndex, { durationMin: inputNumber(event.target.value) })} /><input aria-label={`Расстояние, подход ${setIndex + 1}`} type="number" min="0" step="0.1" placeholder="км" value={set.distanceKm ?? ''} onChange={(event) => updateSet(exerciseIndex, setIndex, { distanceKm: inputNumber(event.target.value) })} /></>}
        </div>
      </div>)}
      <button type="button" className="secondary" onClick={() => addSet(exerciseIndex)}>＋ Подход</button>
    </article>)}
    <button type="button" className="secondary wide" onClick={onOpenPicker}>＋ Упражнение</button>
  </section>
}
