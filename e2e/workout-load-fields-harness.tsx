import { useState, type FormEvent } from 'react'
import { createRoot } from 'react-dom/client'
import type { WorkoutExerciseDraft } from '../src/shared/domain'
import { SYSTEM_EXERCISE_CATALOG } from '../src/shared/system-exercises'
import { WorkoutExerciseEditor } from '../src/features/workouts/WorkoutExerciseEditor'

const refs = ['vital-barbell-hold-ex010', 'farmer-carry', 'vital-gym-pro-r303-1645']
function Harness() {
  const [visibleRef, setVisibleRef] = useState('farmer-carry')
  const [draft, setDraft] = useState<WorkoutExerciseDraft[]>(refs.map((ref, position) => ({
    ...SYSTEM_EXERCISE_CATALOG.find((item) => item.ref === ref)!,
    position, sets: [{ position: 0, weightKg: 22.16, ...(position === 0 ? { durationSec: 30 } : position === 1 ? { distanceKm: 0.02216 } : { reps: 12 }) }],
  })))
  const [saved, setSaved] = useState('')
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaved(JSON.stringify(draft))
  }
  return <div className="phone-frame theme-light workout-create-edit-identity"><main className="content content-immersive">
    <form className="workout-form" onSubmit={submit}>
      <h1>Редактировать тренировку</h1>
      <label>Проверяемое упражнение<select aria-label="Проверяемое упражнение" value={visibleRef} onChange={(event) => setVisibleRef(event.target.value)}>{refs.map((ref) => <option key={ref} value={ref}>{SYSTEM_EXERCISE_CATALOG.find((item) => item.ref === ref)!.name}</option>)}</select></label>
      <WorkoutExerciseEditor exercises={draft.filter((item) => item.ref === visibleRef)} onChange={(updated) => setDraft((current) => current.map((item) => item.ref === visibleRef ? updated[0]! : item))} onOpenPicker={() => undefined} onReplaceExercise={() => undefined} showRpeByDefault />
      <button type="submit">Сохранить план</button>
      <output className="sr-only" aria-label="Сохранённые подходы">{saved}</output>
    </form>
  </main></div>
}
export function mountWorkoutLoadFieldsHarness() {
  const original = document.getElementById('root')
  if (original) original.style.display = 'none'
  const mount = document.createElement('div')
  document.body.append(mount)
  createRoot(mount).render(<Harness />)
}
