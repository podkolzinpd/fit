import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ExercisePicker, filterExercises } from './ExercisePicker'
import type { ExerciseCatalogState } from './exercise-catalog'
import { SYSTEM_EXERCISES } from '../../shared/system-exercises'

function catalog(overrides: Partial<ExerciseCatalogState> = {}): ExerciseCatalogState {
  return {
    exercises: SYSTEM_EXERCISES,
    loading: false,
    error: null,
    saving: false,
    retry: vi.fn(),
    create: vi.fn(),
    ...overrides,
  }
}

describe('ExercisePicker', () => {
  it('filters the complete catalog by search and category', () => {
    expect(filterExercises(SYSTEM_EXERCISES, 'legs', 'присед').map((exercise) => exercise.name))
      .toEqual(['Болгарский присед', 'Присед со штангой', 'Фронтальный присед'])
    expect(filterExercises(SYSTEM_EXERCISES, 'cardio', '')).toHaveLength(7)
  })

  it('searches exercises in the picker', async () => {
    const user = userEvent.setup()
    render(<ExercisePicker catalog={catalog()} onPick={vi.fn()} onClose={vi.fn()} />)
    await user.type(screen.getByLabelText('Поиск упражнения'), 'болгар')
    expect(screen.getByRole('button', { name: /Болгарский присед/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Жим лёжа/ })).not.toBeInTheDocument()
  })

  it('filters by category and returns the selected exercise', async () => {
    const user = userEvent.setup()
    const onPick = vi.fn()
    render(<ExercisePicker catalog={catalog()} onPick={onPick} onClose={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Кардио' }))
    expect(screen.getByRole('button', { name: /Бег/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Присед со штангой/ })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Бег/ }))
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ ref: 'running' }))
  })

  it('shows loading, error with retry, and empty states', async () => {
    const user = userEvent.setup()
    const retry = vi.fn()
    const { rerender } = render(<ExercisePicker catalog={catalog({ loading: true })} onPick={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByText('Загрузка…')).toBeInTheDocument()
    rerender(<ExercisePicker catalog={catalog({ error: new Error('Не удалось загрузить'), retry })} onPick={vi.fn()} onClose={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Повторить' }))
    expect(retry).toHaveBeenCalledOnce()
    rerender(<ExercisePicker catalog={catalog({ exercises: [] })} onPick={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByText('Ничего не найдено')).toBeInTheDocument()
  })

  it('closes from the overlay and close button', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const { rerender } = render(<ExercisePicker catalog={catalog()} onPick={vi.fn()} onClose={onClose} />)
    const dialog = screen.getByRole('dialog')
    if (!dialog.parentElement) throw new Error('Picker overlay is missing')
    await user.click(dialog.parentElement)
    expect(onClose).toHaveBeenCalledOnce()
    rerender(<ExercisePicker catalog={catalog()} onPick={vi.fn()} onClose={onClose} />)
    await user.click(screen.getByRole('button', { name: 'Закрыть' }))
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('creates a custom strength exercise and picks it', async () => {
    const user = userEvent.setup()
    const created = { source: 'custom', ref: 'custom-1', customExerciseId: 'custom-1', name: 'Тестовое', muscleGroup: 'legs', inputKind: 'strength' } as const
    const create = vi.fn().mockResolvedValue(created)
    const onPick = vi.fn()
    render(<ExercisePicker catalog={catalog({ create })} onPick={onPick} onClose={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: /Создать своё упражнение/ }))
    await user.type(screen.getByPlaceholderText('Например: Болгарский присед'), 'Тестовое')
    await user.click(screen.getByRole('button', { name: 'Ноги' }))
    await user.click(screen.getByRole('button', { name: 'Сохранить упражнение' }))
    expect(create).toHaveBeenCalledWith({ name: 'Тестовое', muscleGroup: 'legs', inputKind: 'strength' })
    expect(onPick).toHaveBeenCalledWith(created)
  })

  it('creates cardio with duration and repetition semantics', async () => {
    const user = userEvent.setup()
    const created = { source: 'custom', ref: 'custom-2', customExerciseId: 'custom-2', name: 'Скакалка 2', muscleGroup: 'cardio', inputKind: 'reps' } as const
    const create = vi.fn().mockResolvedValue(created)
    render(<ExercisePicker catalog={catalog({ create })} onPick={vi.fn()} onClose={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: /Создать своё упражнение/ }))
    await user.type(screen.getByPlaceholderText('Например: Болгарский присед'), 'Скакалка 2')
    await user.click(screen.getByRole('button', { name: 'Кардио' }))
    await user.click(screen.getByRole('button', { name: 'Время + повторы' }))
    await user.click(screen.getByRole('button', { name: 'Сохранить упражнение' }))
    expect(create).toHaveBeenCalledWith({ name: 'Скакалка 2', muscleGroup: 'cardio', inputKind: 'reps' })
  })

  it('keeps the picker open when custom creation fails', async () => {
    const user = userEvent.setup()
    const onPick = vi.fn()
    render(<ExercisePicker catalog={catalog({ create: vi.fn().mockRejectedValue(new Error('Конфликт')) })} onPick={onPick} onClose={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: /Создать своё упражнение/ }))
    await user.type(screen.getByPlaceholderText('Например: Болгарский присед'), 'Дубликат')
    await user.click(screen.getByRole('button', { name: 'Ноги' }))
    await user.click(screen.getByRole('button', { name: 'Сохранить упражнение' }))
    expect(onPick).not.toHaveBeenCalled()
    expect(screen.getByRole('heading', { name: 'Своё упражнение' })).toBeVisible()
  })
})
