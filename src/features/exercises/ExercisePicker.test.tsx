import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ExercisePicker, equipmentForSelection, filterExercises, groupsForSelection, musclesForGroup, purposesForSelection } from './ExercisePicker'
import { recentExercisesForClient } from './client-recent-exercises'
import type { ExerciseCatalogState } from './exercise-catalog'
import { SYSTEM_EXERCISE_CATALOG, SYSTEM_EXERCISES } from '../../shared/system-exercises'
import type { ExerciseSnapshot, Workout } from '../../shared/domain'

const prepareExerciseImage = vi.hoisted(() => vi.fn())
vi.mock('./exercise-image', () => ({ prepareExerciseImage }))

// Обогащённая выборка для проверки иерархии
// группа→мышца→оборудование→упражнение.
const ENRICHED: ExerciseSnapshot[] = [
  { source: 'system', ref: 'a', name: 'Присед (Штанга)', muscleGroup: 'legs', inputKind: 'strength', primaryMuscleDetail: 'Квадрицепс', equipment: 'Штанга', imageUrl: '/squat.jpg', motionImageUrl: '/squat-end.jpg', techniqueVideoUrl: '/squat.mp4', instructions: ['Поставьте стопы устойчиво.', 'Опуститесь и вернитесь вверх.'] },
  { source: 'system', ref: 'b', name: 'Разгибание ног (Тренажёр)', muscleGroup: 'legs', inputKind: 'strength', primaryMuscleDetail: 'Квадрицепс', equipment: 'Тренажёр' },
  { source: 'system', ref: 'c', name: 'Сгибание ног (Тренажёр)', muscleGroup: 'legs', inputKind: 'strength', primaryMuscleDetail: 'Бицепс бедра', equipment: 'Тренажёр' },
  { source: 'system', ref: 'd', name: 'Жим лёжа (Штанга)', muscleGroup: 'chest', inputKind: 'strength', primaryMuscleDetail: 'Грудь', equipment: 'Штанга' },
]

const originalLocalStorage = Object.getOwnPropertyDescriptor(window, 'localStorage')
const originalVisualViewport = Object.getOwnPropertyDescriptor(window, 'visualViewport')
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

function PickerDraftHarness({ onPickMany = () => undefined }: { onPickMany?: (exercises: ExerciseSnapshot[]) => void | Promise<void> }) {
  const [open, setOpen] = useState(true)
  const [selectionDraft, setSelectionDraft] = useState<ExerciseSnapshot[]>([])
  return <>
    <button type="button" onClick={() => setOpen(true)}>Открыть каталог</button>
    {open && <ExercisePicker
      catalog={catalog({ exercises: ENRICHED })}
      onPick={vi.fn()}
      onPickMany={async (exercises) => { await onPickMany(exercises); setOpen(false) }}
      selectionDraft={selectionDraft}
      onSelectionDraftChange={setSelectionDraft}
      multiple
      onClose={() => setOpen(false)}
    />}
  </>
}

describe('ExercisePicker', () => {
  it('excludes retired entries from recent and search but keeps used exercises selectable', async () => {
    const user = userEvent.setup()
    const retired = SYSTEM_EXERCISE_CATALOG.find((item) => item.ref === 'fedb-atlas-stones')!
    render(<ExercisePicker catalog={catalog({ exercises: SYSTEM_EXERCISE_CATALOG })} clientRecent={[retired]} onPick={vi.fn()} onClose={vi.fn()} />)
    expect(document.querySelector('[data-exercise-ref="fedb-atlas-stones"]')).not.toBeInTheDocument()
    await user.type(screen.getByLabelText('Поиск упражнения'), retired.name)
    expect(document.querySelector('[data-exercise-ref="fedb-atlas-stones"]')).not.toBeInTheDocument()
    await user.clear(screen.getByLabelText('Поиск упражнения'))
    await user.type(screen.getByLabelText('Поиск упражнения'), 'Жим Брэдфорда стоя')
    expect(document.querySelector('[data-exercise-ref="fedb-standing-bradford-press"]')).toBeInTheDocument()
  })

  it('shows one unified catalog, keeps rare exercises searchable and groups duplicate names', async () => {
    const user = userEvent.setup()
    render(<ExercisePicker catalog={catalog({ exercises: SYSTEM_EXERCISE_CATALOG })} onPick={vi.fn()} onClose={vi.fn()} />)
    expect(screen.queryByLabelText('Раздел каталога')).not.toBeInTheDocument()
    expect(screen.getByText('663 упражнения')).toBeInTheDocument()
    expect(document.querySelector('[data-exercise-ref="fedb-incline-dumbbell-press"]')).toBeInTheDocument()
    expect(document.querySelector('[data-exercise-ref="fedb-incline-dumbbell-press-palms-in"]')).not.toBeInTheDocument()
    await user.type(screen.getByLabelText('Поиск упражнения'), 'тяга гантели одной рукой')
    expect(document.querySelector('[data-exercise-ref="dumbbell-row"]')).toBeInTheDocument()
    expect(document.querySelector('[data-exercise-ref="fedb-one-arm-dumbbell-row"]')).not.toBeInTheDocument()
  })

  it('lets a trainer select the precise variant from one movement card', async () => {
    const user = userEvent.setup()
    const onPick = vi.fn()
    const target = SYSTEM_EXERCISE_CATALOG.find((exercise) => exercise.ref === 'fedb-incline-dumbbell-press')!
    const variant = SYSTEM_EXERCISE_CATALOG.find((exercise) => exercise.name.includes('на наклонной нейтральным хватом'))!
    render(<ExercisePicker catalog={catalog({ exercises: SYSTEM_EXERCISE_CATALOG })} initialSearch={target.name} onPick={onPick} onClose={vi.fn()} />)
    const targetArticle = document.querySelector(`[data-exercise-ref="${target.ref}"]`)?.closest('.picker-item')
    await user.click(targetArticle!.querySelector<HTMLButtonElement>('.picker-item-technique')!)
    const openPlaying = screen.queryByRole('button', { name: `Открыть технику: ${target.name}` })
    if (openPlaying) await user.click(openPlaying)
    await user.selectOptions(screen.getByLabelText('Вариант упражнения'), variant.ref)
    expect(screen.getByRole('heading', { name: variant.name })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Добавить упражнение' }))
    expect(onPick).toHaveBeenCalledWith(variant)
  })

  it('does not lose recording fields when two dip cards have different input kinds', async () => {
    const user = userEvent.setup()
    const onPick = vi.fn()
    render(<ExercisePicker catalog={catalog({ exercises: SYSTEM_EXERCISE_CATALOG })} initialSearch="брусья" onPick={onPick} onClose={vi.fn()} />)
    await user.click(screen.getAllByRole('button', { name: /(?:Посмотреть|Проиграть) технику:/ })[0]!)
    const openPlaying = screen.queryByRole('button', { name: /Открыть технику:/ })
    if (openPlaying) await user.click(openPlaying)
    await user.selectOptions(screen.getByLabelText('Вариант упражнения'), 'fedb-parallel-bar-dip')
    await user.click(screen.getByRole('button', { name: 'Добавить упражнение' }))
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ ref: 'fedb-parallel-bar-dip', inputKind: 'strength' }))
  })

  beforeEach(() => {
    Object.defineProperty(window, 'localStorage', { configurable: true, value: browserStorage })
    browserStorage.clear()
    prepareExerciseImage.mockReset()
    prepareExerciseImage.mockResolvedValue({ dataUrl: 'data:image/jpeg;base64,AQID', mimeType: 'image/jpeg', width: 800, height: 800, sizeBytes: 3 })
  })
  afterEach(() => {
    if (originalLocalStorage) Object.defineProperty(window, 'localStorage', originalLocalStorage)
    else delete (window as { localStorage?: Storage }).localStorage
    if (originalVisualViewport) Object.defineProperty(window, 'visualViewport', originalVisualViewport)
    else delete (window as { visualViewport?: VisualViewport }).visualViewport
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
    expect(screen.getAllByRole('button', { name: /технику: Жим лёжа/ })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: /технику: Разгибание ног/ })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: /технику: Присед/ })).toHaveLength(1)
  })

  it('при поиске поднимает недавнее и пользовательское упражнение, не скрывая остальные', async () => {
    const user = userEvent.setup()
    const system: ExerciseSnapshot = { source: 'system', ref: 'system-row', name: 'Тяга к поясу', muscleGroup: 'back', inputKind: 'strength' }
    const recent: ExerciseSnapshot = { source: 'system', ref: 'recent-row', name: 'Тяга к поясу сидя', muscleGroup: 'back', inputKind: 'strength' }
    const custom: ExerciseSnapshot = { source: 'custom', ref: 'custom-row', customExerciseId: 'custom-row', name: 'Моя тяга к поясу', muscleGroup: 'back', inputKind: 'strength' }

    render(<ExercisePicker catalog={catalog({ exercises: [system, recent, custom] })} clientRecent={[recent]} onPick={vi.fn()} onClose={vi.fn()} />)
    await user.type(screen.getByLabelText('Поиск упражнения'), 'тяга поясу')

    expect([...document.querySelectorAll<HTMLElement>('.picker-item [data-exercise-ref]')].map((node) => node.dataset.exerciseRef))
      .toEqual(['recent-row', 'custom-row', 'system-row'])
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

  it('показывает оборудование глобально и объединяет варианты собственного веса', () => {
    const exercises: ExerciseSnapshot[] = [
      { source: 'system', ref: 'body-a', name: 'Движение A', muscleGroup: 'legs', inputKind: 'reps', equipment: 'Своё тело' },
      { source: 'system', ref: 'body-b', name: 'Движение B', muscleGroup: 'core', inputKind: 'reps', equipment: 'Без оборудования' },
      { source: 'system', ref: 'barbell-a', name: 'Движение C', muscleGroup: 'chest', inputKind: 'strength', equipment: 'Штанга' },
    ]
    expect(equipmentForSelection(exercises, 'all', null)).toEqual(['Без оборудования', 'Штанга'])
    expect(filterExercises(exercises, 'all', '', null, 'Без оборудования').map((exercise) => exercise.ref)).toEqual(['body-a', 'body-b'])
  })

  it('фильтрует каталог по назначению независимо от группы мышц', () => {
    const warmup = filterExercises(SYSTEM_EXERCISE_CATALOG, 'all', '', null, null, 'warmup')
    const mobility = filterExercises(SYSTEM_EXERCISE_CATALOG, 'all', '', null, null, 'mobility')
    const recovery = filterExercises(SYSTEM_EXERCISE_CATALOG, 'all', '', null, null, 'recovery')
    expect(warmup.map((exercise) => exercise.ref)).toContain('joint-warmup')
    expect(mobility.map((exercise) => exercise.ref)).toContain('cat-cow')
    expect(recovery.map((exercise) => exercise.ref)).toContain('vital-gym-pro-1198')
  })

  it('даёт выбрать назначение и оборудование без предварительного выбора группы', async () => {
    const user = userEvent.setup()
    render(<ExercisePicker catalog={catalog({ exercises: SYSTEM_EXERCISE_CATALOG })} onPick={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByLabelText('Оборудование')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Восстановление' }))
    expect(screen.getByRole('button', { name: 'Восстановление' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Сбросить' })).toBeInTheDocument()
    expect(document.querySelector('[data-exercise-ref="vital-gym-pro-1198"]')).toBeInTheDocument()
  })

  it('filters inline: group → muscle → equipment', async () => {
    const user = userEvent.setup()
    render(<ExercisePicker catalog={catalog({ exercises: ENRICHED })} onPick={vi.fn()} onClose={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Ноги' }))
    await user.click(screen.getByRole('button', { name: 'Квадрицепс' }))
    await user.selectOptions(screen.getByLabelText('Оборудование'), 'Штанга')
    expect(screen.getByRole('button', { name: /технику: Присед/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Посмотреть технику: Разгибание ног/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Мышца' })).not.toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('Оборудование'), '')
    await user.click(screen.getByRole('button', { name: 'Бицепс бедра' }))
    expect(screen.getByRole('button', { name: /Посмотреть технику: Сгибание ног/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Посмотреть технику: Разгибание ног/ })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Сбросить' }))
    expect(screen.getByRole('button', { name: 'Ноги' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByLabelText('Оборудование')).toHaveValue('')
  })

  it('сохраняет совместимое оборудование и блокирует группы без результата', async () => {
    const user = userEvent.setup()
    render(<ExercisePicker catalog={catalog({ exercises: ENRICHED })} onPick={vi.fn()} onClose={vi.fn()} />)
    await user.selectOptions(screen.getByLabelText('Оборудование'), 'Тренажёр')
    expect(screen.getByRole('button', { name: 'Грудь' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Ноги' }))
    expect(screen.getByLabelText('Оборудование')).toHaveValue('Тренажёр')
    expect(screen.getByRole('button', { name: 'Ноги' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('пересчитывает фасеты по назначению, группе и оборудованию', () => {
    const recoveryEquipment = equipmentForSelection(SYSTEM_EXERCISE_CATALOG, 'all', null, 'recovery')
    expect(recoveryEquipment).toContain('Без оборудования')
    expect(groupsForSelection(SYSTEM_EXERCISE_CATALOG, 'Без оборудования', 'recovery')).not.toHaveLength(0)
    expect(purposesForSelection(SYSTEM_EXERCISE_CATALOG, 'all', null, 'Без оборудования')).toContain('recovery')
  })

  it('keeps inline filters visible and selected while search is focused', async () => {
    const user = userEvent.setup()
    render(<ExercisePicker catalog={catalog({ exercises: ENRICHED })} onPick={vi.fn()} onClose={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Ноги' }))
    const searchInput = screen.getByLabelText('Поиск упражнения')
    await user.click(searchInput)
    expect(screen.getByRole('group', { name: 'Группа мышц' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Ноги' })).toHaveAttribute('aria-pressed', 'true')
    await user.type(searchInput, 'жим')
    expect(screen.getByText('Ничего не найдено')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Сбросить фильтры' })).toBeInTheDocument()
  })

  it('keeps search focus while inline filters stay reachable', async () => {
    const user = userEvent.setup()
    render(<ExercisePicker catalog={catalog({ exercises: ENRICHED })} onPick={vi.fn()} onClose={vi.fn()} />)
    const searchInput = screen.getByLabelText('Поиск упражнения')
    await user.click(searchInput)
    expect(searchInput).toHaveFocus()
    expect(screen.getByRole('group', { name: 'Группа мышц' })).toBeVisible()
    expect(screen.getByRole('group', { name: 'Тип упражнения' })).toBeVisible()
  })

  it('filters by category and returns the selected exercise', async () => {
    const user = userEvent.setup()
    const onPick = vi.fn()
    render(<ExercisePicker catalog={catalog()} onPick={onPick} onClose={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Кардио' }))
    expect(document.querySelector('[data-exercise-ref="running"]')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Посмотреть технику: Присед со штангой/ })).not.toBeInTheDocument()
    await user.click(document.querySelector<HTMLButtonElement>('[data-exercise-ref="running"]')!)
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ ref: 'running' }))
  })

  it('сразу открывает общий каталог и сохраняет беговые форматы в inline-фильтре', async () => {
    const user = userEvent.setup()
    const onPick = vi.fn()
    render(<ExercisePicker catalog={catalog({ exercises: SYSTEM_EXERCISE_CATALOG })} initialMode="choose" onPick={onPick} onClose={vi.fn()} />)
    expect(screen.getByRole('heading', { name: 'Выберите упражнения' })).toBeInTheDocument()
    expect(screen.getByLabelText('Поиск упражнения')).toBeVisible()
    expect(screen.queryByRole('heading', { name: 'Тип тренировки' })).not.toBeInTheDocument()
    expect([...screen.getByRole('group', { name: 'Группа мышц' }).querySelectorAll('button')].map((button) => button.textContent)).toEqual([
      'Грудь', 'Спина', 'Ноги', 'Ягодицы', 'Плечи', 'Руки', 'Пресс', 'Кардио',
    ])
    expect([...screen.getByRole('group', { name: 'Тип упражнения' }).querySelectorAll('button')].map((button) => button.textContent)).toEqual([
      'Бег', 'Разминка', 'Растяжка', 'Восстановление', 'Только мои',
    ])
    await user.click(screen.getByRole('button', { name: 'Бег' }))
    expect(screen.getByRole('button', { name: 'Бег' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /Свободный бег/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Лёгкий бег/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Длительный бег/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Темповый бег/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Восстановительный бег/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Интервалы/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /технику: Бег с высоким подниманием бедра/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /технику: Семенящий бег/ })).toBeInTheDocument()
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

  it('повторным нажатием на Бег возвращает общий каталог', async () => {
    const user = userEvent.setup()
    render(<ExercisePicker catalog={catalog({ exercises: SYSTEM_EXERCISE_CATALOG })} initialMode="running" onPick={vi.fn()} onClose={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Бег', pressed: true }))
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

  it('показывает активные inline-фильтры и снимает их по одному', async () => {
    const user = userEvent.setup()
    render(<ExercisePicker catalog={catalog({ exercises: ENRICHED })} onPick={vi.fn()} onClose={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Ноги' }))
    await user.click(screen.getByRole('button', { name: 'Квадрицепс' }))
    await user.selectOptions(screen.getByLabelText('Оборудование'), 'Штанга')
    expect(screen.getByRole('button', { name: 'Ноги' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByLabelText('Оборудование')).toHaveValue('Штанга')
    expect(screen.getByText('Найдено: 1')).toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('Оборудование'), '')
    expect(screen.getByRole('button', { name: 'Квадрицепс' })).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: 'Квадрицепс' }))
    expect(screen.getByRole('button', { name: 'Квадрицепс' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('открывает технику без выбора и возвращает сохранённый поиск и scroll', async () => {
    const user = userEvent.setup()
    const onPick = vi.fn()
    render(<ExercisePicker catalog={catalog({ exercises: ENRICHED })} onPick={onPick} onPickMany={vi.fn()} multiple onClose={vi.fn()} />)
    const searchInput = screen.getByLabelText('Поиск упражнения')
    await user.type(searchInput, 'Присед')
    const list = document.querySelector<HTMLElement>('.picker-list')!
    list.scrollTop = 120

    await user.click(screen.getByRole('button', { name: 'Проиграть технику: Присед (Штанга)' }))
    await user.click(screen.getByRole('button', { name: 'Открыть технику: Присед (Штанга)' }))
    expect(onPick).not.toHaveBeenCalled()
    expect(screen.getByRole('heading', { name: 'Техника' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Присед (Штанга)' })).toBeInTheDocument()
    expect(screen.getByText('Как выполнять')).toBeInTheDocument()
    expect(document.querySelector('.picker-technique-view video')).toHaveAttribute('src', '/squat.mp4')
    expect(document.querySelector('.picker-technique-view video')).not.toHaveAttribute('controls')

    await user.click(screen.getByRole('button', { name: 'Назад к выбору' }))
    expect(screen.getByLabelText('Поиск упражнения')).toHaveValue('Присед')
    await waitFor(() => expect(document.querySelector<HTMLElement>('.picker-list')?.scrollTop).toBe(120))
  })

  it('добавляет упражнение из техники явным действием', async () => {
    const user = userEvent.setup()
    render(<ExercisePicker catalog={catalog({ exercises: ENRICHED })} onPick={vi.fn()} onPickMany={vi.fn()} multiple onClose={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Проиграть технику: Присед (Штанга)' }))
    await user.click(screen.getByRole('button', { name: 'Открыть технику: Присед (Штанга)' }))
    await user.click(screen.getByRole('button', { name: 'Добавить к выбранным' }))
    expect(screen.getByText('Выбрано: 1')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Убрать: Присед (Штанга)' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('проигрывает только последнее явно нажатое упражнение в списке', async () => {
    const user = userEvent.setup()
    const exercises = [
      ENRICHED[0]!,
      { ...ENRICHED[1]!, imageUrl: '/b.jpg', motionImageUrl: '/b-end.jpg', techniqueVideoUrl: '/b.mp4' },
    ]
    render(<ExercisePicker catalog={catalog({ exercises })} onPick={vi.fn()} onClose={vi.fn()} />)
    expect(document.querySelectorAll('.picker-list video')).toHaveLength(0)
    await user.click(screen.getByRole('button', { name: 'Проиграть технику: Присед (Штанга)' }))
    expect(document.querySelectorAll('.picker-list video')).toHaveLength(1)
    expect(document.querySelector('.picker-list video')).toHaveAttribute('src', '/squat.mp4')
    await user.click(screen.getByRole('button', { name: 'Проиграть технику: Разгибание ног (Тренажёр)' }))
    expect(document.querySelectorAll('.picker-list video')).toHaveLength(1)
    expect(document.querySelector('.picker-list video')).toHaveAttribute('src', '/b.mp4')
  })

  it('проигрывает новую карточку Gym Pro первым тапом, не открывая технику сразу', async () => {
    const user = userEvent.setup()
    const exercise = SYSTEM_EXERCISE_CATALOG.find(({ ref }) => ref === 'vital-captain-s-chair-leg-raise-ex003')!
    render(<ExercisePicker catalog={catalog({ exercises: SYSTEM_EXERCISE_CATALOG })} initialSearch={exercise.name} onPick={vi.fn()} onClose={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: `Проиграть технику: ${exercise.name}` }))

    expect(screen.queryByRole('heading', { name: 'Техника' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: `Открыть технику: ${exercise.name}` })).toBeInTheDocument()
    expect(document.querySelector('.picker-list video')).toHaveAttribute('src', exercise.techniqueVideoUrl)
  })

  it('проигрывает подобранную анимацию в карточке шрагов без своего ролика', async () => {
    const user = userEvent.setup()
    const exercise = SYSTEM_EXERCISE_CATALOG.find(({ ref }) => ref === 'fedb-cable-shrugs')!
    render(<ExercisePicker catalog={catalog({ exercises: SYSTEM_EXERCISE_CATALOG })} initialSearch={exercise.name} onPick={vi.fn()} onClose={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: `Проиграть технику: ${exercise.name}` }))

    expect(document.querySelector('.picker-list video')).toHaveAttribute(
      'src',
      '/exercises/vital-pro/vital-barbell-shrug-ex029.mp4',
    )
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

  it('does not shrink the overlay to stale visual viewport dimensions', async () => {
    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      value: {
        height: 420,
        offsetTop: 180,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      } as unknown as VisualViewport,
    })

    render(<ExercisePicker catalog={catalog()} onPick={vi.fn()} onClose={vi.fn()} />)
    const dialog = screen.getByRole('dialog')
    if (!dialog.parentElement) throw new Error('Picker overlay is missing')

    await waitFor(() => expect(dialog.parentElement).not.toHaveAttribute('style'))
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
    expect(create).toHaveBeenCalledWith({
      name: 'Тестовое', muscleGroup: 'legs', inputKind: 'strength',
      primaryMuscleDetail: undefined, equipment: undefined, description: undefined,
    }, null)
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
    expect(create).toHaveBeenCalledWith({
      name: 'Скакалка 2', muscleGroup: 'cardio', inputKind: 'reps',
      primaryMuscleDetail: undefined, equipment: undefined, description: undefined,
    }, null)
  })

  it('offers muscle/equipment from the same catalog dictionary as the filter, and sends the picked classification plus description to create()', async () => {
    const user = userEvent.setup()
    const created = { source: 'custom', ref: 'custom-3', customExerciseId: 'custom-3', name: 'Болгарский присед', muscleGroup: 'legs', inputKind: 'strength' } as const
    const create = vi.fn().mockResolvedValue(created)
    render(<ExercisePicker catalog={catalog({ exercises: ENRICHED, create })} onPick={vi.fn()} onClose={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Создать упражнение' }))
    await user.type(screen.getByPlaceholderText('Например: Болгарский присед'), 'Болгарский присед')
    await user.click(screen.getByRole('button', { name: 'Ноги' }))

    expect(screen.getByLabelText('Мышца')).toBeInTheDocument()
    expect(screen.getByLabelText('Оборудование')).toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('Мышца'), 'Квадрицепс')
    await user.selectOptions(screen.getByLabelText('Оборудование'), 'Тренажёр')
    await user.type(screen.getByPlaceholderText('Как выполнять, на что обратить внимание'), 'Задняя нога на скамье.')
    await user.click(screen.getByRole('button', { name: 'Сохранить упражнение' }))

    expect(create).toHaveBeenCalledWith({
      name: 'Болгарский присед', muscleGroup: 'legs', inputKind: 'strength',
      primaryMuscleDetail: 'Квадрицепс', equipment: 'Тренажёр', description: 'Задняя нога на скамье.',
    }, null)
  })

  it('changing the muscle after picking equipment resets the equipment choice, matching the filter panel', async () => {
    const user = userEvent.setup()
    render(<ExercisePicker catalog={catalog({ exercises: ENRICHED })} onPick={vi.fn()} onClose={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Создать упражнение' }))
    await user.click(screen.getByRole('button', { name: 'Ноги' }))
    await user.selectOptions(screen.getByLabelText('Мышца'), 'Квадрицепс')
    await user.selectOptions(screen.getByLabelText('Оборудование'), 'Тренажёр')
    await user.selectOptions(screen.getByLabelText('Мышца'), 'Бицепс бедра')
    expect(screen.getByLabelText('Оборудование')).toHaveValue('')
  })

  it('attaches a cover photo, shows a preview with a remove control, and sends the prepared image to create()', async () => {
    const user = userEvent.setup()
    const created = { source: 'custom', ref: 'custom-4', customExerciseId: 'custom-4', name: 'С фото', muscleGroup: 'legs', inputKind: 'strength' } as const
    const create = vi.fn().mockResolvedValue(created)
    render(<ExercisePicker catalog={catalog({ create })} onPick={vi.fn()} onClose={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Создать упражнение' }))
    await user.type(screen.getByPlaceholderText('Например: Болгарский присед'), 'С фото')
    await user.click(screen.getByRole('button', { name: 'Ноги' }))

    await user.upload(screen.getByLabelText('Выбрать фото'), new File(['photo'], 'cover.png', { type: 'image/png' }))
    expect(await screen.findByAltText('Фото упражнения')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Добавить фото на обложку' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Сохранить упражнение' }))
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'С фото' }),
      { dataUrl: 'data:image/jpeg;base64,AQID', mimeType: 'image/jpeg', width: 800, height: 800, sizeBytes: 3 },
    )
  })

  it('removing an attached photo brings back the attach button and clears it from the next save', async () => {
    const user = userEvent.setup()
    render(<ExercisePicker catalog={catalog()} onPick={vi.fn()} onClose={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Создать упражнение' }))
    await user.upload(screen.getByLabelText('Выбрать фото'), new File(['photo'], 'cover.png', { type: 'image/png' }))
    await screen.findByAltText('Фото упражнения')
    await user.click(screen.getByRole('button', { name: 'Убрать фото' }))
    expect(screen.queryByAltText('Фото упражнения')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Добавить фото на обложку' })).toBeInTheDocument()
  })

  it('shows a clear error and keeps the form usable when the photo cannot be prepared', async () => {
    const user = userEvent.setup()
    prepareExerciseImage.mockRejectedValueOnce(new Error('Фото слишком большое'))
    render(<ExercisePicker catalog={catalog()} onPick={vi.fn()} onClose={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Создать упражнение' }))
    await user.upload(screen.getByLabelText('Выбрать фото'), new File(['huge'], 'huge.png', { type: 'image/png' }))
    expect(await screen.findByText('Фото слишком большое')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Добавить фото на обложку' })).toBeInTheDocument()
  })

  it('resets classification, description and photo when the create form is closed', async () => {
    const user = userEvent.setup()
    render(<ExercisePicker catalog={catalog({ exercises: ENRICHED })} onPick={vi.fn()} onClose={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Создать упражнение' }))
    await user.type(screen.getByPlaceholderText('Например: Болгарский присед'), 'Черновик')
    await user.click(screen.getByRole('button', { name: 'Ноги' }))
    await user.type(screen.getByPlaceholderText('Как выполнять, на что обратить внимание'), 'Заметка')
    await user.upload(screen.getByLabelText('Выбрать фото'), new File(['photo'], 'cover.png', { type: 'image/png' }))
    await screen.findByAltText('Фото упражнения')
    await user.click(screen.getByRole('button', { name: 'Закрыть' }))

    await user.click(screen.getByRole('button', { name: 'Создать упражнение' }))
    expect(screen.getByPlaceholderText('Например: Болгарский присед')).toHaveValue('')
    expect(screen.getByPlaceholderText('Как выполнять, на что обратить внимание')).toHaveValue('')
    expect(screen.queryByAltText('Фото упражнения')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Мышца')).not.toBeInTheDocument()
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

  it('keeps the selection draft after closing and lets the user clear it explicitly', async () => {
    const user = userEvent.setup()
    render(<PickerDraftHarness />)

    await user.click(screen.getByRole('button', { name: /Выбрать: Присед/ }))
    await user.click(screen.getByRole('button', { name: /Выбрать: Жим лёжа/ }))
    expect(screen.getByText('Выбрано: 2')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Закрыть' }))
    await user.click(screen.getByRole('button', { name: 'Открыть каталог' }))
    expect(screen.getByText('Выбрано: 2')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Убрать: Присед/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /Убрать: Жим лёжа/ })).toHaveAttribute('aria-pressed', 'true')

    const overlay = document.querySelector<HTMLElement>('.sheet-overlay')
    if (!overlay) throw new Error('Picker overlay is missing')
    await user.click(overlay)
    await user.click(screen.getByRole('button', { name: 'Открыть каталог' }))
    expect(screen.getByText('Выбрано: 2')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Ноги' }))
    await user.click(screen.getByRole('button', { name: 'Сбросить' }))
    expect(screen.getByText('Выбрано: 2')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Очистить' }))
    expect(screen.queryByText('Выбрано: 2')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Выбрать: Присед/ })).toHaveAttribute('aria-pressed', 'false')
  })

  it('clears the draft only after the selected exercises are added', async () => {
    const user = userEvent.setup()
    const onPickMany = vi.fn()
    render(<PickerDraftHarness onPickMany={onPickMany} />)

    await user.click(screen.getByRole('button', { name: /Выбрать: Присед/ }))
    await user.click(screen.getByRole('button', { name: 'Добавить 1' }))
    expect(onPickMany).toHaveBeenCalledWith([expect.objectContaining({ ref: 'a' })])

    await user.click(screen.getByRole('button', { name: 'Открыть каталог' }))
    expect(screen.queryByText('Выбрано: 1')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Выбрать: Присед/ })).toHaveAttribute('aria-pressed', 'false')
  })
})
