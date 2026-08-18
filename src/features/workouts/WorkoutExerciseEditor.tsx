import { useEffect, useState, type ReactNode } from 'react'
import type { BlockPreset, WorkoutExerciseDraft, WorkoutSetDraft } from '../../shared/domain'
import { formatLocalDate } from '../../shared/local-date'
import { RPE_OPTIONS } from '../../shared/rpe'
import type { PreviousExerciseResult } from '../../data/repositories/workouts.repository'
import { applyRunningActiveRecoveryPreset, applyRunningIntervalPreset, groupDraftsIntoBlocks, mergeBlockWithNext, moveBlock, nextSetDraft, previousResultLine, setBlockPreset, setBlockRest, splitBlock, syncBlockRounds, draftBlockRoundsView } from '../../data/repositories/workout-rules'
import { OverflowMenu } from '../../shared/ui'
import { WorkoutExerciseHeader } from './WorkoutExerciseHeader'
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
}

function inputNumber(value: string): number | undefined {
  return value === '' ? undefined : Number(value)
}

export function WorkoutExerciseEditor({ exercises, onChange, onOpenPicker, onReplaceExercise, showTrainerComments = true, entryMode = 'plan', hideEmptyAddAction = false, previousResults = new Map(), showRpeByDefault = false }: WorkoutExerciseEditorProps) {
  const [reordering, setReordering] = useState(false)
  // Точечный выбор из меню имеет приоритет над общей настройкой тренера.
  const [rpeOverrides, setRpeOverrides] = useState<Map<number, boolean>>(() => new Map())
  function isRpeVisible(exerciseIndex: number) {
    return rpeOverrides.get(exerciseIndex) ?? showRpeByDefault
  }
  function toggleRpe(exerciseIndex: number) {
    setRpeOverrides((current) => new Map(current).set(exerciseIndex, !isRpeVisible(exerciseIndex)))
  }
  function updateComment(exerciseIndex: number, comment: string) {
    onChange(exercises.map((exercise, current) => current === exerciseIndex ? { ...exercise, trainerComment: comment || undefined } : exercise))
  }
  // Поле комментария тренера к упражнению (техника/ограничения/заметка).
  function commentField(exercise: WorkoutExerciseDraft, exerciseIndex: number) {
    if (!showTrainerComments) return null
    return <textarea className="exercise-comment" aria-label="Комментарий к упражнению" placeholder="Комментарий к упражнению…" rows={1} value={exercise.trainerComment ?? ''} onChange={(event) => updateComment(exerciseIndex, event.target.value)} />
  }
  function updateSet(exerciseIndex: number, setIndex: number, patch: Partial<WorkoutSetDraft>) {
    onChange(exercises.map((exercise, currentExercise) => currentExercise === exerciseIndex ? {
      ...exercise,
      sets: exercise.sets.map((set, currentSet) => currentSet === setIndex ? { ...set, ...patch } : set),
    } : exercise))
  }
  function addSet(exerciseIndex: number) {
    onChange(exercises.map((exercise, current) => current === exerciseIndex ? {
      ...exercise, sets: [...exercise.sets, nextSetDraft(exercise.sets, exercise.inputKind)],
    } : exercise))
  }
  function removeSet(exerciseIndex: number, setIndex: number) {
    onChange(exercises.map((exercise, current) => current === exerciseIndex ? {
      ...exercise,
      sets: exercise.sets.filter((_, index) => index !== setIndex).map((set, position) => ({ ...set, position })),
    } : exercise))
  }
  function removeExercise(exerciseIndex: number) {
    onChange(exercises.filter((_, index) => index !== exerciseIndex).map((exercise, position) => ({ ...exercise, position })))
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
        durationSec={durationSec}
        distanceKm={set.distanceKm}
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
      <button type="button" className="reorder-btn" aria-label="Вверх" disabled={isFirst} onClick={() => onChange(moveBlock([...exercises], blockId, -1))}>↑</button>
      <button type="button" className="reorder-btn" aria-label="Вниз" disabled={isLast} onClick={() => onChange(moveBlock([...exercises], blockId, 1))}>↓</button>
    </span>
  }

  // Одиночное упражнение (вне блока): подходы + «＋ Подход» + «Объединить».
  function renderExercise(exercise: WorkoutExerciseDraft, exerciseIndex: number, canMergeNext: boolean, reorder?: React.ReactNode, canReorder = false) {
    const showRpe = isRpeVisible(exerciseIndex)
    const showRunningPresets = entryMode === 'plan' && exercise.ref === 'running' && exercise.inputKind === 'distance' && exercise.blockType !== 'group'
    const hasCustomRest = exercise.restBetweenSetsSec !== undefined && exercise.restBetweenSetsSec !== 90
    const hasComment = Boolean(exercise.trainerComment)
    const detailsHint = hasComment || hasCustomRest
      ? <span className="exercise-options-hint">{[hasComment ? 'заметка' : '', hasCustomRest ? `отдых ${exercise.restBetweenSetsSec} с` : ''].filter(Boolean).join(' · ')}</span>
      : null
    return <WorkoutExercise state="planned" className="exercise planned-exercise" key={`${exercise.ref}-${exerciseIndex}`}>
      <WorkoutExerciseHeader as="header" titleAs="strong" className="planned-exercise-head" name={exercise.name} actions={<>{reorder}<OverflowMenu items={[
        ...(canReorder && !reordering ? [{ label: 'Изменить порядок', onClick: () => setReordering(true) }] : []),
        { label: showRpe ? 'Скрыть RPE' : 'Указать RPE', onClick: () => toggleRpe(exerciseIndex) },
        ...(canMergeNext ? [{ label: 'Объединить со следующим в блок', onClick: () => onChange(mergeBlockWithNext([...exercises], exerciseIndex)) }] : []),
        { label: 'Заменить', onClick: () => onReplaceExercise(exerciseIndex) },
        { label: 'Удалить', danger: true, onClick: () => removeExercise(exerciseIndex) },
      ]} /></>} />
      {(() => { const previous = previousResults.get(exercise.ref); const line = previous && previousResultLine(previous.sets); return line ? <p className="exercise-prefill-note">В прошлый раз: {line}</p> : exercise.prefilledFromDate ? <p className="exercise-prefill-note">Значения с тренировки {formatLocalDate(exercise.prefilledFromDate)}</p> : null })()}
      <WorkoutSetTable variant="planned" inputKind={exercise.inputKind} showRpe={showRpe}>
        {exercise.sets.map((_set, setIndex) => <WorkoutSetRow state="planned" className={`planned-set ${showRpe ? 'rpe-visible' : ''}`} key={setIndex}>
          <span className="workout-set-number planned-set-number" aria-hidden="true">{setIndex + 1}</span>
          <span className="sr-only">Подход {setIndex + 1}</span>
          {setFields(exercise, exerciseIndex, setIndex, showRpe)}
          {exercise.sets.length > 1
            ? <button type="button" className="link danger planned-set-remove" aria-label={`Удалить подход ${setIndex + 1}`} onClick={() => removeSet(exerciseIndex, setIndex)}>×</button>
            : <span className="planned-set-remove" aria-hidden="true" />}
        </WorkoutSetRow>)}
      </WorkoutSetTable>
      <div className="set-add-row">
        <button type="button" className="secondary" onClick={() => addSet(exerciseIndex)}>＋ Подход</button>
      </div>
      <OptionalDetails summary={<><span>Дополнительно</span>{detailsHint}</>}>
        <div className="exercise-options-fields">
          {showRunningPresets && <div className="running-preset-actions">
            <span>Быстрые схемы</span>
            <button type="button" className="secondary" onClick={() => onChange(applyRunningIntervalPreset([...exercises], exerciseIndex))}>6 × 400 м · отдых 90 с</button>
            <button type="button" className="secondary" onClick={() => onChange(applyRunningActiveRecoveryPreset([...exercises], exerciseIndex))}>6 × 400 м + 90 с лёгкого бега</button>
          </div>}
          <label className="block-rest-field"><ClampedNumberInput label="Отдых между подходами, с" value={exercise.restBetweenSetsSec ?? 90} min={0} max={600} onCommit={(next) => { if (exercise.blockId) onChange(setBlockRest([...exercises], exercise.blockId, { betweenSets: next })) }} /><span>Отдых, с</span></label>
          {commentField(exercise, exerciseIndex)}
        </div>
      </OptionalDetails>
    </WorkoutExercise>
  }

  const hasExercises = exercises.length > 0
  const showEmptyAddAction = !hideEmptyAddAction

  return <section className="workout-exercise-editor">
    {hasExercises && <div className="workout-editor-heading"><h2>Упражнения</h2>{reordering ? <div className="reorder-mode"><span>Изменение порядка</span><button type="button" className="link" onClick={() => setReordering(false)}>Готово</button></div> : <div className="workout-tools"><button type="button" className="link" onClick={() => onChange(clearWorkoutLoad(exercises))}>Сбросить значения</button><button type="button" className="link" onClick={() => onChange(adjustWorkoutLoad(exercises, .95))}>−5%</button><button type="button" className="link" onClick={() => onChange(adjustWorkoutLoad(exercises, 1.05))}>+5%</button></div>}</div>}
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
          <select aria-label="Тип блока" value={block.blockPreset} onChange={(event) => onChange(setBlockPreset([...exercises], block.blockId, event.target.value as BlockPreset))}>
            <option value="set">Сет</option>
            <option value="circuit">Круговая</option>
            <option value="interval">Интервалы</option>
          </select>
          <label className="block-rounds">Кругов<ClampedNumberInput label="Кругов" value={block.blockRounds} min={1} max={20} onCommit={(next) => onChange(syncBlockRounds([...exercises], block.blockId, next))} /></label>
          {blocks.length > 1 && reorderButtons(block.blockId, isFirst, isLast)}
          <OverflowMenu items={[
            ...(blocks.length > 1 && !reordering ? [{ label: 'Изменить порядок', onClick: () => setReordering(true) }] : []),
            { label: 'Разбить', onClick: () => onChange(splitBlock([...exercises], block.blockId)) },
          ]} />
        </div>
        <OptionalDetails className="block-options" summary="Настройки блока">
          <div className="block-rest">
            <label className="block-rest-field">Отдых между упр., с<ClampedNumberInput label="Отдых между упражнениями, с" value={block.restBetweenExercisesSec} min={0} max={600} onCommit={(next) => onChange(setBlockRest([...exercises], block.blockId, { betweenExercises: next }))} /></label>
            <label className="block-rest-field">Отдых между кругами, с<ClampedNumberInput label="Отдых между кругами, с" value={block.restBetweenRoundsSec} min={0} max={600} onCommit={(next) => onChange(setBlockRest([...exercises], block.blockId, { betweenRounds: next }))} /></label>
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
        {blockMergeIndex >= 0 && <button type="button" className="link block-merge" onClick={() => onChange(mergeBlockWithNext([...exercises], blockMergeIndex))}>⛓ Объединить со следующим в блок</button>}
      </div>
    })}
    {(hasExercises || showEmptyAddAction) && <button type="button" className="secondary wide" onClick={onOpenPicker}>＋ Упражнение</button>}
  </section>
}
