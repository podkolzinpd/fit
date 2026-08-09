import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { useState } from 'react'
import type { WorkoutExerciseDraft } from '../../shared/domain'
import { localDate } from '../../shared/local-date'
import { adjustWorkoutLoad, clearWorkoutLoad, roundToStep, WorkoutExerciseEditor } from './WorkoutExerciseEditor'

const exercises: WorkoutExerciseDraft[] = [{
  source: 'system', ref: 'squat', name: 'Присед', muscleGroup: 'legs', inputKind: 'strength', position: 0,
  sets: [{ position: 0, weightKg: 52.5, reps: 10 }, { position: 1, reps: 8 }],
}]

function EditorHarness({ onOpenPicker }: { onOpenPicker: () => void }) {
  const [draft, setDraft] = useState(exercises)
  return <WorkoutExerciseEditor exercises={draft} onChange={setDraft} onOpenPicker={onOpenPicker} onReplaceExercise={vi.fn()} />
}

function ReorderEditorHarness() {
  const [draft, setDraft] = useState<WorkoutExerciseDraft[]>([
    exercises[0]!,
    { source: 'system', ref: 'bench', name: 'Жим лёжа', muscleGroup: 'chest', inputKind: 'strength', position: 1, sets: [{ position: 0 }] },
  ])
  return <WorkoutExerciseEditor exercises={draft} onChange={setDraft} onOpenPicker={vi.fn()} onReplaceExercise={vi.fn()} />
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

    // «Удалить» упражнение теперь в меню «⋯» (редкое действие вне видимости).
    await user.click(screen.getByRole('button', { name: 'Ещё действия' }))
    await user.click(screen.getByRole('menuitem', { name: 'Удалить' }))
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
    expect(screen.getAllByLabelText('Время, сек, подход 1')).toHaveLength(2)
    expect(screen.getByLabelText('Расстояние, подход 1')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Сбросить значения' }))
    expect(onChange.mock.calls.at(-1)?.[0]?.[0]?.sets[0]).toEqual({ position: 0 })
    await user.click(screen.getByRole('button', { name: '+5%' }))
    expect(onChange.mock.calls.at(-1)?.[0]?.[0]?.sets[0]?.weightKg).toBe(55)
    await user.click(screen.getByRole('button', { name: '−5%' }))
    expect(onChange).toHaveBeenCalledTimes(3)
  })

  it('accepts copied factual seconds that are not multiples of 15', () => {
    const copied: WorkoutExerciseDraft[] = [{
      source: 'system', ref: 'running', name: 'Бег', muscleGroup: 'cardio', inputKind: 'distance', position: 0,
      sets: [{ position: 0, durationSec: 25, distanceKm: 4 }],
    }]
    render(<WorkoutExerciseEditor exercises={copied} onChange={vi.fn()} onOpenPicker={vi.fn()} onReplaceExercise={vi.fn()} />)

    expect(screen.getByLabelText('Время, сек, подход 1')).toBeValid()
  })

  it('hides optional rest and comment fields until requested', async () => {
    const user = userEvent.setup()
    render(<EditorHarness onOpenPicker={vi.fn()} />)

    const summary = screen.getByText('Дополнительно')
    const details = summary.closest('details')
    expect(details).not.toHaveAttribute('open')

    await user.click(summary)
    expect(details).toHaveAttribute('open')
    expect(screen.getByLabelText('Отдых между подходами, с')).toBeInTheDocument()
    expect(screen.getByLabelText('Комментарий к упражнению')).toBeInTheDocument()
  })

  it('keeps saved optional details collapsed and shows their compact summary', () => {
    const withDetails: WorkoutExerciseDraft[] = [{
      ...exercises[0]!,
      trainerComment: 'Контролировать технику',
      restBetweenSetsSec: 120,
    }]
    render(<WorkoutExerciseEditor exercises={withDetails} onChange={vi.fn()} onOpenPicker={vi.fn()} onReplaceExercise={vi.fn()} />)

    const details = screen.getByText('Дополнительно').closest('details')
    expect(details).not.toHaveAttribute('open')
    expect(screen.getByText('заметка · отдых 120 с')).toBeInTheDocument()
  })

  it('shows the latest completed result as a compact reference', () => {
    const previousResults = new Map([['squat', {
      workoutDate: localDate('2026-08-04'),
      sets: [{ position: 0, weightKg: 50, reps: 10 }, { position: 1, weightKg: 55, reps: 8 }],
    }]])
    render(<WorkoutExerciseEditor exercises={exercises} onChange={vi.fn()} onOpenPicker={vi.fn()} onReplaceExercise={vi.fn()} previousResults={previousResults} />)

    expect(screen.getByText('В прошлый раз: 55 кг × 8 повт.')).toBeInTheDocument()
  })

  it('keeps RPE hidden until it is requested from the exercise menu', async () => {
    const user = userEvent.setup()
    render(<EditorHarness onOpenPicker={vi.fn()} />)

    expect(screen.queryByLabelText('Целевой RPE, подход 1')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Ещё действия' }))
    await user.click(screen.getByRole('menuitem', { name: 'Указать RPE' }))
    expect(screen.getByLabelText('Целевой RPE, подход 1')).toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('Целевой RPE, подход 1'), '8')
    expect(screen.getByLabelText('Целевой RPE, подход 1')).toHaveValue('8')
  })

  it('uses the trainer RPE preference while keeping a per-exercise override', async () => {
    const user = userEvent.setup()
    render(<WorkoutExerciseEditor exercises={exercises} onChange={vi.fn()} onOpenPicker={vi.fn()} onReplaceExercise={vi.fn()} showRpeByDefault />)

    expect(screen.getByLabelText('Целевой RPE, подход 1')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Ещё действия' }))
    await user.click(screen.getByRole('menuitem', { name: 'Скрыть RPE' }))
    expect(screen.queryByLabelText('Целевой RPE, подход 1')).not.toBeInTheDocument()
  })

  it('shows reorder arrows only in the explicit reorder mode', async () => {
    const user = userEvent.setup()
    render(<ReorderEditorHarness />)

    expect(screen.queryByRole('button', { name: 'Вверх' })).not.toBeInTheDocument()
    await user.click(screen.getAllByRole('button', { name: 'Ещё действия' })[0]!)
    await user.click(screen.getByRole('menuitem', { name: 'Изменить порядок' }))
    expect(screen.getByText('Изменение порядка')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Вверх' })).toHaveLength(2)

    await user.click(screen.getByRole('button', { name: 'Готово' }))
    expect(screen.queryByRole('button', { name: 'Вверх' })).not.toBeInTheDocument()
  })

  it('keeps merging with the next exercise available from the menu', async () => {
    const user = userEvent.setup()
    render(<ReorderEditorHarness />)

    expect(screen.queryByRole('button', { name: '⛓ Объединить со следующим в блок' })).not.toBeInTheDocument()
    await user.click(screen.getAllByRole('button', { name: 'Ещё действия' })[0]!)
    await user.click(screen.getByRole('menuitem', { name: 'Объединить со следующим в блок' }))
    expect(screen.getByLabelText('Тип блока')).toBeInTheDocument()
    expect(screen.getByText('Настройки блока').closest('details')).not.toHaveAttribute('open')
  })
})
