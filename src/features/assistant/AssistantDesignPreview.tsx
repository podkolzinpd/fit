import { useState } from 'react'
import type { WorkoutParseResponse } from '../../data/repositories/exercises.repository'
import type { ExerciseSnapshot } from '../../shared/domain'
import { resolveWorkoutParseSource, updateWorkoutParseMetrics } from './workout-draft'
import { AssistantWorkoutDraftSurface } from './AssistantWorkoutDraftSurface'

const catalog: ExerciseSnapshot[] = [
  { source: 'system', ref: 'barbell-bench', name: 'Жим штанги лёжа', muscleGroup: 'chest', inputKind: 'strength', equipment: 'Штанга' },
  { source: 'system', ref: 'dumbbell-bench', name: 'Жим гантелей лёжа', muscleGroup: 'chest', inputKind: 'strength', equipment: 'Гантели' },
  { source: 'system', ref: 'barbell-squat', name: 'Присед со штангой', muscleGroup: 'legs', inputKind: 'strength', equipment: 'Штанга' },
]

const initialResult: WorkoutParseResponse = {
  items: [{ sourceText: 'присед со штангой 80 килограмм 15 раз 3 подхода', exerciseRef: 'barbell-squat', confidence: 1, sets: Array.from({ length: 3 }, () => ({ reps: 15, weightKg: 80 })) }],
  unmatched: [{ sourceText: 'жим лежа 100 килограмм 15 раз 3 подхода', reason: 'Уточните оборудование', suggestedExerciseRefs: ['barbell-bench', 'dumbbell-bench'], sets: Array.from({ length: 3 }, () => ({ reps: 15, weightKg: 100 })) }],
}

export function AssistantDesignPreview() {
  const [result, setResult] = useState(initialResult)
  return <main className="assistant-design-preview"><section className="assistant-context-panel"><AssistantWorkoutDraftSurface mode="collecting" clientName="Сан Саныч" workoutDate="2026-08-26" startTime="10:43" rawFragments={['жим лежа 100 килограмм 15 раз 3 подхода', 'присед со штангой 80 килограмм 15 раз 3 подхода']} result={result} catalog={catalog} parsing={false} catalogLoading={false} saving={false} saved={false} canFinish={result.unmatched.length === 0} onDateChange={() => undefined} onTimeChange={() => undefined} onChoose={(sourceText, ref) => setResult((current) => resolveWorkoutParseSource(current, sourceText, ref))} onUpdateMetrics={(sourceText, patch) => setResult((current) => updateWorkoutParseMetrics(current, sourceText, patch))} onRemove={(sourceText) => setResult((current) => ({ items: current.items.filter((item) => item.sourceText !== sourceText), unmatched: current.unmatched.filter((item) => item.sourceText !== sourceText) }))} onSave={() => undefined} onFinish={() => undefined} onCancel={() => undefined} /></section></main>
}
