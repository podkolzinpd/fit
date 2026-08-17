import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ExercisePicker, equipmentForSelection, filterExercises, musclesForGroup } from './ExercisePicker'
import { recentExercisesForClient } from './client-recent-exercises'
import type { ExerciseCatalogState } from './exercise-catalog'
import { SYSTEM_EXERCISE_CATALOG, SYSTEM_EXERCISES } from '../../shared/system-exercises'
import type { ExerciseSnapshot, Workout } from '../../shared/domain'

// Обогащённая выборка для проверки иерархии
// группа→мышца→оборудование→упражнение.
const ENRICHED: ExerciseSnapshot[] = [
  { source: 'system', ref: 'a', name: 'Присед (Штанга)', muscleGroup: 'legs', inputKind: 'strength', primaryMuscleDetail: 'Квадрицепс', equipment: 'Штанга' },
  { source: 'system', ref: 'b', name: 'Разгибание ног (Тренажёр)', muscleGroup: 'legs', inputKind: 'strength', primaryMuscleDetail: 'Квадрицепс', equipment: 'Тренажёр' },
  { source: 'system', ref: 'c', name: 'Сгибание ног (Тренажёр)', muscleGroup: 'legs', inputKind: 'strength', primaryMuscleDetail: 'Бицепс бедра', equipment: 'Тренажёр' },
  { source: 'system', ref: 'd', name: 'Жим лёжа (Штанга)', muscleGroup: 'chest', inputKind: 'strength', primaryMuscleDetail: 'Грудь', equipment: 'Штанга' },
]

const originalLocalStorage = Object.getOwnPropertyDescriptor(window, 'localStorage')
const recentStore = new Map<string, string>()
const browserStorage: Storage = {
  get length() { return recentStore.size },
  clear: () => recentStore.clear(),
  getItem: (key) => recentStore.get(key) ?? null,
  key: (index) => [...recentStore.keys()][index] ?? null,
  removeItem: (key) => { recentStore.delete(key) },
  setItem: (key, value) => { recentStore.set(key, value) },
}

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
  beforeEach(() => {
    Object.defineProperty(window, 'localStorage', { configurable: true, value: browserStorage })
    browserStorage.clear()
  })
  afterEach(() => {
    if (originalLocalStorage) Object.defineProperty(window, 'localStorage', originalLocalStorage)
    else delete (window as { localStorage?: Storage }).localStorage
  })

  it('filters the complete catalog by search and category', () => {
    expect(filterExercises(SYSTEM_EXERCISES, 'legs', 'присед').map((exercise) => exercise.name))
      .toEqual(['Присед со штангой', 'Болгарский присед', 'Фронтальный присед'])
    expect(filterExercises(SYSTEM_EXERCISES, 'cardio', '')).toHaveLength(7)
  })

  // Полный каталог содержит 500+ упражнений: в CI его первичный рендер
  // периодически дольше общего лимита unit-тестов, хотя сценарий корректен.
  it('не поднимает разминку и мобилити над остальным каталогом', () => {
    render(<ExercisePicker catalog={catalog({ exercises: SYSTEM_EXERCISE_CATALOG })} onPick={vi.fn()} onClose={vi.fn()} />)
    expect(screen.queryByText('Разминка и мобилити')).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /Суставная разминка/ })).toHaveLength(1)
  }, 10_000)

  it('ставит упражнения клиента по времени последнего использования, а не по частоте', () => {
    const workouts = [
      { workoutDate: '2026-08-01', exercises: [{ source: 'system', ref: 'd' }, { source: 'system', ref: 'a' }] },
      { workoutDate: '2026-07-30', exercises: [{ source: 'system', ref: 'a' }] },
    ] as unknown as Workout[]
    expect(recentExercisesForClient(ENRICHED, workouts).map((exercise) => exercise.ref)).toEqual(['d', 'a'])
  })

  it('показывает клиента, недавние и остальные без дублей', () => {
    window.localStorage.setItem('fit.recent-exercises', JSON.stringify(['b', 'd']))
    render(<ExercisePicker catalog={catalog({ exercises: ENRICHED })} clientRecent={[ENRICHED[3]!]} onPick={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getAllByText(/Последние у клиента|Недавние|Все упражнения/).map((node) => node.textContent))
      .toEqual(['Последние у клиента', 'Недавние', 'Все упражнения'])
    expect(screen.getAllByRole('button', { name: /Жим лёжа/ })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: /Разгибание ног/ })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: /Присед/ })).toHaveLength(1)
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

  it('сводит варианты обычного бега к одному упражнению', () => {
    for (const query of ['интервальный бег', 'лёгкий бег', 'длительный бег', 'темповый бег', 'восстановительный бег']) {
      expect(filterExercises(SYSTEM_EXERCISE_CATALOG, 'all', query)[0]?.ref, query).toBe('running')
    }
    expect(filterExercises(SYSTEM_EXERCISE_CATALOG, 'all', 'интервальный бег').some((exercise) => exercise.ref === 'interval-running')).toBe(false)
  })

  it('понимает распространённый английский ввод и сокращения тренера', () => {
    expect(filterExercises(SYSTEM_EXERCISE_CATALOG, 'all', 'face pull').map((exercise) => exercise.ref)).toContain('fedb-face-pull')
    expect(filterExercises(SYSTEM_EXERCISE_CATALOG, 'all', 'db incline press').map((exercise) => exercise.ref)).toContain('fedb-incline-dumbbell-press')
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
    expect(document.querySelector('[data-exercise-ref="running"]')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Присед со штангой/ })).not.toBeInTheDocument()
    await user.click(document.querySelector<HTMLButtonElement>('[data-exercise-ref="running"]')!)
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ ref: 'running' }))
  })

  it('отделяет ручной вход в силовую и беговую тренировку', async () => {
    const user = userEvent.setup()
    const onPick = vi.fn()
    render(<ExercisePicker catalog={catalog({ exercises: SYSTEM_EXERCISE_CATALOG })} initialMode="choose" onPick={onPick} onClose={vi.fn()} />)
    expect(screen.getByRole('heading', { name: 'Тип тренировки' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Поиск упражнения')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^Бег/ }))
    expect(screen.getByRole('heading', { name: 'Беговая тренировка' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Свободный бег/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Лёгкий бег/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Длительный бег/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Темповый бег/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Восстановительный бег/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Интервалы/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Бег с высоким подниманием бедра/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Семенящий бег/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Жим лёжа/ })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Темповый бег/ }))
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ ref: 'running' }), 'tempo')
  }, 10_000)

  it('показывает интервальные схемы до добавления упражнения', async () => {
    const user = userEvent.setup()
    const onPick = vi.fn()
    render(<ExercisePicker catalog={catalog({ exercises: SYSTEM_EXERCISE_CATALOG })} initialMode="running" onPick={onPick} onClose={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: /^Интервалы/ }))
    expect(screen.getByText('6 × 400 м', { exact: true })).toBeInTheDocument()
    expect(screen.getByText('6 × 400 м + лёгкий бег', { exact: true })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Своя схема/ })).toBeInTheDocument()
    await user.click(document.querySelector<HTMLButtonElement>('[data-running-format="interval-active"]')!)
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ ref: 'running' }), 'interval-active')
  })

  it('переключает беговую ветку обратно на силовую', async () => {
    const user = userEvent.setup()
    render(<ExercisePicker catalog={catalog({ exercises: SYSTEM_EXERCISE_CATALOG })} initialMode="running" onPick={vi.fn()} onClose={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Силовая', pressed: false }))
    expect(screen.getByRole('heading', { name: 'Силовая тренировка' })).toBeInTheDocument()
    expect(document.querySelector('[data-exercise-ref="bench-press"]')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Свободный бег/ })).not.toBeInTheDocument()
  }, 10_000)

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
