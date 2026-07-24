import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { useState } from 'react'
import type { WorkoutExerciseDraft } from '../../shared/domain'
import { adjustWorkoutLoad, clearWorkoutLoad, roundToStep, WorkoutExerciseEditor } from './WorkoutExerciseEditor'

const exercises: WorkoutExerciseDraft[] = [{
  source: 'system', ref: 'squat', name: 'Присед', muscleGroup: 'legs', inputKind: 'strength', position: 0,
  sets: [{ position: 0, weightKg: 52.5, reps: 10 }, { position: 1, reps: 8 }],
}]

function EditorHarness({ onOpenPicker }: { onOpenPicker: () => void }) {
  const [draft, setDraft] = useState(exercises)
  return <WorkoutExerciseEditor exercises={draft} onChange={setDraft} onOpenPicker={onOpenPicker} onReplaceExercise={vi.fn()} />
}

describe('workout exercise editor rules', () => {
  it('rounds adjusted weights to 2.5 kg', () => {
    expect(roundToStep(52.5 * 1.05, 2.5)).toBe(55)
    expect(adjustWorkoutLoad(exercises, 1.05)[0]?.sets).toEqual([
      { position: 0, weightKg: 55, reps: 10 }, { position: 1, weightKg: undefined, reps: 8 },
    ])
  })

  it('clears values but preserves the set structure', () => {
    expect(clearWorkoutLoad(exercises)[0]?.sets).toEqual([{ position: 0 }, { position: 1 }])
  })

  it('edits, adds and removes sets and exercises', async () => {
    const user = userEvent.setup()
    const onOpenPicker = vi.fn()
    render(<EditorHarness onOpenPicker={onOpenPicker} />)

    await user.clear(screen.getByLabelText('Вес, подход 1'))
    await user.type(screen.getByLabelText('Вес, подход 1'), '60')
    expect(screen.getByLabelText('Вес, подход 1')).toHaveValue(60)

    await user.click(screen.getByRole('button', { name: '＋ Подход' }))
    expect(screen.getByText('Подход 3')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Удалить подход 2' }))
    expect(screen.queryByText('Подход 3')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Удалить' }))
    expect(screen.queryByText('Присед')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '＋ Упражнение' }))
    expect(onOpenPicker).toHaveBeenCalledOnce()
  })

  it('renders all input kinds and applies plan tools', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn<(value: WorkoutExerciseDraft[]) => void>()
    const mixed: WorkoutExerciseDraft[] = [
      exercises[0]!,
      { source: 'system', ref: 'burpees', name: 'Берпи', muscleGroup: 'cardio', inputKind: 'reps', position: 1, sets: [{ position: 0 }] },
      { source: 'system', ref: 'running', name: 'Бег', muscleGroup: 'cardio', inputKind: 'distance', position: 2, sets: [{ position: 0 }] },
    ]
    render(<WorkoutExerciseEditor exercises={mixed} onChange={onChange} onOpenPicker={vi.fn()} onReplaceExercise={vi.fn()} />)
    expect(screen.getAllByLabelText('Время, подход 1')).toHaveLength(2)
    expect(screen.getByLabelText('Расстояние, подход 1')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Сбросить значения' }))
    expect(onChange.mock.calls.at(-1)?.[0]?.[0]?.sets[0]).toEqual({ position: 0 })
    await user.click(screen.getByRole('button', { name: '+5%' }))
    expect(onChange.mock.calls.at(-1)?.[0]?.[0]?.sets[0]?.weightKg).toBe(55)
    await user.click(screen.getByRole('button', { name: '−5%' }))
    expect(onChange).toHaveBeenCalledTimes(3)
  })
})
