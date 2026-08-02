import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ExercisePicker, equipmentForSelection, filterExercises, musclesForGroup } from './ExercisePicker'
import { frequentExercisesForClient } from './frequent-exercises'
import type { ExerciseCatalogState } from './exercise-catalog'
import { SYSTEM_EXERCISES } from '../../shared/system-exercises'
import type { ExerciseSnapshot, Workout } from '../../shared/domain'

// Обогащённая выборка для проверки иерархии
// группа→мышца→оборудование→упражнение.
const ENRICHED: ExerciseSnapshot[] = [
  { source: 'system', ref: 'a', name: 'Присед (Штанга)', muscleGroup: 'legs', inputKind: 'strength', primaryMuscleDetail: 'Квадрицепс', equipment: 'Штанга' },
  { source: 'system', ref: 'b', name: 'Разгибание ног (Тренажёр)', muscleGroup: 'legs', inputKind: 'strength', primaryMuscleDetail: 'Квадрицепс', equipment: 'Тренажёр' },
  { source: 'system', ref: 'c', name: 'Сгибание ног (Тренажёр)', muscleGroup: 'legs', inputKind: 'strength', primaryMuscleDetail: 'Бицепс бедра', equipment: 'Тренажёр' },
  { source: 'system', ref: 'd', name: 'Жим лёжа (Штанга)', muscleGroup: 'chest', inputKind: 'strength', primaryMuscleDetail: 'Грудь', equipment: 'Штанга' },
]

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

  it('ставит частые упражнения клиента выше остальных по числу использований', () => {
    const workouts = [
      { workoutDate: '2026-08-01', exercises: [{ source: 'system', ref: 'd' }, { source: 'system', ref: 'a' }] },
      { workoutDate: '2026-07-30', exercises: [{ source: 'system', ref: 'a' }] },
    ] as unknown as Workout[]
    expect(frequentExercisesForClient(ENRICHED, workouts).map((exercise) => exercise.ref)).toEqual(['a', 'd'])
  })

  it('ищет по словам в любом порядке, оборудованию и без различия е/ё', () => {
    expect(filterExercises(ENRICHED, 'all', 'штанга жим').map((exercise) => exercise.ref)).toEqual(['d'])
    expect(filterExercises(ENRICHED, 'all', 'тренажер ноги').map((exercise) => exercise.ref)).toEqual(['b', 'c'])
  })

  it('понимает тренерские синонимы и одну опечатку в длинном слове', () => {
    expect(filterExercises(ENRICHED, 'all', 'брусья').map((exercise) => exercise.ref)).toEqual([])
    expect(filterExercises(SYSTEM_EXERCISES, 'all', 'брусья').map((exercise) => exercise.ref)).toContain('dips')
    expect(filterExercises(SYSTEM_EXERCISES, 'all', 'гиперы').map((exercise) => exercise.ref)).toContain('hyperextension')
    expect(filterExercises(SYSTEM_EXERCISES, 'all', 'присд штангой').map((exercise) => exercise.ref)).toContain('barbell-squat')
  })

  it('строит список мышц группы по частоте и фильтрует по мышце', () => {
    expect(musclesForGroup(ENRICHED, 'legs')).toEqual(['Квадрицепс', 'Бицепс бедра'])
    expect(musclesForGroup(ENRICHED, 'chest')).toEqual(['Грудь'])
    expect(filterExercises(ENRICHED, 'legs', '', 'Квадрицепс').map((exercise) => exercise.ref)).toEqual(['a', 'b'])
    expect(filterExercises(ENRICHED, 'legs', '', 'Бицепс бедра').map((exercise) => exercise.ref)).toEqual(['c'])
  })

  it('строит список оборудования и фильтрует выбранную мышцу по оборудованию', () => {
    expect(equipmentForSelection(ENRICHED, 'legs', null)).toEqual(['Тренажёр', 'Штанга'])
    expect(equipmentForSelection(ENRICHED, 'legs', 'Квадрицепс')).toEqual(['Тренажёр', 'Штанга'])
    expect(equipmentForSelection(ENRICHED, 'legs', 'Бицепс бедра')).toEqual(['Тренажёр'])
    expect(filterExercises(ENRICHED, 'legs', '', 'Квадрицепс', 'Штанга').map((exercise) => exercise.ref)).toEqual(['a'])
  })

  it('filters from one compact panel: group → muscle → equipment', async () => {
    const user = userEvent.setup()
    render(<ExercisePicker catalog={catalog({ exercises: ENRICHED })} onPick={vi.fn()} onClose={vi.fn()} />)
    expect(screen.queryByLabelText('Группа мышц')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Фильтры' }))
    await user.selectOptions(screen.getByLabelText('Группа мышц'), 'legs')
    await user.selectOptions(screen.getByLabelText('Мышца'), 'Квадрицепс')
    await user.selectOptions(screen.getByLabelText('Оборудование'), 'Штанга')
    expect(screen.getByRole('button', { name: /Присед/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Разгибание ног/ })).not.toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('Мышца'), 'Бицепс бедра')
    expect(screen.getByRole('button', { name: /Сгибание ног/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Разгибание ног/ })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Сбросить фильтры' }))
    expect(screen.getByLabelText('Группа мышц')).toHaveValue('all')
  })

  it('keeps search first and combines it with explicit filters', async () => {
    const user = userEvent.setup()
    render(<ExercisePicker catalog={catalog({ exercises: ENRICHED })} onPick={vi.fn()} onClose={vi.fn()} />)
    await user.type(screen.getByLabelText('Поиск упражнения'), 'жим')
    expect(screen.queryByLabelText('Группа мышц')).not.toBeInTheDocument()
    expect(screen.getByText('Найдено: 1')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Жим лёжа/ })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Фильтры' }))
    await user.selectOptions(screen.getByLabelText('Группа мышц'), 'legs')
    expect(screen.getByText('Совпадений нет')).toBeInTheDocument()
  })

  it('filters by category and returns the selected exercise', async () => {
    const user = userEvent.setup()
    const onPick = vi.fn()
    render(<ExercisePicker catalog={catalog()} onPick={onPick} onClose={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Фильтры' }))
    await user.selectOptions(screen.getByLabelText('Группа мышц'), 'cardio')
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
    await user.click(screen.getByRole('button', { name: /Создать своё/ }))
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
    await user.click(screen.getByRole('button', { name: /Создать своё/ }))
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
    await user.click(screen.getByRole('button', { name: /Создать своё/ }))
    await user.type(screen.getByPlaceholderText('Например: Болгарский присед'), 'Дубликат')
    await user.click(screen.getByRole('button', { name: 'Ноги' }))
    await user.click(screen.getByRole('button', { name: 'Сохранить упражнение' }))
    expect(onPick).not.toHaveBeenCalled()
    expect(screen.getByRole('heading', { name: 'Своё упражнение' })).toBeVisible()
  })

  it('selects several exercises and adds them in one action', async () => {
    const user = userEvent.setup()
    const onPickMany = vi.fn()
    render(<ExercisePicker catalog={catalog({ exercises: ENRICHED })} onPick={vi.fn()} onPickMany={onPickMany} multiple onClose={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: /Присед/ }))
    await user.click(screen.getByRole('button', { name: /Жим лёжа/ }))
    expect(screen.getByText('Выбрано: 2')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Добавить 2' }))
    expect(onPickMany).toHaveBeenCalledWith([
      expect.objectContaining({ ref: 'a' }),
      expect.objectContaining({ ref: 'd' }),
    ])
  })
})
