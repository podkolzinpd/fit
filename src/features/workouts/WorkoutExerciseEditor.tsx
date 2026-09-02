import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { BlockPreset, WorkoutExerciseDraft, WorkoutSetDraft } from '../../shared/domain'
import { formatLocalDate } from '../../shared/local-date'
import { RPE_OPTIONS } from '../../shared/rpe'
import type { PreviousExerciseResult } from '../../data/repositories/workouts.repository'
import { applyRunningActiveRecoveryPreset, applyRunningIntervalPreset, compactExerciseDetailSummary, groupDraftsIntoBlocks, mergeBlockWithNext, moveBlock, nextSetDraft, previousResultLine, setBlockPreset, setBlockRest, splitBlock, syncBlockRounds, draftBlockRoundsView } from '../../data/repositories/workout-rules'
import { OverflowMenu, useConfirm } from '../../shared/ui'
import { ArrowDownIcon, ArrowUpIcon, CloseIcon } from '../../shared/icons'
import { isRowingExerciseRef } from '../../shared/run-metrics'
import { WorkoutSetTable } from './WorkoutSetTable'
import { RunMetricsFields } from './RunMetricsFields'
import { WorkoutExercise, WorkoutSetRow } from './WorkoutSurface'

// Числовое поле, которое МОЖНО очистить курсором. Контролируемый input с value
// снаружи «возвращал» старое число при пустом вводе (стереть можно было только
// заменой выделенного). Держим локальный черновик-строку: во время ввода поле
// может быть пустым (коммита нет). Валидное число фиксируем сразу (чтобы, напр.,
// круги перерисовывались по мере ввода), а пустое поле зажимаем в min на blur.
function ClampedNumberInput({ value, min, max, label, onCommit }: {
  value: number; min: number; max?: number; label: string; onCommit: (next: number) => void
}) {
  const [draft, setDraft] = useState(String(value))
  useEffect(() => { setDraft(String(value)) }, [value])
  function clamp(n: number) { return Math.min(max ?? Infinity, Math.max(min, n)) }
  return <input aria-label={label} type="number" min={min} max={max} value={draft}
    onFocus={(event) => event.target.select()}
    onChange={(event) => {
      const raw = event.target.value
      setDraft(raw)
      if (raw === '') return // пустое поле во время ввода — не коммитим
      const parsed = Number(raw)
      if (!Number.isNaN(parsed)) { const next = clamp(parsed); if (next !== value) onCommit(next) }
    }}
    onBlur={() => { // ушли из пустого/битого поля → откатываем в min
      const parsed = Number(draft)
      const next = draft === '' || Number.isNaN(parsed) ? min : clamp(parsed)
      setDraft(String(next))
      if (next !== value) onCommit(next)
    }}
    onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }} />
}

function OptionalDetails({ summary, initialOpen = false, className = '', children }: {
  summary: ReactNode
  initialOpen?: boolean
  className?: string
  children: ReactNode
}) {
  const [open, setOpen] = useState(initialOpen)
  return <details className={`exercise-options ${className}`.trim()} open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary>{summary}</summary>
    {children}
  </details>
}

export function roundToStep(value: number, step: number): number {
  return Math.round(value / step) * step
}

export function adjustWorkoutLoad(
  exercises: readonly WorkoutExerciseDraft[],
  factor: number,
): WorkoutExerciseDraft[] {
  return exercises.map((exercise) => ({
    ...exercise,
    sets: exercise.sets.map((set) => ({
      ...set,
      weightKg: set.weightKg === undefined ? undefined : roundToStep(set.weightKg * factor, 2.5),
    })),
  }))
}

export function clearWorkoutLoad(exercises: readonly WorkoutExerciseDraft[]): WorkoutExerciseDraft[] {
  return exercises.map((exercise) => ({
    ...exercise,
    sets: exercise.sets.map((set) => ({ position: set.position })),
  }))
}

interface WorkoutExerciseEditorProps {
  exercises: readonly WorkoutExerciseDraft[]
  onChange: (exercises: WorkoutExerciseDraft[]) => void
  onOpenPicker: () => void
  onReplaceExercise: (index: number) => void
  showTrainerComments?: boolean
  entryMode?: 'plan' | 'fact'
  /** Верхний вход в каталог уже есть у родительской формы. */
  hideEmptyAddAction?: boolean
  previousResults?: ReadonlyMap<string, PreviousExerciseResult>
  showRpeByDefault?: boolean
  /** В копии исходные упражнения сначала показываются компактным обзором. */
  collapseInitialExercises?: boolean
  /** Родитель закончил восстановление исходного плана/черновика. */
  initialExercisesReady?: boolean
}

function inputNumber(value: string): number | undefined {
  return value === '' ? undefined : Number(value)
}

function draftExerciseKey(exercise: WorkoutExerciseDraft, index: number) {
  return exercise.blockId ?? `${exercise.source}:${exercise.ref}:${index}`
}

export function WorkoutExerciseEditor({ exercises, onChange, onOpenPicker, onReplaceExercise, showTrainerComments = true, entryMode = 'plan', hideEmptyAddAction = false, previousResults = new Map(), showRpeByDefault = false, collapseInitialExercises = false, initialExercisesReady = true }: WorkoutExerciseEditorProps) {
  const [reordering, setReordering] = useState(false)
  const [confirm, confirmDialog] = useConfirm()
  const [expandedExercises, setExpandedExercises] = useState<Set<string>>(() => new Set())
  const [settingsExerciseIndex, setSettingsExerciseIndex] = useState<number | null>(null)
  // Два поля одного подхода могут отправить change до перерисовки родителя (особенно
  // в WebKit и автотестах). Последний commit держим синхронно, чтобы следующее поле не
  // перезатёрло предыдущее устаревшим props-снимком.
  const latestExercises = useRef<readonly WorkoutExerciseDraft[]>(exercises)
  useEffect(() => { latestExercises.current = exercises }, [exercises])
  function commitExercises(next: WorkoutExerciseDraft[]) {
    latestExercises.current = next
    onChange(next)
  }
  function updateRestBetweenSets(blockId: string, next: number) {
    commitExercises(setBlockRest([...latestExercises.current], blockId, { betweenSets: next }))
  }
  function applyRunningPreset(activeRecovery: boolean) {
    if (settingsExerciseIndex === null) return
    const current = [...latestExercises.current]
    commitExercises(activeRecovery
      ? applyRunningActiveRecoveryPreset(current, settingsExerciseIndex)
      : applyRunningIntervalPreset(current, settingsExerciseIndex))
    setSettingsExerciseIndex(null)
  }
  function applyPassiveRunningPreset() { applyRunningPreset(false) }
  function applyActiveRunningPreset() { applyRunningPreset(true) }
  const initialKeysCaptured = useRef(!collapseInitialExercises)
  const previousExerciseKeys = useRef<Set<string>>(new Set())
  // Точечный выбор из меню имеет приоритет над общей настройкой тренера.
  const [rpeOverrides, setRpeOverrides] = useState<Map<number, boolean>>(() => new Map())
  function isRpeVisible(exerciseIndex: number) {
    return rpeOverrides.get(exerciseIndex) ?? showRpeByDefault
  }
  function toggleRpe(exerciseIndex: number) {
    setRpeOverrides((current) => new Map(current).set(exerciseIndex, !isRpeVisible(exerciseIndex)))
  }
  useEffect(() => {
    const currentKeys = new Set(exercises.map(draftExerciseKey))
    if (!initialKeysCaptured.current) {
      if (!initialExercisesReady) return
      initialKeysCaptured.current = true
      previousExerciseKeys.current = currentKeys
      return
    }
    const added = [...currentKeys].filter((key) => !previousExerciseKeys.current.has(key))
    setExpandedExercises((current) => {
      const next = new Set([...current].filter((key) => currentKeys.has(key)))
      for (const key of added) next.add(key)
      return next
    })
    previousExerciseKeys.current = currentKeys
  }, [exercises, initialExercisesReady])
  useEffect(() => {
    if (settingsExerciseIndex === null) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSettingsExerciseIndex(null)
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [settingsExerciseIndex])
  function isExerciseExpanded(exercise: WorkoutExerciseDraft, index: number) {
    return !collapseInitialExercises || expandedExercises.has(draftExerciseKey(exercise, index))
  }
  function toggleExercise(exercise: WorkoutExerciseDraft, index: number) {
    const key = draftExerciseKey(exercise, index)
    setExpandedExercises((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })
  }
  function updateComment(exerciseIndex: number, comment: string) {
    commitExercises(latestExercises.current.map((exercise, current) => current === exerciseIndex ? { ...exercise, trainerComment: comment || undefined } : exercise))
  }
  // Поле комментария тренера к упражнению (техника/ограничения/заметка).
  function commentField(exercise: WorkoutExerciseDraft, exerciseIndex: number) {
    if (!showTrainerComments) return null
    return <textarea className="exercise-comment" aria-label="Комментарий к упражнению" placeholder="Комментарий к упражнению…" rows={1} value={exercise.trainerComment ?? ''} onChange={(event) => updateComment(exerciseIndex, event.target.value)} />
  }
  function updateSet(exerciseIndex: number, setIndex: number, patch: Partial<WorkoutSetDraft>) {
    commitExercises(latestExercises.current.map((exercise, currentExercise) => currentExercise === exerciseIndex ? {
      ...exercise,
      sets: exercise.sets.map((set, currentSet) => currentSet === setIndex ? { ...set, ...patch } : set),
    } : exercise))
  }
  function addSet(exerciseIndex: number) {
    commitExercises(latestExercises.current.map((exercise, current) => current === exerciseIndex ? {
      ...exercise, sets: [...exercise.sets, nextSetDraft(exercise.sets, exercise.inputKind)],
    } : exercise))
  }
  function removeSet(exerciseIndex: number, setIndex: number) {
    commitExercises(latestExercises.current.map((exercise, current) => current === exerciseIndex ? {
      ...exercise,
      sets: exercise.sets.filter((_, index) => index !== setIndex).map((set, position) => ({ ...set, position })),
    } : exercise))
  }
  function removeExercise(exerciseIndex: number) {
    commitExercises(latestExercises.current.filter((_, index) => index !== exerciseIndex).map((exercise, position) => ({ ...exercise, position })))
  }

  const blocks = groupDraftsIntoBlocks([...exercises])

  // Поля одного подхода (вес/повторы или мин/дистанция по типу упражнения).
  function setFields(exercise: WorkoutExerciseDraft, exerciseIndex: number, setIndex: number, showRpe = false) {
    const set = exercise.sets[setIndex]
    if (!set) return null
    const durationSec = set.durationSec ?? (set.durationMin === undefined ? undefined : Math.round(set.durationMin * 60))
    const inputClass = 'planned-set-input'
    const rpeField = showRpe ? <select className="planned-set-rpe" aria-label={`${entryMode === 'fact' ? 'Фактический' : 'Целевой'} RPE, подход ${setIndex + 1}`} value={set.rpe ?? ''} onChange={(event) => updateSet(exerciseIndex, setIndex, { rpe: inputNumber(event.target.value) })}>
      <option value="">—</option>
      {RPE_OPTIONS.map((value) => <option key={value} value={value}>{value}</option>)}
    </select> : null
    if (exercise.inputKind === 'strength') return <>
      <input className={inputClass} aria-label={`${entryMode === 'fact' ? 'Фактический вес' : 'Вес'}, подход ${setIndex + 1}`} type="number" inputMode="decimal" min="0" step="0.5" placeholder="кг" value={set.weightKg ?? ''} onChange={(event) => updateSet(exerciseIndex, setIndex, { weightKg: inputNumber(event.target.value) })} />
      <input className={inputClass} aria-label={`${entryMode === 'fact' ? 'Фактические повторы' : 'Повторы'}, подход ${setIndex + 1}`} type="number" inputMode="numeric" min="0" placeholder="повт." value={set.reps ?? ''} onChange={(event) => updateSet(exerciseIndex, setIndex, { reps: inputNumber(event.target.value) })} />
      {rpeField}
    </>
    if (exercise.inputKind === 'reps') return <>
      <input className={inputClass} aria-label={`Время, сек, подход ${setIndex + 1}`} type="number" inputMode="numeric" min="0" step="1" placeholder="сек" value={durationSec ?? ''} onChange={(event) => updateSet(exerciseIndex, setIndex, { durationSec: inputNumber(event.target.value), durationMin: undefined })} />
      <input className={inputClass} aria-label={`Повторы, подход ${setIndex + 1}`} type="number" inputMode="numeric" min="0" placeholder="повт." value={set.reps ?? ''} onChange={(event) => updateSet(exerciseIndex, setIndex, { reps: inputNumber(event.target.value) })} />
      {rpeField}
    </>
    if (exercise.inputKind === 'duration') return <>
      <input className={inputClass} aria-label={`Время, сек, подход ${setIndex + 1}`} type="number" inputMode="numeric" min="0" step="1" placeholder="сек" value={durationSec ?? ''} onChange={(event) => updateSet(exerciseIndex, setIndex, { durationSec: inputNumber(event.target.value), durationMin: undefined })} />
      <span aria-hidden="true" />
      {rpeField}
    </>
    return <>
      <RunMetricsFields
        key={`${exercise.name}-${set.position}`}
        idPrefix={`plan-run-${exerciseIndex}-${setIndex}`}
        rowing={isRowingExerciseRef(exercise.ref)}
        durationSec={durationSec}
        distanceKm={set.distanceKm}
        strokeRate={set.reps}
        inputClassName={inputClass}
        durationLabel={`Время, подход ${setIndex + 1}`}
        distanceLabel={`Расстояние, подход ${setIndex + 1}`}
        distanceUnitLabel={`Единица расстояния, подход ${setIndex + 1}`}
        onCommit={(patch) => updateSet(exerciseIndex, setIndex, patch)}
      />
      {rpeField}
    </>
  }

  // Стрелки перемещения блока вверх/вниз (задизейблены на границах).
  function reorderButtons(blockId: string, isFirst: boolean, isLast: boolean) {
    if (!reordering) return null
    return <span className="block-reorder">
      <button type="button" className="reorder-btn" aria-label="Вверх" disabled={isFirst} onClick={() => commitExercises(moveBlock([...latestExercises.current], blockId, -1))}><ArrowUpIcon /></button>
      <button type="button" className="reorder-btn" aria-label="Вниз" disabled={isLast} onClick={() => commitExercises(moveBlock([...latestExercises.current], blockId, 1))}><ArrowDownIcon /></button>
    </span>
  }

  // Одиночное упражнение (вне блока): подходы + «＋ Подход» + «Объединить».
  function renderExercise(exercise: WorkoutExerciseDraft, exerciseIndex: number, canMergeNext: boolean, reorder?: React.ReactNode, canReorder = false) {
    const showRpe = isRpeVisible(exerciseIndex)
    const expanded = isExerciseExpanded(exercise, exerciseIndex)
    const hasCustomRest = exercise.restBetweenSetsSec !== undefined && exercise.restBetweenSetsSec !== 90
    const hasComment = Boolean(exercise.trainerComment)
    const detailsHint = [hasCustomRest ? `Отдых ${exercise.restBetweenSetsSec} с` : '', hasComment ? 'Есть заметка' : ''].filter(Boolean).join(' · ')
    const compactSummary = compactExerciseDetailSummary(exercise.inputKind, exercise.sets, 'planned', showRpe, exercise.ref)
    return <WorkoutExercise state="planned" className="exercise planned-exercise" key={`${exercise.ref}-${exerciseIndex}`}>
      <header className="planned-exercise-head compact-editor-exercise-head">
        <button type="button" className="compact-editor-exercise-toggle" aria-expanded={expanded} onClick={() => toggleExercise(exercise, exerciseIndex)}>
          <span className="compact-editor-exercise-title"><strong>{exercise.name}</strong><span className="compact-editor-chevron" aria-hidden="true" /></span>
          <span className="compact-editor-exercise-summary">{compactSummary}</span>
          {detailsHint && <span className="compact-editor-exercise-options">{detailsHint}</span>}
        </button>
        <span className="exercise-head-actions">{reorder}<OverflowMenu items={[
        ...(canReorder && !reordering ? [{ label: 'Изменить порядок', onClick: () => setReordering(true) }] : []),
        { label: 'Настройки упражнения', onClick: () => setSettingsExerciseIndex(exerciseIndex) },
        { label: showRpe ? 'Скрыть RPE' : 'Указать RPE', onClick: () => toggleRpe(exerciseIndex) },
        ...(canMergeNext ? [{ label: 'Объединить со следующим в блок', onClick: () => commitExercises(mergeBlockWithNext([...latestExercises.current], exerciseIndex)) }] : []),
        { label: 'Заменить', onClick: () => onReplaceExercise(exerciseIndex) },
        { label: 'Удалить', danger: true, onClick: () => removeExercise(exerciseIndex) },
      ]} /></span>
      </header>
      {expanded && <div className="compact-editor-exercise-fields">
      {(() => { const previous = previousResults.get(exercise.ref); const line = previous && previousResultLine(previous.sets, exercise.ref); return line ? <p className="exercise-prefill-note">В прошлый раз: {line}</p> : exercise.prefilledFromDate ? <p className="exercise-prefill-note">Значения с тренировки {formatLocalDate(exercise.prefilledFromDate)}</p> : null })()}
      <WorkoutSetTable variant="planned" inputKind={exercise.inputKind} showRpe={showRpe}
        columnLabels={exercise.inputKind === 'distance' && showRpe ? ['Параметры', ''] : undefined}
        className={exercise.inputKind === 'distance' && showRpe ? 'planned-run-rpe-table' : ''}>
        {exercise.sets.map((_set, setIndex) => <WorkoutSetRow state="planned" className={`planned-set ${exercise.inputKind === 'distance' ? 'planned-set-running' : ''} ${showRpe ? 'rpe-visible' : ''}`} key={setIndex}>
          <span className="workout-set-number planned-set-number" aria-hidden="true">{setIndex + 1}</span>
          <span className="sr-only">Подход {setIndex + 1}</span>
          {setFields(exercise, exerciseIndex, setIndex, showRpe)}
          {exercise.sets.length > 1
            ? <button type="button" className="link planned-set-remove" aria-label={`Удалить подход ${setIndex + 1}`} onClick={() => removeSet(exerciseIndex, setIndex)}><CloseIcon /></button>
            : <span className="planned-set-remove" aria-hidden="true" />}
        </WorkoutSetRow>)}
      </WorkoutSetTable>
      <div className="set-add-row">
        <button type="button" className="secondary" onClick={() => addSet(exerciseIndex)}>＋ Подход</button>
      </div>
      </div>}
    </WorkoutExercise>
  }

  const hasExercises = exercises.length > 0
  const showEmptyAddAction = !hideEmptyAddAction
  const hasAdjustableWeight = exercises.some((exercise) => exercise.sets.some((set) => set.weightKg !== undefined))
  const planActions = [
    ...(hasAdjustableWeight ? [
      { label: 'Рабочие веса −5%', onClick: () => commitExercises(adjustWorkoutLoad(latestExercises.current, .95)) },
      { label: 'Рабочие веса +5%', onClick: () => commitExercises(adjustWorkoutLoad(latestExercises.current, 1.05)) },
    ] : []),
    { label: 'Сбросить значения', danger: true, onClick: async () => {
      if (await confirm({ message: 'Очистить все значения подходов? Количество упражнений и подходов сохранится.', confirmLabel: 'Очистить', danger: true })) commitExercises(clearWorkoutLoad(latestExercises.current))
    } },
  ]

  return <section className="workout-exercise-editor">
    {reordering && <div className="workout-editor-toolbar"><div className="reorder-mode"><span>Изменение порядка</span><button type="button" className="link" onClick={() => setReordering(false)}>Готово</button></div></div>}
    {blocks.map((block, blockIndex) => {
      const lastIndex = exercises.length - 1
      const isFirst = blockIndex === 0
      const isLast = blockIndex === blocks.length - 1
      // «Объединить» показываем на последнем упражнении блока, если дальше есть ещё.
      const blockLastIndex = block.items[block.items.length - 1]!.index
      const canMerge = (index: number) => index === blockLastIndex && index < lastIndex
      if (block.items.length === 1) {
        const { exercise, index } = block.items[0]!
        return renderExercise(exercise, index, canMerge(index), blocks.length > 1 ? reorderButtons(block.blockId, isFirst, isLast) : undefined, blocks.length > 1)
      }
      // Многоэлементный блок: раскладка ПО КРУГАМ (круг = все упражнения по очереди).
      const rounds = draftBlockRoundsView(block)
      const blockMergeIndex = blockLastIndex < lastIndex ? blockLastIndex : -1
      return <div className="exercise-block" key={block.blockId}>
        <div className="exercise-block-head">
          <select aria-label="Тип блока" value={block.blockPreset} onChange={(event) => commitExercises(setBlockPreset([...latestExercises.current], block.blockId, event.target.value as BlockPreset))}>
            <option value="set">Сет</option>
            <option value="circuit">Круговая</option>
            <option value="interval">Интервалы</option>
          </select>
          <label className="block-rounds">Кругов<ClampedNumberInput label="Кругов" value={block.blockRounds} min={1} max={20} onCommit={(next) => commitExercises(syncBlockRounds([...latestExercises.current], block.blockId, next))} /></label>
          {blocks.length > 1 && reorderButtons(block.blockId, isFirst, isLast)}
          <OverflowMenu items={[
            ...(blocks.length > 1 && !reordering ? [{ label: 'Изменить порядок', onClick: () => setReordering(true) }] : []),
            { label: 'Разбить', onClick: () => commitExercises(splitBlock([...latestExercises.current], block.blockId)) },
          ]} />
        </div>
        <OptionalDetails className="block-options" summary="Настройки блока">
          <div className="block-rest">
            <label className="block-rest-field">Отдых между упр., с<ClampedNumberInput label="Отдых между упражнениями, с" value={block.restBetweenExercisesSec} min={0} max={600} onCommit={(next) => commitExercises(setBlockRest([...latestExercises.current], block.blockId, { betweenExercises: next }))} /></label>
            <label className="block-rest-field">Отдых между кругами, с<ClampedNumberInput label="Отдых между кругами, с" value={block.restBetweenRoundsSec} min={0} max={600} onCommit={(next) => commitExercises(setBlockRest([...latestExercises.current], block.blockId, { betweenRounds: next }))} /></label>
          </div>
        </OptionalDetails>
        {/* Список упражнений блока с удалением (значения — ниже по кругам). */}
        <div className="block-exercises">{block.items.map(({ exercise, index }) => <div className="block-exercise-row" key={exercise.blockId ? `${exercise.ref}-${index}` : index}><div className="block-exercise-head"><strong>{exercise.name}</strong><span className="exercise-head-actions"><OverflowMenu items={[
          { label: 'Заменить', onClick: () => onReplaceExercise(index) },
          { label: 'Удалить', danger: true, onClick: () => removeExercise(index) },
        ]} /></span></div>{showTrainerComments && <OptionalDetails className="exercise-comment-options" summary="Комментарий" initialOpen={Boolean(exercise.trainerComment)}>
          {commentField(exercise, index)}
        </OptionalDetails>}</div>)}</div>
        {rounds.map((round) => <div className="planned-round" key={round.round}>
          <div className="planned-round-label">Круг {round.round}</div>
          {round.items.map(({ exercise, exerciseIndex, setIndex }) => <div className="planned-round-exercise" key={`${exercise.ref}-${exerciseIndex}`}>
            <span className="planned-round-exercise-name">{exercise.name}</span>
            {setFields(exercise, exerciseIndex, setIndex)}
          </div>)}
        </div>)}
        {blockMergeIndex >= 0 && <button type="button" className="link block-merge" onClick={() => commitExercises(mergeBlockWithNext([...latestExercises.current], blockMergeIndex))}>⛓ Объединить со следующим в блок</button>}
      </div>
    })}
    {(hasExercises || showEmptyAddAction) && <div className="workout-editor-footer"><button type="button" className="secondary" onClick={onOpenPicker}>＋ Упражнение</button>{hasExercises && <OverflowMenu label="Действия с планом" trigger="Изменить все" items={planActions} />}</div>}
    {settingsExerciseIndex !== null && exercises[settingsExerciseIndex] && (() => {
      const exercise = exercises[settingsExerciseIndex]!
      const showRunningPresets = entryMode === 'plan' && exercise.ref === 'running' && exercise.inputKind === 'distance' && exercise.blockType !== 'group'
      const host = document.querySelector('.phone-frame') ?? document.body
      return createPortal(<div className="sheet-overlay exercise-settings-overlay" onClick={() => setSettingsExerciseIndex(null)}>
        <section className="exercise-settings-sheet" role="dialog" aria-modal="true" aria-label={`Настройки упражнения «${exercise.name}»`} onClick={(event) => event.stopPropagation()}>
          <header className="picker-header"><div><p className="eyebrow">НАСТРОЙКИ УПРАЖНЕНИЯ</p><h2>{exercise.name}</h2></div><button type="button" className="picker-close" aria-label="Закрыть" onClick={() => setSettingsExerciseIndex(null)}><CloseIcon /></button></header>
          <div className="exercise-settings-fields">
            <label className="field">Отдых между подходами, сек.<ClampedNumberInput label="Отдых между подходами, с" value={exercise.restBetweenSetsSec ?? 90} min={0} max={600} onCommit={(next) => { if (exercise.blockId) updateRestBetweenSets(exercise.blockId, next) }} /></label>
            {showTrainerComments && <label className="field">Заметка спортсмену{commentField(exercise, settingsExerciseIndex)}</label>}
            {showRunningPresets && <div className="running-preset-actions">
              <span>Быстрые схемы</span>
              <button type="button" className="secondary" onClick={applyPassiveRunningPreset}>6 × 400 м · отдых 90 с</button>
              <button type="button" className="secondary" onClick={applyActiveRunningPreset}>6 × 400 м + 90 с лёгкого бега</button>
            </div>}
          </div>
          <button type="button" className="secondary wide exercise-settings-done" onClick={() => setSettingsExerciseIndex(null)}>Готово</button>
        </section>
      </div>, host)
    })()}
    {confirmDialog}
  </section>
}
