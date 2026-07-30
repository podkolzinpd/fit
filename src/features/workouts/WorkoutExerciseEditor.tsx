import { useEffect, useState, type ReactNode } from 'react'
import type { BlockPreset, WorkoutExerciseDraft, WorkoutSetDraft } from '../../shared/domain'
import { groupDraftsIntoBlocks, mergeBlockWithNext, moveBlock, nextSetDraft, PRESET_REST_DEFAULTS, setBlockPreset, setBlockRest, splitBlock, syncBlockRounds, draftBlockRoundsView } from '../../data/repositories/workout-rules'
import { OverflowMenu } from '../../shared/ui'

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
  summary: string
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
}

function inputNumber(value: string): number | undefined {
  return value === '' ? undefined : Number(value)
}

export function WorkoutExerciseEditor({ exercises, onChange, onOpenPicker, onReplaceExercise, showTrainerComments = true }: WorkoutExerciseEditorProps) {
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
  function setFields(exercise: WorkoutExerciseDraft, exerciseIndex: number, setIndex: number) {
    const set = exercise.sets[setIndex]
    if (!set) return null
    return <div className="set-row" key={setIndex}>
      {exercise.inputKind === 'strength' && <><input aria-label={`Вес, подход ${setIndex + 1}`} type="number" min="0" step="0.5" placeholder="кг" value={set.weightKg ?? ''} onChange={(event) => updateSet(exerciseIndex, setIndex, { weightKg: inputNumber(event.target.value) })} /><input aria-label={`Повторы, подход ${setIndex + 1}`} type="number" min="0" placeholder="повт." value={set.reps ?? ''} onChange={(event) => updateSet(exerciseIndex, setIndex, { reps: inputNumber(event.target.value) })} /></>}
      {exercise.inputKind === 'reps' && <><input aria-label={`Время, подход ${setIndex + 1}`} type="number" min="0" step="0.5" placeholder="мин" value={set.durationMin ?? ''} onChange={(event) => updateSet(exerciseIndex, setIndex, { durationMin: inputNumber(event.target.value) })} /><input aria-label={`Повторы, подход ${setIndex + 1}`} type="number" min="0" placeholder="повт." value={set.reps ?? ''} onChange={(event) => updateSet(exerciseIndex, setIndex, { reps: inputNumber(event.target.value) })} /></>}
      {exercise.inputKind === 'distance' && <><input aria-label={`Время, подход ${setIndex + 1}`} type="number" min="0" step="0.5" placeholder="мин" value={set.durationMin ?? ''} onChange={(event) => updateSet(exerciseIndex, setIndex, { durationMin: inputNumber(event.target.value) })} /><input aria-label={`Расстояние, подход ${setIndex + 1}`} type="number" min="0" step="0.1" placeholder="км" value={set.distanceKm ?? ''} onChange={(event) => updateSet(exerciseIndex, setIndex, { distanceKm: inputNumber(event.target.value) })} /></>}
    </div>
  }

  // Стрелки перемещения блока вверх/вниз (задизейблены на границах).
  function reorderButtons(blockId: string, isFirst: boolean, isLast: boolean) {
    return <span className="block-reorder">
      <button type="button" className="reorder-btn" aria-label="Вверх" disabled={isFirst} onClick={() => onChange(moveBlock([...exercises], blockId, -1))}>↑</button>
      <button type="button" className="reorder-btn" aria-label="Вниз" disabled={isLast} onClick={() => onChange(moveBlock([...exercises], blockId, 1))}>↓</button>
    </span>
  }

  // Одиночное упражнение (вне блока): подходы + «＋ Подход» + «Объединить».
  function renderExercise(exercise: WorkoutExerciseDraft, exerciseIndex: number, canMergeNext: boolean, reorder?: React.ReactNode) {
    return <article className="exercise" key={`${exercise.ref}-${exerciseIndex}`}>
      <header><strong>{exercise.name}</strong><span className="exercise-head-actions">{reorder}<OverflowMenu items={[
        { label: 'Заменить', onClick: () => onReplaceExercise(exerciseIndex) },
        { label: 'Удалить', danger: true, onClick: () => removeExercise(exerciseIndex) },
      ]} /></span></header>
      {exercise.sets.map((_set, setIndex) => <div className="planned-set" key={setIndex}>
        <div className="planned-set-heading"><span>Подход {setIndex + 1}</span>{exercise.sets.length > 1 && <button type="button" className="link danger" aria-label={`Удалить подход ${setIndex + 1}`} onClick={() => removeSet(exerciseIndex, setIndex)}>×</button>}</div>
        {setFields(exercise, exerciseIndex, setIndex)}
      </div>)}
      <div className="set-add-row">
        <button type="button" className="secondary" onClick={() => addSet(exerciseIndex)}>＋ Подход</button>
      </div>
      <OptionalDetails summary="Дополнительно" initialOpen={Boolean(exercise.trainerComment || (exercise.restBetweenSetsSec !== undefined && exercise.restBetweenSetsSec !== 90))}>
        <div className="exercise-options-fields">
          <label className="block-rest-field"><ClampedNumberInput label="Отдых между подходами, с" value={exercise.restBetweenSetsSec ?? 90} min={0} max={600} onCommit={(next) => { if (exercise.blockId) onChange(setBlockRest([...exercises], exercise.blockId, { betweenSets: next })) }} /><span>Отдых, с</span></label>
          {commentField(exercise, exerciseIndex)}
        </div>
      </OptionalDetails>
      {canMergeNext && <button type="button" className="link block-merge" onClick={() => onChange(mergeBlockWithNext([...exercises], exerciseIndex))}>⛓ Объединить со следующим в блок</button>}
    </article>
  }

  return <section>
    <div className="workout-editor-heading"><h2>Упражнения</h2>{exercises.length > 0 && <div className="workout-tools"><button type="button" className="link" onClick={() => onChange(clearWorkoutLoad(exercises))}>Сбросить значения</button><button type="button" className="link" onClick={() => onChange(adjustWorkoutLoad(exercises, .95))}>−5%</button><button type="button" className="link" onClick={() => onChange(adjustWorkoutLoad(exercises, 1.05))}>+5%</button></div>}</div>
    {blocks.map((block, blockIndex) => {
      const lastIndex = exercises.length - 1
      const isFirst = blockIndex === 0
      const isLast = blockIndex === blocks.length - 1
      // «Объединить» показываем на последнем упражнении блока, если дальше есть ещё.
      const blockLastIndex = block.items[block.items.length - 1]!.index
      const canMerge = (index: number) => index === blockLastIndex && index < lastIndex
      if (block.items.length === 1) {
        const { exercise, index } = block.items[0]!
        return renderExercise(exercise, index, canMerge(index), blocks.length > 1 ? reorderButtons(block.blockId, isFirst, isLast) : undefined)
      }
      // Многоэлементный блок: раскладка ПО КРУГАМ (круг = все упражнения по очереди).
      const rounds = draftBlockRoundsView(block)
      const blockMergeIndex = blockLastIndex < lastIndex ? blockLastIndex : -1
      return <div className="exercise-block" key={block.blockId}>
        <div className="exercise-block-head">
          <select aria-label="Тип блока" value={block.blockPreset} onChange={(event) => onChange(setBlockPreset([...exercises], block.blockId, event.target.value as BlockPreset))}>
            <option value="set">Сет</option>
            <option value="circuit">Круговая</option>
          </select>
          <label className="block-rounds">Кругов<ClampedNumberInput label="Кругов" value={block.blockRounds} min={1} max={20} onCommit={(next) => onChange(syncBlockRounds([...exercises], block.blockId, next))} /></label>
          {blocks.length > 1 && reorderButtons(block.blockId, isFirst, isLast)}
          <button type="button" className="link" onClick={() => onChange(splitBlock([...exercises], block.blockId))}>Разбить</button>
        </div>
        <OptionalDetails className="block-options" summary="Настройки блока" initialOpen={(() => {
          const defaults = PRESET_REST_DEFAULTS[block.blockPreset]
          return block.restBetweenExercisesSec !== defaults.betweenExercises || block.restBetweenRoundsSec !== defaults.betweenRounds
        })()}>
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
    <button type="button" className="secondary wide" onClick={onOpenPicker}>＋ Упражнение</button>
  </section>
}
