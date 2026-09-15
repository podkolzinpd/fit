import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ExerciseSnapshot } from '../../shared/domain'
import { QuickWorkoutEntry } from './QuickWorkoutEntry'
import type { ParsedWorkoutExercise } from './quick-workout-entry'

const catalog: ExerciseSnapshot[] = [
  { source: 'system', ref: 'squat', name: 'Присед со штангой', muscleGroup: 'legs', inputKind: 'strength' },
  { source: 'system', ref: 'front-squat', name: 'Фронтальный присед', muscleGroup: 'legs', inputKind: 'strength' },
  { source: 'system', ref: 'bench', name: 'Жим лёжа', muscleGroup: 'chest', inputKind: 'strength' },
  { source: 'system', ref: 'plank', name: 'Планка', muscleGroup: 'core', inputKind: 'duration' },
]

describe('QuickWorkoutEntry circuit input', () => {
  it('добавляет явный сет как существующую круговую, не меняя подходы', () => {
    const onAdd = vi.fn<(exercises: ParsedWorkoutExercise[]) => void>()
    render(<QuickWorkoutEntry catalog={catalog} onAdd={onAdd} />)

    fireEvent.change(screen.getByLabelText('Запись тренировки'), {
      target: { value: 'Сет\n- Жим лёжа 3×10 60 кг\n- Планка 2×45 сек' },
    })

    expect(screen.getByText('Круговая · 2 упр.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Добавить в план (2)' }))

    expect(onAdd).toHaveBeenCalledOnce()
    const added = onAdd.mock.calls[0]![0]
    expect(added.map((item) => item.exercise.ref)).toEqual(['bench', 'plank'])
    expect(added[0]!.sets).toHaveLength(3)
    expect(added[1]!.sets).toHaveLength(2)
    expect(added[0]!.structure).toEqual({
      blockId: added[1]!.structure!.blockId,
      blockType: 'group',
      blockPreset: 'circuit',
      blockRounds: 3,
      restBetweenExercisesSec: 15,
      restBetweenRoundsSec: 60,
    })
  })

  it('не позволяет частично добавить круговую и сохраняет порядок после уточнения', () => {
    const onAdd = vi.fn<(exercises: ParsedWorkoutExercise[]) => void>()
    render(<QuickWorkoutEntry catalog={catalog} onAdd={onAdd} />)

    fireEvent.change(screen.getByLabelText('Запись тренировки'), {
      target: { value: 'Круговая\n- Присед 3×8 80 кг\n- Планка 2×45 сек' },
    })

    const addButton = screen.getByRole('button', { name: 'Добавить в план (1)' })
    expect(addButton).toBeDisabled()
    fireEvent.click(addButton)
    expect(onAdd).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Присед со штангой' }))
    fireEvent.click(screen.getByRole('button', { name: 'Добавить в план (2)' }))

    expect(onAdd).toHaveBeenCalledOnce()
    const added = onAdd.mock.calls[0]![0]
    expect(added.map((item) => item.exercise.ref)).toEqual(['squat', 'plank'])
    expect(added[0]!.structure!.blockId).toBe(added[1]!.structure!.blockId)
  })

  it('оставляет прежнее частичное добавление для обычного текста без маркеров', () => {
    const onAdd = vi.fn<(exercises: ParsedWorkoutExercise[]) => void>()
    render(<QuickWorkoutEntry catalog={catalog} onAdd={onAdd} />)

    fireEvent.change(screen.getByLabelText('Запись тренировки'), {
      target: { value: 'Жим лёжа 3×10 60 кг\nНеизвестное 3×10' },
    })

    const addButton = screen.getByRole('button', { name: 'Добавить в план (1)' })
    expect(addButton).toBeEnabled()
    fireEvent.click(addButton)
    expect(onAdd.mock.calls[0]?.[0]).toHaveLength(1)
  })
})
