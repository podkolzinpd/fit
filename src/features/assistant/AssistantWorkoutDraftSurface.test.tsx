import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
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
  items: [{ sourceText: 'присед 3 по 15 80 кг', exerciseRef: 'barbell-squat', confidence: 1, sets: Array.from({ length: 3 }, () => ({ reps: 15, weightKg: 80 })) }],
  unmatched: [{ sourceText: 'жим лежа 100 кг 15 раз 3 подхода', reason: 'Уточните оборудование', suggestedExerciseRefs: ['barbell-bench', 'dumbbell-bench'], sets: Array.from({ length: 3 }, () => ({ reps: 15, weightKg: 100 })) }],
}

function InteractiveSurface() {
  const [result, setResult] = useState(initialResult)
  return <AssistantWorkoutDraftSurface mode="collecting" clientName="Сан Саныч" workoutDate="2026-08-26" startTime="10:43" rawFragments={['жим', 'присед']} result={result} catalog={catalog} parsing={false} catalogLoading={false} saving={false} saved={false} canFinish={result.unmatched.length === 0} onDateChange={vi.fn()} onTimeChange={vi.fn()} onChoose={(sourceText, ref) => setResult((current) => resolveWorkoutParseSource(current, sourceText, ref))} onUpdateMetrics={(sourceText, patch) => setResult((current) => updateWorkoutParseMetrics(current, sourceText, patch))} onRemove={(sourceText) => setResult((current) => ({ items: current.items.filter((item) => item.sourceText !== sourceText), unmatched: current.unmatched.filter((item) => item.sourceText !== sourceText) }))} onSave={vi.fn()} onFinish={vi.fn()} onCancel={vi.fn()} />
}

describe('assistant workout production surface', () => {
  it('edits rows and resolves an ambiguous exercise without losing values', async () => {
    const user = userEvent.setup()
    render(<InteractiveSurface />)
    const submit = screen.getByRole('button', { name: 'Проверить и сохранить' })
    expect(submit).toBeDisabled()

    await user.clear(screen.getAllByLabelText('Вес')[0]!)
    await user.type(screen.getAllByLabelText('Вес')[0]!, '85')
    await user.click(screen.getByRole('button', { name: /Жим штанги лёжа/i }))

    expect(screen.queryByText('Уточните упражнение')).not.toBeInTheDocument()
    expect(screen.getByText('Жим штанги лёжа')).toBeInTheDocument()
    expect(screen.getAllByLabelText('Вес')[1]).toHaveValue(100)
    expect(submit).toBeEnabled()
    await user.click(screen.getByRole('button', { name: /Удалить Присед/i }))
    expect(screen.queryByText('Присед со штангой')).not.toBeInTheDocument()
  })

  it('renders recognition, confirmation, saved and empty-value states', async () => {
    const callbacks = { onDateChange: vi.fn(), onTimeChange: vi.fn(), onChoose: vi.fn(), onUpdateMetrics: vi.fn(), onRemove: vi.fn(), onSave: vi.fn(), onFinish: vi.fn(), onCancel: vi.fn() }
    const { rerender } = render(<AssistantWorkoutDraftSurface mode="collecting" clientName="Сан Саныч" workoutDate="2026-08-26" startTime="10:43" rawFragments={[]} catalog={catalog} parsing={false} catalogLoading={false} saving={false} saved={false} canFinish={false} {...callbacks} />)
    expect(screen.getByText('Продиктуйте первое упражнение')).toBeInTheDocument()

    rerender(<AssistantWorkoutDraftSurface mode="collecting" clientName="Сан Саныч" workoutDate="2026-08-26" startTime="10:43" rawFragments={['жим']} catalog={catalog} parsing catalogLoading={false} saving={false} saved={false} canFinish={false} {...callbacks} />)
    expect(screen.getByText('Распознаю упражнение…')).toBeInTheDocument()

    const resolved: WorkoutParseResponse = { items: [{ sourceText: 'жим', exerciseRef: 'barbell-bench', confidence: 1, sets: [{}] }], unmatched: [] }
    rerender(<AssistantWorkoutDraftSurface mode="confirm" clientName="Сан Саныч" workoutDate="2026-08-26" startTime="10:43" rawFragments={['жим']} result={resolved} catalog={catalog} parsing={false} catalogLoading={false} saving={false} saved={false} canFinish composer={<span>Добавление упражнения</span>} {...callbacks} />)
    expect(screen.getByText('Добавление упражнения')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить тренировку' }))
    expect(callbacks.onSave).toHaveBeenCalledOnce()

    rerender(<AssistantWorkoutDraftSurface mode="confirm" clientName="Сан Саныч" workoutDate="2026-08-26" startTime="10:43" rawFragments={['жим']} result={resolved} catalog={catalog} parsing={false} catalogLoading={false} saving={false} saved canFinish {...callbacks} />)
    expect(screen.getByRole('button', { name: 'Тренировка сохранена' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Отменить сценарий' })).not.toBeInTheDocument()
  })
})
