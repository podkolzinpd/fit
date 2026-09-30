import { useState, type FormEvent } from 'react'
import { createRoot } from 'react-dom/client'
import type { WorkoutExerciseDraft } from '../src/shared/domain'
import { WorkoutExerciseEditor } from '../src/features/workouts/WorkoutExerciseEditor'

const exercises: WorkoutExerciseDraft[] = [{
  source: 'system', ref: 'cable-lateral-raise', name: 'Отведение руки в сторону в нижнем блоке',
  muscleGroup: 'shoulders', inputKind: 'strength', position: 0,
  sets: [{ position: 0, weightKg: 3.4, reps: 12 }],
}]

function Harness() {
  const [draft, setDraft] = useState(exercises)
  const [savedWeight, setSavedWeight] = useState<number | null>(null)
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSavedWeight(draft[0]?.sets[0]?.weightKg ?? null)
  }
  return <div className="phone-frame theme-light workout-create-edit-identity"><main className="content content-immersive">
    <form className="workout-form" onSubmit={submit}>
      <h1>Редактировать тренировку</h1>
      <WorkoutExerciseEditor exercises={draft} onChange={setDraft} onOpenPicker={() => undefined} onReplaceExercise={() => undefined} />
      <button type="submit">Сохранить план</button>
      <output aria-label="Сохранённый вес">{savedWeight ?? ''}</output>
    </form>
  </main></div>
}

export function mountWorkoutDecimalWeightHarness() {
  const original = document.getElementById('root')
  if (original) original.style.display = 'none'
  const mount = document.createElement('div')
  mount.id = 'workout-decimal-weight-qa'
  document.body.append(mount)
  createRoot(mount).render(<Harness />)
}
