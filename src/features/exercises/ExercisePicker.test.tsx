import { fireEvent, render, screen, waitFor } from '@testing-library/react'
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
  { source: 'system', ref: 'a', name: 'Присед (Штанга)', muscleGroup: 'legs', inputKind: 'strength', primaryMuscleDetail: 'Квадрицепс', equipment: 'Штанга', imageUrl: '/squat.jpg', motionImageUrl: '/squat-end.jpg', techniqueVideoUrl: '/squat.mp4', instructions: ['Поставьте стопы устойчиво.', 'Опуститесь и вернитесь вверх.'] },
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

  it('не поднимает разминку и ограничивает первичный DOM каталога', () => {
    render(<ExercisePicker catalog={catalog({ exercises: SYSTEM_EXERCISE_CATALOG })} onPick={vi.fn()} onClose={vi.fn()} />)
    expect(screen.queryByText('Разминка и мобилити')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Показать ещё' })).toBeInTheDocument()
    expect(document.querySelectorAll('.picker-item')).toHaveLength(48)
  })

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
    expect(screen.getAllByRole('button', { name: /Посмотреть технику: Жим лёжа/ })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: /Посмотреть технику: Разгибание ног/ })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: /Посмотреть технику: Присед/ })).toHaveLength(1)
  })

  it('скрывает только системный дубль при новом выборе и оставляет одноимённое упражнение тренера', () => {
    const canonical = SYSTEM_EXERCISE_CATALOG.find((exercise) => exercise.ref === 'barbell-row')!
    const duplicate = SYSTEM_EXERCISE_CATALOG.find((exercise) => exercise.ref === 'fedb-bent-over-barbell-row')!
    const custom: ExerciseSnapshot = {
      source: 'custom', ref: 'custom-row', customExerciseId: 'custom-row',
      name: duplicate.name, muscleGroup: duplicate.muscleGroup, inputKind: duplicate.inputKind,
    }

    render(<ExercisePicker catalog={catalog({ exercises: [canonical, duplicate, custom] })} onPick={vi.fn()} onClose={vi.fn()} />)

    expect(document.querySelector('[data-exercise-ref="barbell-row"]')).toBeInTheDocument()
    expect(document.querySelector('[data-exercise-ref="fedb-bent-over-barbell-row"]')).not.toBeInTheDocument()
    expect(document.querySelector('[data-exercise-ref="custom-row"][data-exercise-source="custom"]')).toBeInTheDocument()
  })

  it('не возвращает скрытый системный дубль через недавние упражнения клиента', () => {
    const duplicate = SYSTEM_EXERCISE_CATALOG.find((exercise) => exercise.ref === 'fedb-bent-over-barbell-row')!

    render(<ExercisePicker catalog={catalog({ exercises: SYSTEM_EXERCISE_CATALOG })} clientRecent={[duplicate]} onPick={vi.fn()} onClose={vi.fn()} />)

    expect(document.querySelector('[data-exercise-ref="fedb-bent-over-barbell-row"]')).not.toBeInTheDocument()
    expect(screen.queryByText('Последние у клиента')).not.toBeInTheDocument()
  })

  it('оставляет статичный запасной кадр в списке, если основной кадр не загрузился', () => {
    render(<ExercisePicker catalog={catalog({ exercises: ENRICHED })} onPick={vi.fn()} onClose={vi.fn()} />)
    const squat = document.querySelector<HTMLElement>('[data-exercise-ref="a"]')!.closest('.picker-item')!
    fireEvent.error(squat.querySelector('img')!)
    expect(squat.querySelector('img')).toHaveAttribute('src', '/squat-end.jpg')
    expect(squat.querySelector('video')).not.toBeInTheDocument()
    expect(squat.querySelector('.exercise-image-motion')).not.toBeInTheDocument()
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

  it('находит новые тренажёры, функциональные движения и мобильность', () => {
    expect(filterExercises(SYSTEM_EXERCISE_CATALOG, 'all', 'лежачий велотренажер')[0]?.ref).toBe('fedb-recumbent-bike')
    expect(filterExercises(SYSTEM_EXERCISE_CATALOG, 'all', 'трэп гриф')[0]?.ref).toBe('fedb-trap-bar-deadlift')
    expect(filterExercises(SYSTEM_EXERCISE_CATALOG, 'all', 'переворот шины')[0]?.ref).toBe('fedb-tire-flip')
    expect(filterExercises(SYSTEM_EXERCISE_CATALOG, 'all', 'мфр задней поверхности бедра')[0]?.ref).toBe('fedb-hamstring-smr')
    expect(filterExercises(SYSTEM_EXERCISE_CATALOG, 'all', 'выход на две')[0]?.ref).toBe('fedb-muscle-up')
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
    expect(screen.getByRole('button', { name: /Посмотреть технику: Присед/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Посмотреть технику: Разгибание ног/ })).not.toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('Мышца'), 'Бицепс бедра')
    expect(screen.getByRole('button', { name: /Посмотреть технику: Сгибание ног/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Посмотреть технику: Разгибание ног/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Фильтры 2' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Сбросить' }))
    expect(screen.getByLabelText('Группа мышц')).toHaveValue('all')
  })

  it('hides filters on search focus and keeps the selected values', async () => {
    const user = userEvent.setup()
    render(<ExercisePicker catalog={catalog({ exercises: ENRICHED })} onPick={vi.fn()} onClose={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Фильтры' }))
    await user.selectOptions(screen.getByLabelText('Группа мышц'), 'legs')
    const searchInput = screen.getByLabelText('Поиск упражнения')
    await user.click(searchInput)
    expect(screen.queryByLabelText('Группа мышц')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Фильтры 1' })).toBeInTheDocument()
    await user.type(searchInput, 'жим')
    expect(screen.getByText('Ничего не найдено')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Сбросить фильтры' })).toBeInTheDocument()
  })

  it('blurs search before opening filters so the keyboard does not cover the panel', async () => {
    const user = userEvent.setup()
    render(<ExercisePicker catalog={catalog({ exercises: ENRICHED })} onPick={vi.fn()} onClose={vi.fn()} />)
    const searchInput = screen.getByLabelText('Поиск упражнения')
    await user.click(searchInput)
    expect(searchInput).toHaveFocus()
    await user.click(screen.getByRole('button', { name: 'Фильтры' }))
    expect(searchInput).not.toHaveFocus()
    expect(screen.getByLabelText('Группа мышц')).toBeVisible()
  })

  it('filters by category and returns the selected exercise', async () => {
    const user = userEvent.setup()
    const onPick = vi.fn()
    render(<ExercisePicker catalog={catalog()} onPick={onPick} onClose={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Фильтры' }))
    await user.selectOptions(screen.getByLabelText('Группа мышц'), 'cardio')
    expect(document.querySelector('[data-exercise-ref="running"]')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Посмотреть технику: Присед со штангой/ })).not.toBeInTheDocument()
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
    expect(screen.getByRole('button', { name: /Посмотреть технику: Бег с высоким подниманием бедра/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Посмотреть технику: Семенящий бег/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Посмотреть технику: Жим лёжа/ })).not.toBeInTheDocument()
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
    expect(screen.getByRole('heading', { name: 'Выберите упражнения' })).toBeInTheDocument()
    expect(document.querySelector('.picker-list [data-exercise-ref]')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Свободный бег/ })).not.toBeInTheDocument()
  }, 45_000)

  it('shows loading, error with retry, and empty states', async () => {
    const user = userEvent.setup()
    const retry = vi.fn()
    const { rerender } = render(<ExercisePicker catalog={catalog({ loading: true })} onPick={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByText('Загрузка…')).toBeInTheDocument()
    rerender(<ExercisePicker catalog={catalog({ error: new Error('Не удалось загрузить'), retry })} onPick={vi.fn()} onClose={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Повторить' }))
    expect(retry).toHaveBeenCalledOnce()
    rerender(<ExercisePicker catalog={catalog({ exercises: [] })} onPick={vi.fn()} onClose={vi.fn()} />)
    expect(screen.queryByText('Ничего не найдено')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Создать упражнение' })).toBeInTheDocument()
  })

  it('offers one clear recovery action when search has no results', async () => {
    const user = userEvent.setup()
    render(<ExercisePicker catalog={catalog({ exercises: ENRICHED })} onPick={vi.fn()} onClose={vi.fn()} />)

    await user.type(screen.getByLabelText('Поиск упражнения'), 'Новое движение')

    expect(screen.getAllByText('Ничего не найдено')).toHaveLength(1)
    await user.click(screen.getByRole('button', { name: 'Создать «Новое движение»' }))
    expect(screen.getByLabelText('Название')).toHaveValue('Новое движение')
  })

  it('очищает поиск крестиком и Escape, не сбрасывая фокус', async () => {
    const user = userEvent.setup()
    render(<ExercisePicker catalog={catalog({ exercises: ENRICHED })} onPick={vi.fn()} onClose={vi.fn()} />)
    const searchInput = screen.getByLabelText('Поиск упражнения')

    await user.type(searchInput, 'Присед')
    await user.click(screen.getByRole('button', { name: 'Очистить поиск' }))
    expect(searchInput).toHaveValue('')
    expect(searchInput).toHaveFocus()

    await user.type(searchInput, 'Жим')
    await user.keyboard('{Escape}')
    expect(searchInput).toHaveValue('')
    expect(searchInput).toHaveFocus()
  })

  it('показывает активные фильтры чипами и снимает их по одному', async () => {
    const user = userEvent.setup()
    render(<ExercisePicker catalog={catalog({ exercises: ENRICHED })} onPick={vi.fn()} onClose={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Фильтры' }))
    await user.selectOptions(screen.getByLabelText('Группа мышц'), 'legs')
    await user.selectOptions(screen.getByLabelText('Мышца'), 'Квадрицепс')
    await user.selectOptions(screen.getByLabelText('Оборудование'), 'Штанга')
    const chips = screen.getByLabelText('Выбранные фильтры')
    expect(chips).toHaveTextContent('Ноги')
    expect(chips).toHaveTextContent('Квадрицепс')
    expect(chips).toHaveTextContent('Штанга')
    expect(screen.getByText('Найдено: 1')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Штанга' }))
    expect(chips).not.toHaveTextContent('Штанга')
    expect(chips).toHaveTextContent('Квадрицепс')
  })

  it('открывает технику без выбора и возвращает сохранённый поиск и scroll', async () => {
    const user = userEvent.setup()
    const onPick = vi.fn()
    render(<ExercisePicker catalog={catalog({ exercises: ENRICHED })} onPick={onPick} onPickMany={vi.fn()} multiple onClose={vi.fn()} />)
    const searchInput = screen.getByLabelText('Поиск упражнения')
    await user.type(searchInput, 'Присед')
    const list = document.querySelector<HTMLElement>('.picker-list')!
    list.scrollTop = 120

    await user.click(screen.getByRole('button', { name: 'Посмотреть технику: Присед (Штанга)' }))
    expect(onPick).not.toHaveBeenCalled()
    expect(screen.getByRole('heading', { name: 'Техника' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Присед (Штанга)' })).toBeInTheDocument()
    expect(screen.getByText('Как выполнять')).toBeInTheDocument()
    expect(document.querySelector('.picker-technique-view video')).toHaveAttribute('src', '/squat.mp4')
    expect(document.querySelector('.picker-technique-view video')).toHaveAttribute('controls')

    await user.click(screen.getByRole('button', { name: 'Назад к выбору' }))
    expect(screen.getByLabelText('Поиск упражнения')).toHaveValue('Присед')
    await waitFor(() => expect(document.querySelector<HTMLElement>('.picker-list')?.scrollTop).toBe(120))
  })

  it('добавляет упражнение из техники явным действием', async () => {
    const user = userEvent.setup()
    render(<ExercisePicker catalog={catalog({ exercises: ENRICHED })} onPick={vi.fn()} onPickMany={vi.fn()} multiple onClose={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Посмотреть технику: Присед (Штанга)' }))
    await user.click(screen.getByRole('button', { name: 'Добавить к выбранным' }))
    expect(screen.getByText('Выбрано: 1')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Убрать: Присед (Штанга)' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('не запускает видео в списке и отмечает значком только настоящее видео', () => {
    const exercises = [
      ENRICHED[0]!,
      { ...ENRICHED[1]!, imageUrl: '/b.jpg', motionImageUrl: '/b-end.jpg' },
    ]
    render(<ExercisePicker catalog={catalog({ exercises })} onPick={vi.fn()} onClose={vi.fn()} />)
    expect(document.querySelectorAll('.picker-list video')).toHaveLength(0)
    expect(document.querySelectorAll('.picker-item-play')).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Посмотреть технику: Присед (Штанга)' }).querySelector('.picker-item-play')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Посмотреть технику: Разгибание ног (Тренажёр)' }).querySelector('.picker-item-play')).not.toBeInTheDocument()
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
    await user.click(screen.getByRole('button', { name: 'Создать упражнение' }))
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
    await user.click(screen.getByRole('button', { name: 'Создать упражнение' }))
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
    await user.click(screen.getByRole('button', { name: 'Создать упражнение' }))
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
    await user.click(screen.getByRole('button', { name: /Выбрать: Присед/ }))
    await user.click(screen.getByRole('button', { name: /Выбрать: Жим лёжа/ }))
    expect(screen.getByText('Выбрано: 2')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Добавить 2' }))
    expect(onPickMany).toHaveBeenCalledWith([
      expect.objectContaining({ ref: 'a' }),
      expect.objectContaining({ ref: 'd' }),
    ])
  })
})
