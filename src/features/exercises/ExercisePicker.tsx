import { useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent } from 'react'
import type { ExerciseSnapshot, InputKind, MuscleGroup } from '../../shared/domain'
import { CloseIcon } from '../../shared/icons'
import { ExerciseImage } from './ExerciseImage'
import { CONTINUOUS_RUNNING_FORMATS, INTERVAL_RUNNING_FORMATS, type RunningFormat } from '../../shared/running-formats'
import { MUSCLE_GROUP_LABELS, MUSCLE_GROUPS, RUNNING_EXERCISE_REFS } from '../../shared/system-exercises'
import type { ExerciseCatalogState } from './exercise-catalog'
import { matchesExerciseSearch, rankExerciseSearch } from './exercise-search'
import { readRecentKeys, recordRecent, resolveRecent } from './recent-exercises'

export function filterExercises(
  exercises: readonly ExerciseSnapshot[],
  category: 'all' | MuscleGroup,
  search: string,
  muscle: string | null = null,
  equipment: string | null = null,
): readonly ExerciseSnapshot[] {
  const allowed = exercises
    .filter((exercise) => {
      return (category === 'all' || exercise.muscleGroup === category)
        && (!muscle || exercise.primaryMuscleDetail === muscle)
        && (!equipment || exercise.equipment === equipment)
    })
  if (!search.trim()) return allowed.sort((left, right) => left.name.localeCompare(right.name, 'ru'))
  return rankExerciseSearch(allowed, search)
    .filter(({ exercise }) => matchesExerciseSearch(exercise, search))
    .map(({ exercise }) => exercise)
}

// Детальные мышцы выбранной группы (2-й уровень иерархии), по частоте.
export function musclesForGroup(
  exercises: readonly ExerciseSnapshot[],
  group: MuscleGroup,
): string[] {
  const counts = new Map<string, number>()
  for (const exercise of exercises) {
    if (exercise.muscleGroup !== group || !exercise.primaryMuscleDetail) continue
    counts.set(exercise.primaryMuscleDetail, (counts.get(exercise.primaryMuscleDetail) ?? 0) + 1)
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ru')).map(([name]) => name)
}

// Оборудование для выбранной группы/мышцы (3-й уровень иерархии), по частоте.
export function equipmentForSelection(
  exercises: readonly ExerciseSnapshot[],
  group: MuscleGroup,
  muscle: string | null,
): string[] {
  const counts = new Map<string, number>()
  for (const exercise of exercises) {
    if (exercise.muscleGroup !== group || (muscle && exercise.primaryMuscleDetail !== muscle) || !exercise.equipment) continue
    counts.set(exercise.equipment, (counts.get(exercise.equipment) ?? 0) + 1)
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ru')).map(([name]) => name)
}

interface ExercisePickerProps {
  catalog: ExerciseCatalogState
  clientRecent?: readonly ExerciseSnapshot[]
  onPick: (exercise: ExerciseSnapshot, runningFormat?: RunningFormat) => void
  onPickMany?: (exercises: ExerciseSnapshot[]) => void
  multiple?: boolean
  initialSearch?: string
  initialMode?: ExercisePickerMode
  onClose: () => void
}

export type ExercisePickerMode = 'choose' | 'strength' | 'running' | 'all'

function matchesPickerMode(exercise: ExerciseSnapshot, mode: Exclude<ExercisePickerMode, 'choose'>) {
  if (mode === 'all') return true
  const running = RUNNING_EXERCISE_REFS.has(exercise.ref)
  return mode === 'running' ? running : !running
}

function pickerTitle(mode: Exclude<ExercisePickerMode, 'choose'>) {
  if (mode === 'running') return 'Беговая тренировка'
  return 'Выберите упражнения'
}

function exerciseKey(exercise: ExerciseSnapshot) {
  return `${exercise.source}:${exercise.ref}`
}

function exerciseCountLabel(count: number) {
  const lastTwo = count % 100
  const last = count % 10
  if (lastTwo >= 11 && lastTwo <= 14) return `${count} упражнений`
  if (last === 1) return `${count} упражнение`
  if (last >= 2 && last <= 4) return `${count} упражнения`
  return `${count} упражнений`
}

function useVisualViewportStyle() {
  const [style, setStyle] = useState<CSSProperties>()
  const [keyboardOpen, setKeyboardOpen] = useState(false)
  useEffect(() => {
    const viewport = window.visualViewport
    if (!viewport) return
    const update = () => {
      setStyle({ top: viewport.offsetTop, height: viewport.height })
      setKeyboardOpen(viewport.height < window.innerHeight - 120)
    }
    update()
    viewport.addEventListener('resize', update)
    viewport.addEventListener('scroll', update)
    return () => {
      viewport.removeEventListener('resize', update)
      viewport.removeEventListener('scroll', update)
    }
  }, [])
  return { style, keyboardOpen }
}

export function ExercisePicker({ catalog, clientRecent = [], onPick, onPickMany, multiple = false, initialSearch = '', initialMode = 'all', onClose }: ExercisePickerProps) {
  const [mode, setMode] = useState<ExercisePickerMode>(initialSearch.trim() ? 'all' : initialMode)
  const [runningStep, setRunningStep] = useState<'formats' | 'intervals'>('formats')
  const [category, setCategory] = useState<'all' | MuscleGroup>('all')
  const [muscle, setMuscle] = useState<string | null>(null)
  const [equipment, setEquipment] = useState<string | null>(null)
  const [search, setSearch] = useState(initialSearch)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const [customOnly, setCustomOnly] = useState(false)
  const [selected, setSelected] = useState<Map<string, ExerciseSnapshot>>(() => new Map())
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [group, setGroup] = useState<MuscleGroup | null>(null)
  const [inputKind, setInputKind] = useState<InputKind>('distance')
  const { style: viewportStyle, keyboardOpen } = useVisualViewportStyle()
  const activeMode = mode === 'choose' ? 'all' : mode
  const filtered = useMemo(
    () => filterExercises(catalog.exercises, category, search, muscle, equipment)
      .filter((exercise) => matchesPickerMode(exercise, activeMode))
      .filter((exercise) => !customOnly || exercise.source === 'custom'),
    [activeMode, catalog.exercises, category, search, muscle, equipment, customOnly],
  )
  // Детальные мышцы выбранной группы (2-й уровень). Показываем, если их >1.
  const muscles = useMemo(
    () => (category === 'all' ? [] : musclesForGroup(catalog.exercises, category)),
    [catalog.exercises, category],
  )
  const equipmentOptions = useMemo(
    () => (category === 'all' ? [] : equipmentForSelection(catalog.exercises, category, muscle)),
    [catalog.exercises, category, muscle],
  )
  const hasFilters = category !== 'all' || muscle !== null || equipment !== null || customOnly
  const activeFilterCount = [category !== 'all', muscle !== null, equipment !== null, customOnly].filter(Boolean).length
  const runningExercise = useMemo(() => catalog.exercises.find((exercise) => exercise.ref === 'running'), [catalog.exercises])
  const runningDrills = useMemo(
    () => catalog.exercises.filter((exercise) => exercise.ref !== 'running' && RUNNING_EXERCISE_REFS.has(exercise.ref)),
    [catalog.exercises],
  )
  const showRunningFormats = activeMode === 'running' && !search.trim() && !hasFilters
  const promotedClient = useMemo(
    () => (!hasFilters && !search.trim() ? clientRecent.filter((exercise) => matchesPickerMode(exercise, activeMode)) : []),
    [activeMode, clientRecent, hasFilters, search],
  )
  const recent = useMemo(() => {
    if (hasFilters || search.trim()) return []
    const clientKeys = new Set(promotedClient.map(exerciseKey))
    return resolveRecent(readRecentKeys(), catalog.exercises)
      .filter((exercise) => matchesPickerMode(exercise, activeMode))
      .filter((exercise) => !clientKeys.has(exerciseKey(exercise)))
  }, [activeMode, catalog.exercises, hasFilters, promotedClient, search])
  const listExercises = useMemo(
    () => {
      if (hasFilters || search.trim()) return filtered
      const promotedKeys = new Set([...promotedClient, ...recent].map(exerciseKey))
      return filtered.filter((exercise) => !promotedKeys.has(exerciseKey(exercise)))
    },
    [filtered, hasFilters, promotedClient, recent, search],
  )
  function pick(exercise: ExerciseSnapshot) {
    if (!multiple) {
      recordRecent(exercise)
      onPick(exercise)
      return
    }
    const key = exerciseKey(exercise)
    setSelected((current) => {
      const next = new Map(current)
      if (next.has(key)) next.delete(key)
      else next.set(key, exercise)
      return next
    })
  }
  function addSelected() {
    const exercises = [...selected.values()]
    exercises.forEach(recordRecent)
    onPickMany?.(exercises)
  }
  function pickRunningFormat(format: RunningFormat) {
    if (!runningExercise) return
    recordRecent(runningExercise)
    onPick(runningExercise, format)
  }
  function resetFilters() {
    setCategory('all')
    setMuscle(null)
    setEquipment(null)
    setCustomOnly(false)
  }
  function toggleFilters() {
    if (!filtersOpen) searchRef.current?.blur()
    setFiltersOpen((value) => !value)
  }
  function selectMode(next: Exclude<ExercisePickerMode, 'choose'>) {
    setMode(next)
    setRunningStep('formats')
    setCategory('all')
    setMuscle(null)
    setEquipment(null)
    setCustomOnly(false)
  }
  // Одна строка списка (используется и для недавних, и для основного списка).
  function item(exercise: ExerciseSnapshot, keyPrefix: string) {
    const checked = selected.has(exerciseKey(exercise))
    return <button type="button" aria-pressed={multiple ? checked : undefined} className={`picker-item${checked ? ' selected' : ''}`} data-exercise-ref={exercise.ref} data-exercise-source={exercise.source} key={`${keyPrefix}-${exercise.source}-${exercise.ref}`} onClick={() => pick(exercise)}><ExerciseImage src={exercise.imageUrl} /><span className="picker-item-copy"><span className="picker-item-name">{exercise.name}</span><small>{[exercise.equipment, MUSCLE_GROUP_LABELS[exercise.muscleGroup]].filter(Boolean).join(' · ')}</small></span>{multiple && <span className="picker-select-mark" aria-hidden="true">{checked ? '✓' : '＋'}</span>}</button>
  }
  // Выбор группы сбрасывает выбранную мышцу (иначе останется от прошлой группы).
  function selectGroup(next: 'all' | MuscleGroup) { setCategory(next); setMuscle(null); setEquipment(null) }
  function selectMuscle(next: string | null) { setMuscle(next); setEquipment(null) }
  function stopPropagation(event: MouseEvent) { event.stopPropagation() }
  async function createExercise() {
    if (!name.trim() || !group) return
    try {
      const exercise = await catalog.create({
        name: name.trim(), muscleGroup: group, inputKind: group === 'cardio' ? inputKind : 'strength',
      })
      pick(exercise)
      if (multiple) {
        setCreating(false)
        setName('')
        setGroup(null)
      }
    } catch {
      // Mutation state exposes the normalized repository error in the picker.
    }
  }

  return <div className={`sheet-overlay${keyboardOpen ? ' keyboard-open' : ''}`} style={viewportStyle} onClick={onClose}>
    <section className={`exercise-picker${selected.size ? ' has-selection' : ''}`} role="dialog" aria-modal="true" aria-label="Добавить упражнение" onClick={stopPropagation}>
      <header className="picker-header"><h1>{creating ? 'Своё упражнение' : mode === 'choose' ? 'Тип тренировки' : pickerTitle(activeMode)}</h1><button type="button" className="picker-close" aria-label="Закрыть" onClick={creating ? () => setCreating(false) : onClose}><CloseIcon /></button></header>
      {mode === 'choose' && !creating ? <div className="workout-kind-entry">
        <p>Выберите направление — его можно сменить позже.</p>
        <button type="button" className="workout-kind-option" onClick={() => selectMode('strength')}><strong>Силовая</strong><span>Силовые, функциональные и упражнения в зале</span></button>
        <button type="button" className="workout-kind-option" onClick={() => selectMode('running')}><strong>Бег</strong><span>Пробежка, интервалы, активное восстановление и СБУ</span></button>
        <button type="button" className="link workout-kind-all" onClick={() => selectMode('all')}>Открыть все упражнения</button>
      </div> : creating ? <div className="stack">
        <label className="field">Название<input value={name} onChange={(event) => setName(event.target.value)} placeholder="Например: Болгарский присед" /></label>
        <div className="picker-categories" aria-label="Группа мышц">{MUSCLE_GROUPS.map((item) => <button type="button" key={item} className={group === item ? 'picker-category active' : 'picker-category'} onClick={() => setGroup(item)}>{MUSCLE_GROUP_LABELS[item]}</button>)}</div>
        {group === 'cardio' && <div className="picker-categories"><button type="button" className={inputKind === 'distance' ? 'picker-category active' : 'picker-category'} onClick={() => setInputKind('distance')}>Время + дистанция</button><button type="button" className={inputKind === 'reps' ? 'picker-category active' : 'picker-category'} onClick={() => setInputKind('reps')}>Время + повторы</button></div>}
        {catalog.error && <p className="error">{catalog.error.message}</p>}
        <button type="button" disabled={catalog.saving || !name.trim() || !group} onClick={() => void createExercise()}>{catalog.saving ? 'Сохранение…' : 'Сохранить упражнение'}</button>
      </div> : <>
        <div className="workout-kind-tabs" role="group" aria-label="Направление тренировки"><button type="button" aria-pressed={activeMode === 'strength'} className={activeMode === 'strength' ? 'active' : ''} onClick={() => selectMode('strength')}>Силовая</button><button type="button" aria-pressed={activeMode === 'running'} className={activeMode === 'running' ? 'active' : ''} onClick={() => selectMode('running')}>Бег</button><button type="button" aria-pressed={activeMode === 'all'} className={activeMode === 'all' ? 'active' : ''} onClick={() => selectMode('all')}>Все</button></div>
        <div className="picker-search-row"><input ref={searchRef} className="picker-search" aria-label="Поиск упражнения" placeholder={activeMode === 'running' ? 'Бег или СБУ' : 'Название упражнения'} value={search} onFocus={() => setFiltersOpen(false)} onChange={(event) => setSearch(event.target.value)} /><button type="button" className={`picker-filter-toggle${hasFilters ? ' active' : ''}`} aria-expanded={filtersOpen} onClick={toggleFilters}>Фильтры{activeFilterCount ? ` ${activeFilterCount}` : ''}</button></div>
        {filtersOpen && <div className="picker-filter-panel">
          <label>Группа<select aria-label="Группа мышц" value={category} onChange={(event) => selectGroup(event.target.value as 'all' | MuscleGroup)}><option value="all">Все группы</option>{MUSCLE_GROUPS.map((item) => <option key={item} value={item}>{MUSCLE_GROUP_LABELS[item]}</option>)}</select></label>
          {category !== 'all' && muscles.length > 1 && <label>Мышца<select aria-label="Мышца" value={muscle ?? ''} onChange={(event) => selectMuscle(event.target.value || null)}><option value="">Все мышцы</option>{muscles.map((item) => <option key={item}>{item}</option>)}</select></label>}
          {category !== 'all' && equipmentOptions.length > 1 && <label>Оборудование<select aria-label="Оборудование" value={equipment ?? ''} onChange={(event) => setEquipment(event.target.value || null)}><option value="">Всё оборудование</option>{equipmentOptions.map((item) => <option key={item}>{item}</option>)}</select></label>}
          <div className="picker-filter-actions"><label className="picker-custom-filter"><input type="checkbox" checked={customOnly} onChange={(event) => setCustomOnly(event.target.checked)} />Только мои</label>{hasFilters && <button type="button" className="link" onClick={resetFilters}>Сбросить</button>}</div>
        </div>}
        {showRunningFormats ? <div className="running-format-picker">
          {catalog.loading && <p className="state">Загрузка…</p>}
          {catalog.error && <div className="state"><p className="error">{catalog.error.message}</p><button type="button" className="secondary" onClick={catalog.retry}>Повторить</button></div>}
          {runningStep === 'formats' ? <>
            <div className="running-format-heading"><p className="picker-section-label">Формат бега</p><span>Выберите основу тренировки. Значения можно изменить после добавления.</span></div>
            <div className="running-format-list">
              {CONTINUOUS_RUNNING_FORMATS.map((option) => <button type="button" className="running-format-option" data-running-format={option.format} data-exercise-ref={option.format === 'free' ? 'running' : undefined} disabled={!runningExercise} key={option.format} onClick={() => pickRunningFormat(option.format)}><strong>{option.title}</strong><span>{option.description}</span></button>)}
              <button type="button" className="running-format-option featured" disabled={!runningExercise} onClick={() => setRunningStep('intervals')}><strong>Интервалы</strong><span>Повторяющиеся рабочие отрезки и восстановление</span><b aria-hidden="true">›</b></button>
            </div>
            <div className="running-drills"><p className="picker-section-label">СБУ</p><span>Специальные беговые упражнения</span>{runningDrills.map((exercise) => item(exercise, 'running-drill'))}</div>
          </> : <>
            <button type="button" className="link running-format-back" onClick={() => setRunningStep('formats')}>← Все форматы бега</button>
            <div className="running-format-heading"><p className="picker-section-label">Интервальная тренировка</p><span>Готовую схему можно полностью изменить после добавления.</span></div>
            <div className="running-format-list interval-list">{INTERVAL_RUNNING_FORMATS.map((option) => <button type="button" className="running-format-option" data-running-format={option.format} disabled={!runningExercise} key={option.format} onClick={() => pickRunningFormat(option.format)}><strong>{option.title}</strong><span>{option.description}</span></button>)}</div>
          </>}
          {!runningExercise && !catalog.loading && <p className="state">Базовое упражнение «Бег» не найдено</p>}
          {multiple && selected.size > 0 && <div className="picker-selection-bar"><span>Выбрано: {selected.size}</span><button type="button" onClick={addSelected}>Добавить {selected.size}</button></div>}
        </div> : <>
          <div className="picker-list-meta"><span>{filtered.length ? exerciseCountLabel(filtered.length) : 'Совпадений нет'}</span><button type="button" className="link" onClick={() => { setName(search.trim()); setCreating(true) }}>Создать упражнение</button></div>
          {catalog.loading && <p className="state">Загрузка…</p>}
          {catalog.error && <div className="state"><p className="error">{catalog.error.message}</p><button type="button" className="secondary" onClick={catalog.retry}>Повторить</button></div>}
          {!catalog.loading && <div className="picker-list">
            {promotedClient.length > 0 && <><p className="picker-section-label">Последние у клиента</p>{promotedClient.map((exercise) => item(exercise, 'client-recent'))}</>}
            {recent.length > 0 && <><p className="picker-section-label">Недавние</p>{recent.map((exercise) => item(exercise, 'recent'))}</>}
            {(promotedClient.length > 0 || recent.length > 0) && listExercises.length > 0 && <p className="picker-section-label">Все упражнения</p>}
            {listExercises.length ? listExercises.map((exercise) => item(exercise, 'all')) : <p className="state">Ничего не найдено</p>}
          </div>}
          {multiple && selected.size > 0 && <div className="picker-selection-bar"><span>Выбрано: {selected.size}</span><button type="button" onClick={addSelected}>Добавить {selected.size}</button></div>}
        </>}
      </>}
    </section>
  </div>
}
