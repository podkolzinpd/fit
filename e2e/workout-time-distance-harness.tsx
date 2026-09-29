import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { WorkoutExerciseDraft } from '../src/shared/domain'
import { WorkoutExerciseEditor } from '../src/features/workouts/WorkoutExerciseEditor'

const exercises: WorkoutExerciseDraft[] = [
  { source: 'system', ref: 'vital-stair-climber', name: 'Лестничный тренажёр', muscleGroup: 'cardio', inputKind: 'duration', position: 0, sets: [{ position: 0, durationSec: 7559 }] },
  { source: 'system', ref: 'running', name: 'Бег', muscleGroup: 'cardio', inputKind: 'distance', position: 1, sets: [{ position: 0, durationSec: 100, distanceKm: 0.4 }] },
  { source: 'system', ref: 'plank', name: 'Планка', muscleGroup: 'core', inputKind: 'duration', position: 2, sets: [{ position: 0, durationSec: 60 }] },
]

function Harness() {
  const [draft, setDraft] = useState(exercises)
  return <div className="phone-frame theme-light workout-create-edit-identity"><main className="content content-immersive"><div className="workout-form"><h1>План тренировки</h1>
    <WorkoutExerciseEditor exercises={draft} onChange={setDraft} onOpenPicker={() => undefined} onReplaceExercise={() => undefined} />
  </div></main></div>
}

export function mountWorkoutTimeDistanceHarness() {
  const original = document.getElementById('root')
  if (original) original.style.display = 'none'
  const mount = document.createElement('div')
  mount.id = 'workout-time-distance-qa'
  document.body.append(mount)
  createRoot(mount).render(<Harness />)
}
