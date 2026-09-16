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
const parseWorkout = vi.fn().mockResolvedValue({ items: [], unmatched: [] })

describe('QuickWorkoutEntry circuit input', () => {
  it('сохраняет разобранные значения при выборе упражнения из полного каталога', async () => {
    const onAdd = vi.fn<(exercises: ParsedWorkoutExercise[]) => void>()
    const onOpenCatalog = vi.fn((_search: string, onSelect?: (exercise: ExerciseSnapshot) => void) => onSelect?.(catalog[1]!))
    const remote = vi.fn().mockResolvedValue({
      items: [{ sourceText: 'Присед 3 по 10 30 килограмм', exerciseRef: 'squat', confidence: 0.8, sets: Array.from({ length: 3 }, () => ({ weightKg: 30, reps: 10 })) }],
      unmatched: [],
    })
    render(<QuickWorkoutEntry catalog={catalog} parseWorkout={remote} onAdd={onAdd} onOpenCatalog={onOpenCatalog} />)

    fireEvent.change(screen.getByLabelText('Запись тренировки'), { target: { value: 'Присед 3 по 10 30 килограмм' } })
    fireEvent.click(screen.getByRole('button', { name: 'Разобрать тренировку' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Все варианты' }))

    expect(onOpenCatalog).toHaveBeenCalledWith('Присед', expect.any(Function))
    expect(await screen.findByText('Фронтальный присед')).toBeInTheDocument()
    expect(screen.getByText('3 × 30 кг × 10 повт.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Добавить в план (1)' }))
    expect(onAdd.mock.calls[0]?.[0][0]).toMatchObject({
      exercise: { ref: 'front-squat' },
      hasValues: true,
      sets: Array.from({ length: 3 }, () => ({ weightKg: 30, reps: 10 })),
    })
  })

  it('добавляет явный сет как существующую круговую, не меняя подходы', async () => {
    const onAdd = vi.fn<(exercises: ParsedWorkoutExercise[]) => void>()
    render(<QuickWorkoutEntry catalog={catalog} parseWorkout={parseWorkout} onAdd={onAdd} />)

    fireEvent.change(screen.getByLabelText('Запись тренировки'), {
      target: { value: 'Сет\n- Жим лёжа 3×10 60 кг\n- Планка 2×45 сек' },
    })

    fireEvent.click(screen.getByRole('button', { name: 'Разобрать тренировку' }))
    expect(await screen.findByText('Круговая · 2 упр.')).toBeInTheDocument()
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

  it('не позволяет частично добавить круговую и сохраняет порядок после уточнения', async () => {
    const onAdd = vi.fn<(exercises: ParsedWorkoutExercise[]) => void>()
    render(<QuickWorkoutEntry catalog={catalog} parseWorkout={parseWorkout} onAdd={onAdd} />)

    fireEvent.change(screen.getByLabelText('Запись тренировки'), {
      target: { value: 'Круговая\n- Присед 3×8 80 кг\n- Планка 2×45 сек' },
    })

    fireEvent.click(screen.getByRole('button', { name: 'Разобрать тренировку' }))
    const addButton = await screen.findByRole('button', { name: 'Добавить в план (1)' })
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

  it('оставляет прежнее частичное добавление для обычного текста без маркеров', async () => {
    const onAdd = vi.fn<(exercises: ParsedWorkoutExercise[]) => void>()
    render(<QuickWorkoutEntry catalog={catalog} parseWorkout={parseWorkout} onAdd={onAdd} />)

    fireEvent.change(screen.getByLabelText('Запись тренировки'), {
      target: { value: 'Жим лёжа 3×10 60 кг\nНеизвестное 3×10' },
    })

    fireEvent.click(screen.getByRole('button', { name: 'Разобрать тренировку' }))
    const addButton = await screen.findByRole('button', { name: 'Добавить в план (1)' })
    expect(addButton).toBeEnabled()
    fireEvent.click(addButton)
    expect(onAdd.mock.calls[0]?.[0]).toHaveLength(1)
  })

  it('использует серверный разбор для оговорок так же, как главная', async () => {
    const onAdd = vi.fn<(exercises: ParsedWorkoutExercise[]) => void>()
    const remote = vi.fn().mockResolvedValue({
      items: [{ sourceText: 'Джим лежа 3 по 10 100 килограмм', exerciseRef: 'bench', confidence: 0.99, sets: Array.from({ length: 3 }, () => ({ weightKg: 100, reps: 10 })) }],
      unmatched: [],
    })
    render(<QuickWorkoutEntry catalog={catalog} parseWorkout={remote} onAdd={onAdd} />)

    fireEvent.change(screen.getByLabelText('Запись тренировки'), { target: { value: 'Джим лежа 3 по 10 100 килограмм' } })
    fireEvent.click(screen.getByRole('button', { name: 'Разобрать тренировку' }))
    expect(await screen.findByText('3 × 100 кг × 10 повт.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Добавить в план (1)' }))
    expect(onAdd.mock.calls[0]?.[0][0]).toMatchObject({ exercise: { ref: 'bench' }, sets: Array.from({ length: 3 }, () => ({ weightKg: 100, reps: 10 })) })
  })
})
