import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import { useAppViewport } from '../../app/app-viewport'
import type { ExerciseSnapshot, InputKind, MuscleGroup } from '../../shared/domain'
import type { PreparedImage } from '../../shared/image-prep'
import { AddIcon, BackIcon, CheckIcon, CheckSmallIcon, ChevronRightIcon, CloseIcon, PhotoIcon, PlayIcon } from '../../shared/icons'
import { coachWorkoutReferenceAssets } from '../../shared/coach-workout-reference-assets'
import { ExerciseImage } from './ExerciseImage'
import { prepareExerciseImage } from './exercise-image'
import { CONTINUOUS_RUNNING_FORMATS, INTERVAL_RUNNING_FORMATS, type RunningFormat } from '../../shared/running-formats'
import { MUSCLE_GROUP_LABELS, MUSCLE_GROUPS, RUNNING_EXERCISE_REFS } from '../../shared/system-exercises'
import type { ExerciseCatalogState } from './exercise-catalog'
import { matchesExerciseSearch, rankExerciseSearch, type ExerciseSearchOptions } from './exercise-search'
import { readRecentKeys, recordRecent, resolveRecent } from './recent-exercises'
import { selectableExercises } from './selectable-exercises'
import { compareCatalogBrowseOrder, exerciseCatalogRoot, groupCatalogResults, isCatalogRoot } from '../../shared/exercise-catalog-curation'
import { VITAL_GYM_PRO_MAIN_REF_CANDIDATES } from '../../shared/vital-gym-pro.generated'
import { CatalogVariantField } from './CatalogControls'
import { ExerciseTechniqueContent, hasExerciseAnimation, hasExerciseMedia } from './ExerciseTechnique'
import { canonicalEquipment, EXERCISE_PURPOSE_LABELS, EXERCISE_PURPOSES, exercisePurposes, type ExercisePurpose } from '../../shared/exercise-catalog-filters'

export function filterExercises(
  exercises: readonly ExerciseSnapshot[],
  category: 'all' | MuscleGroup,
  search: string,
  muscle: string | null = null,
  equipment: string | null = null,
  purpose: ExercisePurpose | null = null,
  searchOptions: ExerciseSearchOptions = {},
): readonly ExerciseSnapshot[] {
  const allowed = exercises
    .filter((exercise) => matchesExerciseFilters(exercise, category, muscle, equipment, purpose))
  if (!search.trim()) return allowed.sort((left, right) => left.name.localeCompare(right.name, 'ru'))
  return rankExerciseSearch(allowed, search, searchOptions)
    .filter(({ exercise }) => matchesExerciseSearch(exercise, search))
    .map(({ exercise }) => exercise)
}

function matchesExerciseFilters(
  exercise: ExerciseSnapshot,
  category: 'all' | MuscleGroup,
  muscle: string | null,
  equipment: string | null,
  purpose: ExercisePurpose | null,
) {
  return (category === 'all' || exercise.muscleGroup === category)
    && (!muscle || exercise.primaryMuscleDetail === muscle)
    && (!equipment || canonicalEquipment(exercise.equipment) === equipment)
    && (!purpose || exercisePurposes(exercise).includes(purpose))
}

function valuesByFrequency(values: readonly (string | null | undefined)[]) {
  const counts = new Map<string, number>()
  for (const value of values) {
    if (!value) continue
    counts.set(value, (counts.get(value) ?? 0) + 1)
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ru')).map(([name]) => name)
}

// Детальные мышцы выбранной группы (2-й уровень иерархии), по частоте.
export function musclesForGroup(
  exercises: readonly ExerciseSnapshot[],
  group: MuscleGroup,
  equipment: string | null = null,
  purpose: ExercisePurpose | null = null,
): string[] {
  return valuesByFrequency(exercises
    .filter((exercise) => matchesExerciseFilters(exercise, group, null, equipment, purpose))
    .map((exercise) => exercise.primaryMuscleDetail))
}

export function groupsForSelection(
  exercises: readonly ExerciseSnapshot[],
  equipment: string | null,
  purpose: ExercisePurpose | null,
): MuscleGroup[] {
  const available = new Set(exercises
    .filter((exercise) => matchesExerciseFilters(exercise, 'all', null, equipment, purpose))
    .map((exercise) => exercise.muscleGroup))
  return MUSCLE_GROUPS.filter((group) => available.has(group))
}

export function equipmentForSelection(
  exercises: readonly ExerciseSnapshot[],
  group: 'all' | MuscleGroup,
  muscle: string | null,
  purpose: ExercisePurpose | null = null,
): string[] {
  return valuesByFrequency(exercises
    .filter((exercise) => matchesExerciseFilters(exercise, group, muscle, null, purpose))
    .map((exercise) => canonicalEquipment(exercise.equipment)))
}

export function purposesForSelection(
  exercises: readonly ExerciseSnapshot[],
  group: 'all' | MuscleGroup,
  muscle: string | null,
  equipment: string | null,
): ExercisePurpose[] {
  const available = new Set(exercises
    .filter((exercise) => matchesExerciseFilters(exercise, group, muscle, equipment, null))
    .flatMap((exercise) => exercisePurposes(exercise)))
  return EXERCISE_PURPOSES.filter((purpose) => available.has(purpose))
}

interface ExercisePickerProps {
  catalog: ExerciseCatalogState
  clientRecent?: readonly ExerciseSnapshot[]
  onPick: (exercise: ExerciseSnapshot, runningFormat?: RunningFormat) => void
  onPickMany?: (exercises: ExerciseSnapshot[]) => void | Promise<void>
  selectionDraft?: readonly ExerciseSnapshot[]
  onSelectionDraftChange?: (exercises: ExerciseSnapshot[]) => void
  multiple?: boolean
  showEmptySelection?: boolean
  initialSearch?: string
  initialMode?: ExercisePickerMode
  techniqueActionLabel?: string
  reference?: boolean
  onClose: () => void
}

export type ExercisePickerMode = 'choose' | 'strength' | 'running' | 'all'

function matchesPickerMode(exercise: ExerciseSnapshot, mode: Exclude<ExercisePickerMode, 'choose'>) {
  if (mode === 'all') return true
  const running = RUNNING_EXERCISE_REFS.has(exercise.ref)
  return mode === 'running' ? running : !running
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

const PICKER_BATCH_SIZE = 48
const PICKER_MUSCLE_GROUPS: readonly MuscleGroup[] = ['chest', 'back', 'legs', 'glutes', 'shoulders', 'arms', 'core', 'cardio']

function pickerMuscleGroupLabel(group: MuscleGroup) {
  return group === 'core' ? 'Пресс' : MUSCLE_GROUP_LABELS[group]
}

export function ExercisePicker({ catalog, clientRecent = [], onPick, onPickMany, selectionDraft, onSelectionDraftChange, multiple = false, showEmptySelection = false, initialSearch = '', initialMode = 'all', techniqueActionLabel = 'Добавить упражнение', reference = false, onClose }: ExercisePickerProps) {
  const [mode, setMode] = useState<Exclude<ExercisePickerMode, 'choose' | 'strength'>>(
    !initialSearch.trim() && initialMode === 'running' ? 'running' : 'all',
  )
  const [runningStep, setRunningStep] = useState<'formats' | 'intervals'>('formats')
  const [category, setCategory] = useState<'all' | MuscleGroup>('all')
  const [muscle, setMuscle] = useState<string | null>(null)
  const [equipment, setEquipment] = useState<string | null>(null)
  const [purpose, setPurpose] = useState<ExercisePurpose | null>(null)
  const [search, setSearch] = useState(initialSearch)
  const searchRef = useRef<HTMLInputElement>(null)
  const dialogRef = useRef<HTMLElement>(null)
  const filterButtonRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const savedScrollTop = useRef(0)
  const filterListScrollTop = useRef(0)
  const [previewExercise, setPreviewExercise] = useState<ExerciseSnapshot | null>(null)
  const [playingExerciseKey, setPlayingExerciseKey] = useState<string | null>(null)
  const [visibleCount, setVisibleCount] = useState(PICKER_BATCH_SIZE)
  const [customOnly, setCustomOnly] = useState(false)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [localSelected, setLocalSelected] = useState<Map<string, ExerciseSnapshot>>(() => new Map())
  const [addingSelected, setAddingSelected] = useState(false)
  const [selectionError, setSelectionError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [group, setGroup] = useState<MuscleGroup | null>(null)
  const [inputKind, setInputKind] = useState<InputKind>('distance')
  const [customMuscleDetail, setCustomMuscleDetail] = useState<string | null>(null)
  const [customEquipment, setCustomEquipment] = useState<string | null>(null)
  const [description, setDescription] = useState('')
  const [photo, setPhoto] = useState<PreparedImage | null>(null)
  const [photoBusy, setPhotoBusy] = useState(false)
  const [photoError, setPhotoError] = useState<string | null>(null)
  const photoInputRef = useRef<HTMLInputElement>(null)
  const { keyboardOpen } = useAppViewport()
  const activeMode = mode
  const selectableCatalog = useMemo(() => selectableExercises(catalog.exercises), [catalog.exercises])
  const vitalMainRefs = useMemo(() => {
    const availableByRef = new Map(selectableCatalog.filter((exercise) => exercise.source === 'system').map((exercise) => [exercise.ref, exercise]))
    return new Set<string>(VITAL_GYM_PRO_MAIN_REF_CANDIDATES.flatMap((candidates) => (
      candidates.find((ref) => {
        const exercise = availableByRef.get(ref)
        return exercise && exerciseCatalogRoot(exercise) === ref
      }) ?? candidates.find((ref) => availableByRef.has(ref)) ?? []
    )))
  }, [selectableCatalog])
  const hasVitalMainCatalog = vitalMainRefs.size > 0
  const preferredSearchRefs = useMemo(
    () => [...clientRecent.map((exercise) => exercise.ref), ...readRecentKeys()].filter((ref, index, refs) => refs.indexOf(ref) === index),
    [clientRecent],
  )
  const filtered = useMemo(() => {
    const matches = filterExercises(selectableCatalog, category, search, muscle, equipment, purpose, { preferredExerciseRefs: preferredSearchRefs, customFirst: true })
      .filter((exercise) => matchesPickerMode(exercise, activeMode))
      .filter((exercise) => !customOnly || exercise.source === 'custom')
      .filter((exercise) => search.trim()
        || exercise.source === 'custom'
        || vitalMainRefs.has(exercise.ref)
        || (activeMode === 'running' && RUNNING_EXERCISE_REFS.has(exercise.ref))
        || (!hasVitalMainCatalog && isCatalogRoot(exercise)))
    if (!search.trim()) matches.sort(compareCatalogBrowseOrder)
    return groupCatalogResults(matches)
  }, [activeMode, selectableCatalog, category, search, muscle, equipment, purpose, customOnly, preferredSearchRefs, hasVitalMainCatalog, vitalMainRefs])
  const facetCatalog = useMemo(
    () => selectableCatalog
      .filter((exercise) => !customOnly || exercise.source === 'custom'),
    [customOnly, selectableCatalog],
  )
  const groupOptions = useMemo(
    () => groupsForSelection(facetCatalog, equipment, purpose),
    [equipment, facetCatalog, purpose],
  )
  const muscles = useMemo(
    () => (category === 'all' ? [] : musclesForGroup(facetCatalog, category, equipment, purpose)),
    [category, equipment, facetCatalog, purpose],
  )
  const equipmentOptions = useMemo(
    () => equipmentForSelection(facetCatalog, category, muscle, purpose),
    [category, facetCatalog, muscle, purpose],
  )
  const purposeOptions = useMemo(
    () => purposesForSelection(facetCatalog, category, muscle, equipment),
    [category, equipment, facetCatalog, muscle],
  )
  // Те же словари, что у фильтра (мышца/оборудование зависят от группы), но
  // для формы создания своего упражнения — без ограничения по purpose/
  // customOnly, чтобы предлагать полный набор значений каталога.
  const customMuscleOptions = useMemo(
    () => (group ? musclesForGroup(selectableCatalog, group) : []),
    [group, selectableCatalog],
  )
  const customEquipmentOptions = useMemo(
    () => (group ? equipmentForSelection(selectableCatalog, group, customMuscleDetail) : []),
    [customMuscleDetail, group, selectableCatalog],
  )
  const canEnableCustomOnly = useMemo(
    () => selectableCatalog
      .filter((exercise) => exercise.source === 'custom')
      .some((exercise) => matchesExerciseFilters(exercise, category, muscle, equipment, purpose)),
    [category, equipment, muscle, purpose, selectableCatalog],
  )
  const hasCatalogFilters = category !== 'all' || muscle !== null || equipment !== null || purpose !== null || customOnly
  const hasFilters = activeMode === 'running' || hasCatalogFilters
  const activeFilterChips: { key: string; label: string; remove: () => void }[] = [
    ...(activeMode === 'running' ? [{ key: 'running', label: 'Бег', remove: () => selectRunningMode() }] : []),
    ...(category !== 'all' ? [{ key: 'category', label: pickerMuscleGroupLabel(category), remove: () => { setCategory('all'); setMuscle(null) } }] : []),
    ...(muscle ? [{ key: 'muscle', label: muscle, remove: () => setMuscle(null) }] : []),
    ...(purpose ? [{ key: 'purpose', label: purpose === 'mobility' ? 'Растяжка' : EXERCISE_PURPOSE_LABELS[purpose], remove: () => setPurpose(null) }] : []),
    ...(equipment ? [{ key: 'equipment', label: equipment, remove: () => setEquipment(null) }] : []),
    ...(customOnly ? [{ key: 'custom', label: 'Только мои', remove: () => setCustomOnly(false) }] : []),
  ]
  const runningExercise = useMemo(() => selectableCatalog.find((exercise) => exercise.ref === 'running'), [selectableCatalog])
  const runningDrills = useMemo(
    () => selectableCatalog.filter((exercise) => exercise.ref !== 'running' && RUNNING_EXERCISE_REFS.has(exercise.ref)),
    [selectableCatalog],
  )
  const showRunningFormats = activeMode === 'running' && !search.trim() && !hasCatalogFilters
  const promotedClient = useMemo(
    () => (!hasFilters && !search.trim() ? groupCatalogResults(selectableExercises(clientRecent)
      .map((exercise) => selectableCatalog.find((current) => exerciseKey(current) === exerciseKey(exercise)) ?? exercise)
      .filter((exercise) => matchesPickerMode(exercise, activeMode))) : []),
    [activeMode, clientRecent, hasFilters, search, selectableCatalog],
  )
  const recent = useMemo(() => {
    if (hasFilters || search.trim()) return []
    const clientKeys = new Set(promotedClient.map((exercise) => `${exercise.source}:${exerciseCatalogRoot(exercise)}`))
    return groupCatalogResults(resolveRecent(readRecentKeys(), selectableCatalog)
      .filter((exercise) => matchesPickerMode(exercise, activeMode))
      .filter((exercise) => !clientKeys.has(`${exercise.source}:${exerciseCatalogRoot(exercise)}`)))
  }, [activeMode, hasFilters, promotedClient, search, selectableCatalog])
  const listExercises = useMemo(
    () => {
      if (hasFilters || search.trim()) return filtered
      const promotedKeys = new Set([...promotedClient, ...recent].map((exercise) => `${exercise.source}:${exerciseCatalogRoot(exercise)}`))
      return filtered.filter((exercise) => !promotedKeys.has(`${exercise.source}:${exerciseCatalogRoot(exercise)}`))
    },
    [filtered, hasFilters, promotedClient, recent, search],
  )
  const visibleListExercises = useMemo(() => listExercises.slice(0, visibleCount), [listExercises, visibleCount])
  const hasVisibleExercises = promotedClient.length > 0 || recent.length > 0 || listExercises.length > 0
  const selected = useMemo(
    () => selectionDraft === undefined
      ? localSelected
      : new Map(selectionDraft.map((exercise) => [exerciseKey(exercise), exercise])),
    [localSelected, selectionDraft],
  )

  useEffect(() => {
    if (!reference) return
    const previous = document.activeElement
    dialogRef.current?.focus()
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus() }
  }, [reference])

  function handleDialogKey(event: KeyboardEvent<HTMLElement>) {
    if (!reference || event.defaultPrevented) return
    if (event.key === 'Escape') {
      event.preventDefault()
      if (addingSelected) return
      if (previewExercise) closeTechnique()
      else if (creating) closeCreate()
      else if (filtersOpen) closeFilters(true)
      else onClose()
    }
    if (event.key !== 'Tab') return
    const controls = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled):not([hidden]), select:not(:disabled), textarea:not(:disabled), a[href], summary') ?? []).filter((node) => node.getClientRects().length > 0)
    const first = controls[0], last = controls.at(-1)
    if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) { event.preventDefault(); last?.focus() }
    else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialogRef.current)) { event.preventDefault(); first?.focus() }
  }

  useEffect(() => {
    setVisibleCount(PICKER_BATCH_SIZE)
    setPlayingExerciseKey(null)
    if (listRef.current) listRef.current.scrollTop = 0
  }, [activeMode, category, customOnly, equipment, muscle, purpose, search])

  function closeFilters(restoreScroll = false) {
    setFiltersOpen(false)
    requestAnimationFrame(() => {
      if (restoreScroll && listRef.current) listRef.current.scrollTop = filterListScrollTop.current
      filterButtonRef.current?.focus()
    })
  }
  function applyFilter(change: () => void) {
    change()
    if (!reference) closeFilters()
  }

  function openCreate() {
    setName(search.trim())
    setFiltersOpen(false)
    setCreating(true)
  }
  function pick(exercise: ExerciseSnapshot) {
    if (addingSelected) return
    setSelectionError(null)
    if (!multiple) {
      recordRecent(exercise)
      onPick(exercise)
      return
    }
    const key = exerciseKey(exercise)
    const next = new Map(selected)
    if (next.has(key)) next.delete(key)
    else next.set(key, exercise)
    updateSelection(next)
  }
  function updateSelection(next: Map<string, ExerciseSnapshot>) {
    if (selectionDraft === undefined) setLocalSelected(next)
    else onSelectionDraftChange?.([...next.values()])
  }
  function clearSelection() {
    updateSelection(new Map())
  }
  async function addSelected() {
    const exercises = [...selected.values()]
    if (!exercises.length || !onPickMany || addingSelected) return
    setAddingSelected(true)
    setSelectionError(null)
    try {
      await onPickMany(exercises)
      exercises.forEach(recordRecent)
      clearSelection()
    } catch (error) {
      setSelectionError(showEmptySelection
        ? 'Не удалось добавить все упражнения. Уже добавленные убраны из выбора — повторите добавление остальных.'
        : reference && error instanceof Error ? error.message : 'Не удалось добавить упражнения. Выбор сохранён — попробуйте ещё раз.')
    } finally {
      setAddingSelected(false)
    }
  }
  function pickRunningFormat(format: RunningFormat) {
    if (!runningExercise) return
    recordRecent(runningExercise)
    onPick(runningExercise, format)
  }
  function resetFilters() {
    setMode('all')
    setRunningStep('formats')
    setCategory('all')
    setMuscle(null)
    setEquipment(null)
    setPurpose(null)
    setCustomOnly(false)
    if (filtersOpen) closeFilters()
  }
  function clearSearch() {
    setSearch('')
    searchRef.current?.focus()
  }
  function handleSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Escape' || !search) return
    event.preventDefault()
    clearSearch()
  }
  function selectRunningMode() {
    setMode((current) => current === 'running' ? 'all' : 'running')
    setRunningStep('formats')
    setCategory('all')
    setMuscle(null)
    setEquipment(null)
    setPurpose(null)
    setCustomOnly(false)
  }
  function selectPurpose(next: ExercisePurpose) {
    setMode('all')
    setPurpose((current) => current === next ? null : next)
  }
  function openTechnique(exercise: ExerciseSnapshot) {
    savedScrollTop.current = listRef.current?.scrollTop ?? 0
    searchRef.current?.blur()
    setPlayingExerciseKey(null)
    setPreviewExercise(exercise)
  }
  function closeTechnique() {
    setPreviewExercise(null)
    requestAnimationFrame(() => {
      if (listRef.current) listRef.current.scrollTop = savedScrollTop.current
    })
  }
  function techniqueAction(exercise: ExerciseSnapshot) {
    pick(exercise)
    if (multiple) closeTechnique()
  }
  // Первый тап проигрывает ровно одну анимацию в списке. Повторный тап по
  // активной карточке открывает подробную технику; кнопка «+» меняет выбор.
  function item(exercise: ExerciseSnapshot, keyPrefix: string) {
    const key = exerciseKey(exercise)
    const checked = selected.has(key)
    const hasTechniqueMedia = hasExerciseMedia(exercise)
    const hasTechniqueVideo = hasExerciseAnimation(exercise)
    const playing = hasTechniqueVideo && playingExerciseKey === key
    const showTechnique = () => {
      if (!hasTechniqueVideo || playing) openTechnique(exercise)
      else setPlayingExerciseKey(key)
    }
    return <article className={`picker-item${checked ? ' selected' : ''}${playing ? ' playing' : ''}`} key={`${keyPrefix}-${exercise.source}-${exercise.ref}`}>
      <button type="button" className={`picker-item-technique${hasTechniqueMedia ? '' : ' without-media'}`} aria-label={`${playing ? 'Открыть технику' : hasTechniqueVideo ? 'Проиграть технику' : hasTechniqueMedia ? 'Открыть технику' : 'Посмотреть технику'}: ${exercise.name}`} aria-pressed={hasTechniqueVideo ? playing : undefined} onClick={showTechnique}>
        {hasTechniqueMedia && <span className="picker-item-media"><ExerciseImage src={exercise.imageUrl} motionSrc={exercise.motionImageUrl} videoSrc={exercise.techniqueVideoUrl} customPhotoPath={exercise.imagePath} alt={exercise.name} variant="picker" playVideo={playing} />{hasTechniqueVideo && !playing && <span className="picker-item-play" aria-hidden="true">{reference ? <img src={coachWorkoutReferenceAssets.play} alt="" /> : <PlayIcon />}</span>}</span>}
        <span className="picker-item-copy"><span className="picker-item-name">{exercise.name}</span><small>{[exercise.equipment, MUSCLE_GROUP_LABELS[exercise.muscleGroup]].filter(Boolean).join(' · ')}</small>{reference && exercise.source === 'custom' && <small className="coach-catalog-own">Моё</small>}{playing && <small className="picker-item-playing-note">Нажмите ещё раз, чтобы открыть технику</small>}</span>
      </button>
      <button type="button" className="picker-select-mark" aria-label={checked ? `Убрать: ${exercise.name}` : multiple ? `Выбрать: ${exercise.name}` : `Добавить: ${exercise.name}`} aria-pressed={multiple ? checked : undefined} data-exercise-ref={exercise.ref} data-exercise-source={exercise.source} onClick={() => pick(exercise)}>{checked ? <CheckIcon /> : <AddIcon />}</button>
    </article>
  }
  // Мышца принадлежит группе, поэтому при смене группы сбрасываем только её.
  // Остальные фасеты уже ограничивают список доступных групп и остаются валидными.
  function selectGroup(next: MuscleGroup) {
    setMode('all')
    setCategory((current) => current === next ? 'all' : next)
    setMuscle(null)
  }
  function selectMuscle(next: string | null) { setMuscle(next) }
  function stopPropagation(event: MouseEvent) { event.stopPropagation() }
  // Мышца/оборудование в форме создания зависят от выбранной группы (как и
  // в фильтре), поэтому смена группы или мышцы сбрасывает следующий уровень.
  function selectCustomGroup(next: MuscleGroup) {
    setGroup(next)
    setCustomMuscleDetail(null)
    setCustomEquipment(null)
  }
  function selectCustomMuscleDetail(next: string | null) {
    setCustomMuscleDetail(next)
    setCustomEquipment(null)
  }
  function closeCreate() {
    setCreating(false)
    setName('')
    setGroup(null)
    setCustomMuscleDetail(null)
    setCustomEquipment(null)
    setDescription('')
    setPhoto(null)
    setPhotoError(null)
  }
  async function choosePhoto(file: File | undefined) {
    if (!file) return
    setPhotoBusy(true)
    setPhotoError(null)
    try {
      setPhoto(await prepareExerciseImage(file))
    } catch (error) {
      setPhoto(null)
      setPhotoError(error instanceof Error ? error.message : 'Не удалось подготовить фото')
    } finally {
      setPhotoBusy(false)
      if (photoInputRef.current) photoInputRef.current.value = ''
    }
  }
  async function createExercise() {
    if (!name.trim() || !group) return
    try {
      const exercise = await catalog.create({
        name: name.trim(),
        muscleGroup: group,
        inputKind: group === 'cardio' ? inputKind : 'strength',
        primaryMuscleDetail: customMuscleDetail ?? undefined,
        equipment: customEquipment ?? undefined,
        description: description.trim() || undefined,
      }, photo)
      pick(exercise)
      if (multiple) closeCreate()
    } catch {
      // Mutation state exposes the normalized repository error in the picker.
    }
  }

  const referenceList = reference && !previewExercise && !creating
  return <div className={`sheet-overlay exercise-picker-overlay${keyboardOpen ? ' keyboard-open' : ''}`} onClick={() => { if (!addingSelected) onClose() }}>
    <section ref={dialogRef} tabIndex={reference ? -1 : undefined} onKeyDown={handleDialogKey} className={`exercise-picker${reference ? ' coach-reference-sheet coach-reference-catalog' : ''}${selected.size ? ' has-selection' : ''}`} role="dialog" aria-modal="true" aria-label="Добавить упражнение" onClick={stopPropagation}>
      {referenceList ? <header className="picker-header coach-reference-sheet-header">
        <button type="button" className="picker-close" disabled={addingSelected} aria-label={filtersOpen ? 'Назад к упражнениям' : 'Закрыть'} onClick={filtersOpen ? () => closeFilters(true) : onClose}>{filtersOpen ? <BackIcon /> : <CloseIcon />}</button>
        <h1>{filtersOpen ? 'Фильтры' : 'Добавить упражнение'}</h1>
        {(filtersOpen || multiple) && <button type="button" className="coach-sheet-confirm" aria-label={filtersOpen ? 'Применить фильтры' : 'Добавить выбранные упражнения'} disabled={!filtersOpen && (addingSelected || selected.size === 0)} onClick={filtersOpen ? () => closeFilters(true) : () => void addSelected()}><CheckSmallIcon /></button>}
      </header> : <header className={`picker-header${previewExercise ? ' picker-technique-header' : ''}`}>
        {previewExercise && <button type="button" className="picker-close picker-back" aria-label="Назад к выбору" onClick={closeTechnique}><BackIcon /></button>}
        <h1>{previewExercise ? 'Техника' : creating ? 'Своё упражнение' : 'Выберите упражнения'}</h1>
        <button type="button" className="picker-close" aria-label="Закрыть" disabled={showEmptySelection && addingSelected} onClick={creating ? closeCreate : onClose}><CloseIcon /></button>
      </header>}
      {previewExercise ? <div className="picker-technique-view">
        <ExerciseTechniqueContent exercise={previewExercise} beforeFacts={<CatalogVariantField exercise={previewExercise} catalog={catalog.exercises} onChange={setPreviewExercise} />} />
        <button type="button" className="primary picker-technique-action" onClick={() => techniqueAction(previewExercise)}>{multiple && selected.has(exerciseKey(previewExercise)) ? 'Убрать из выбранных' : multiple ? 'Добавить к выбранным' : techniqueActionLabel}</button>
      </div> : creating ? <div className="stack">
        <label className="field">Название<input value={name} onChange={(event) => setName(event.target.value)} placeholder="Например: Болгарский присед" /></label>
        <div className="picker-categories" aria-label="Группа мышц">{MUSCLE_GROUPS.map((item) => <button type="button" key={item} className={group === item ? 'picker-category active' : 'picker-category'} onClick={() => selectCustomGroup(item)}>{MUSCLE_GROUP_LABELS[item]}</button>)}</div>
        {group === 'cardio' && <div className="picker-categories"><button type="button" className={inputKind === 'distance' ? 'picker-category active' : 'picker-category'} onClick={() => setInputKind('distance')}>Время + дистанция</button><button type="button" className={inputKind === 'reps' ? 'picker-category active' : 'picker-category'} onClick={() => setInputKind('reps')}>Время + повторы</button></div>}
        {customMuscleOptions.length > 0 && <label className="field">Мышца<select aria-label="Мышца" value={customMuscleDetail ?? ''} onChange={(event) => selectCustomMuscleDetail(event.target.value || null)}><option value="">Не уточнено</option>{customMuscleOptions.map((item) => <option key={item}>{item}</option>)}</select></label>}
        {customEquipmentOptions.length > 0 && <label className="field">Оборудование<select aria-label="Оборудование" value={customEquipment ?? ''} onChange={(event) => setCustomEquipment(event.target.value || null)}><option value="">Не уточнено</option>{customEquipmentOptions.map((item) => <option key={item}>{item}</option>)}</select></label>}
        <label className="field">Описание<textarea value={description} maxLength={2000} rows={3} placeholder="Как выполнять, на что обратить внимание" onChange={(event) => setDescription(event.target.value)} /></label>
        {photo ? <div className="picker-photo-preview"><img src={photo.dataUrl} alt="Фото упражнения" /><button type="button" aria-label="Убрать фото" onClick={() => setPhoto(null)}><CloseIcon /></button></div>
          : <button type="button" className="secondary picker-photo-attach" disabled={photoBusy} aria-busy={photoBusy} onClick={() => photoInputRef.current?.click()}><PhotoIcon />{photoBusy ? 'Подготавливаем фото…' : 'Добавить фото на обложку'}</button>}
        <input ref={photoInputRef} hidden type="file" accept="image/*" aria-label="Выбрать фото" onChange={(event) => void choosePhoto(event.target.files?.[0])} />
        {photoError && <p className="error">{photoError}</p>}
        {catalog.error && <p className="error">{catalog.error.message}</p>}
        <button type="button" className="primary" disabled={catalog.saving || photoBusy || !name.trim() || !group} onClick={() => void createExercise()}>{catalog.saving ? 'Сохранение…' : 'Сохранить упражнение'}</button>
      </div> : <>
        {(!reference || !filtersOpen) && <><div className="picker-search-control"><input ref={searchRef} className="picker-search" aria-label="Поиск упражнения" placeholder={activeMode === 'running' ? 'Бег или СБУ' : 'Название упражнения'} value={search} onFocus={() => setFiltersOpen(false)} onKeyDown={handleSearchKeyDown} onChange={(event) => setSearch(event.target.value)} />{search && <button type="button" className="picker-search-clear" aria-label="Очистить поиск" onClick={clearSearch}><CloseIcon /></button>}</div>
        <div className="picker-toolbar">
          {reference && <span className="coach-catalog-count">{hasFilters || search.trim() ? `Найдено: ${filtered.length}` : exerciseCountLabel(filtered.length)}</span>}
          <button ref={filterButtonRef} type="button" className="secondary picker-filter-trigger" aria-expanded={filtersOpen} aria-controls={filtersOpen ? 'picker-filter-panel' : undefined} onClick={() => { searchRef.current?.blur(); if (filtersOpen) closeFilters(true); else { filterListScrollTop.current = listRef.current?.scrollTop ?? 0; setFiltersOpen(true) } }}>{reference ? 'Фильтровать' : 'Фильтры'}{activeFilterChips.length ? ` (${activeFilterChips.length})` : ''}{reference && <img src={coachWorkoutReferenceAssets.filter} width="16" height="16" alt="" />}</button>
          {(!reference || selected.size > 0) && <button type="button" className="secondary picker-create-action" disabled={addingSelected} aria-label="Создать упражнение" onClick={openCreate}>Создать упражнение</button>}
        </div>
        {activeFilterChips.length > 0 && <div className="picker-active-filters" role="group" aria-label="Выбранные фильтры">
          {activeFilterChips.map((chip) => <button type="button" key={chip.key} aria-label={`Убрать фильтр: ${chip.label}`} onClick={() => { chip.remove(); requestAnimationFrame(() => filterButtonRef.current?.focus()) }}><span>{chip.label}</span><CloseIcon /></button>)}
        </div>}</>}
        {filtersOpen ? <div id="picker-filter-panel" className="picker-filter-panel" role="region" aria-label="Фильтры упражнений" onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); closeFilters(true) } }}>
          <div className="picker-filter-panel-heading">{!reference && <h2>Фильтры</h2>}{hasFilters && <button type="button" className="link" onClick={resetFilters}>Сбросить</button>}</div>
          {reference && <div className="picker-filter-strip"><button type="button" aria-pressed={customOnly} className={customOnly ? 'active' : ''} disabled={!customOnly && !canEnableCustomOnly} onClick={() => applyFilter(() => { setMode('all'); setCustomOnly((current) => !current) })}>Только мои</button></div>}
          <p className="picker-filter-label">Группа мышц</p>
          <div className="picker-filter-strip" role="group" aria-label="Группа мышц">
            {PICKER_MUSCLE_GROUPS.map((item) => <button type="button" key={item} aria-pressed={category === item} className={category === item ? 'active' : ''} disabled={category !== item && !groupOptions.includes(item)} onClick={() => applyFilter(() => selectGroup(item))}>{pickerMuscleGroupLabel(item)}</button>)}
          </div>
          <p className="picker-filter-label">Тип упражнения</p>
          <div className="picker-filter-strip picker-quick-filter-strip" role="group" aria-label="Тип упражнения">
            <button type="button" aria-pressed={activeMode === 'running'} className={activeMode === 'running' ? 'active' : ''} onClick={() => applyFilter(selectRunningMode)}>Бег</button>
            {EXERCISE_PURPOSES.map((item) => <button type="button" key={item} aria-pressed={purpose === item} className={purpose === item ? 'active' : ''} disabled={purpose !== item && !purposeOptions.includes(item)} onClick={() => applyFilter(() => selectPurpose(item))}>{item === 'mobility' ? 'Растяжка' : EXERCISE_PURPOSE_LABELS[item]}</button>)}
            {!reference && <button type="button" aria-pressed={customOnly} className={customOnly ? 'active' : ''} disabled={!customOnly && !canEnableCustomOnly} onClick={() => applyFilter(() => { setMode('all'); setCustomOnly((current) => !current) })}>Только мои</button>}
          </div>
          {category !== 'all' && muscles.length > 1 && <><p className="picker-filter-label">Мышца</p><div className="picker-filter-strip picker-muscle-filter-strip" role="group" aria-label="Мышца">
            {muscles.map((item) => <button type="button" key={item} aria-pressed={muscle === item} className={muscle === item ? 'active' : ''} onClick={() => applyFilter(() => selectMuscle(muscle === item ? null : item))}>{item}</button>)}
          </div></>}
          <label className="picker-filter-label" htmlFor="picker-equipment-select">Оборудование</label>
          <div className="picker-equipment-control"><select id="picker-equipment-select" aria-label="Оборудование" value={equipment ?? ''} disabled={activeMode === 'running'} onChange={(event) => applyFilter(() => setEquipment(event.target.value || null))}><option value="">Всё оборудование</option>{equipmentOptions.map((item) => <option key={item}>{item}</option>)}</select></div>
          <button type="button" className="secondary picker-filter-done" onClick={() => closeFilters(true)}>Показать упражнения</button>
        </div> : showRunningFormats ? <div className="running-format-picker">
          {catalog.loading && <p className="state">Загрузка…</p>}
          {catalog.error && <div className="state"><p className="error">{catalog.error.message}</p><button type="button" className="secondary" onClick={catalog.retry}>Повторить</button></div>}
          {runningStep === 'formats' ? <>
            <div className="running-format-heading"><p className="picker-section-label">Формат бега</p><span>Выберите основу тренировки. Значения можно изменить после добавления.</span></div>
            <div className="running-format-list">
              {CONTINUOUS_RUNNING_FORMATS.map((option) => <button type="button" className="running-format-option" data-running-format={option.format} data-exercise-ref={option.format === 'free' ? 'running' : undefined} disabled={!runningExercise} key={option.format} onClick={() => pickRunningFormat(option.format)}><strong>{option.title}</strong><span>{option.description}</span></button>)}
              <button type="button" className="running-format-option featured" disabled={!runningExercise} onClick={() => setRunningStep('intervals')}><strong>Интервалы</strong><span>Повторяющиеся рабочие отрезки и восстановление</span><ChevronRightIcon /></button>
            </div>
            <div className="running-drills"><p className="picker-section-label">СБУ</p><span>Специальные беговые упражнения</span>{runningDrills.map((exercise) => item(exercise, 'running-drill'))}</div>
          </> : <>
            <button type="button" className="link running-format-back" onClick={() => setRunningStep('formats')}>← Все форматы бега</button>
            <div className="running-format-heading"><p className="picker-section-label">Интервальная тренировка</p><span>Готовую схему можно полностью изменить после добавления.</span></div>
            <div className="running-format-list interval-list">{INTERVAL_RUNNING_FORMATS.map((option) => <button type="button" className="running-format-option" data-running-format={option.format} disabled={!runningExercise} key={option.format} onClick={() => pickRunningFormat(option.format)}><strong>{option.title}</strong><span>{option.description}</span></button>)}</div>
          </>}
          {!runningExercise && !catalog.loading && <p className="state">Базовое упражнение «Бег» не найдено</p>}
        </div> : <>
          {!reference && hasVisibleExercises && <div className="picker-list-meta"><span>{hasFilters || search.trim() ? `Найдено: ${filtered.length}` : exerciseCountLabel(filtered.length)}</span>{hasFilters && <button type="button" className="link" onClick={resetFilters}>Сбросить</button>}</div>}
          {catalog.loading && <p className="state">Загрузка…</p>}
          {catalog.error && <div className="state"><p className="error">{catalog.error.message}</p><button type="button" className="secondary" onClick={catalog.retry}>Повторить</button></div>}
          {!catalog.loading && !catalog.error && hasVisibleExercises && <div ref={listRef} className="picker-list">
            {promotedClient.length > 0 && <><p className="picker-section-label">Недавние упражнения</p>{promotedClient.map((exercise) => item(exercise, 'client-recent'))}</>}
            {recent.length > 0 && <><p className="picker-section-label">Недавние</p>{recent.map((exercise) => item(exercise, 'recent'))}</>}
            {(promotedClient.length > 0 || recent.length > 0) && listExercises.length > 0 && <p className="picker-section-label">Все упражнения</p>}
            {visibleListExercises.map((exercise) => item(exercise, 'all'))}
            {visibleCount < listExercises.length && <button type="button" className="picker-load-more" onClick={() => setVisibleCount((count) => count + PICKER_BATCH_SIZE)}>Показать ещё</button>}
          </div>}
          {!catalog.loading && !catalog.error && !hasVisibleExercises && <div className="picker-empty-state" role="status">
            <p>{hasFilters || search.trim() ? 'Ничего не найдено' : 'В этом разделе пока нет упражнений'}</p>
            <div>{hasFilters && <button type="button" className="link" onClick={resetFilters}>Сбросить фильтры</button>}{search.trim() && <button type="button" className="link" onClick={openCreate}>{`Создать «${search.trim()}»`}</button>}</div>
          </div>}
        </>}
        {selectionError && <p className="error" role="alert">{selectionError}</p>}
        {reference && !filtersOpen && selected.size === 0 && <div className="coach-catalog-create-bar"><button type="button" className="secondary picker-create-action coach-catalog-create-floating" disabled={addingSelected} aria-label="Создать упражнение" onClick={openCreate}><img src={coachWorkoutReferenceAssets.plus} width="24" height="24" alt="" /></button></div>}
        {multiple && (selected.size > 0 || showEmptySelection) && (!reference || !filtersOpen) && <div className="picker-selection-bar"><span className="picker-selection-summary"><span>Выбрано: {selected.size}</span><button type="button" className="link" disabled={addingSelected || selected.size === 0} onClick={clearSelection}>Очистить</button></span><button type="button" className="primary" disabled={addingSelected || selected.size === 0} onClick={() => void addSelected()}>{addingSelected ? 'Добавляем…' : `Добавить ${selected.size}`}</button></div>}
      </>}
    </section>
  </div>
}
