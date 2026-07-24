import type { BlockType, WorkoutExerciseDraft, WorkoutSetDraft } from '../../shared/domain'
import { groupDraftsIntoBlocks, mergeBlockWithNext, moveBlock, nextSetDraft, setBlockType, splitBlock, syncBlockRounds, draftBlockRoundsView } from '../../data/repositories/workout-rules'

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
}

function inputNumber(value: string): number | undefined {
  return value === '' ? undefined : Number(value)
}

export function WorkoutExerciseEditor({ exercises, onChange, onOpenPicker }: WorkoutExerciseEditorProps) {
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
      <header><strong>{exercise.name}</strong><span className="exercise-head-actions">{reorder}<button type="button" className="link danger" onClick={() => removeExercise(exerciseIndex)}>Удалить</button></span></header>
      {exercise.sets.map((_set, setIndex) => <div className="planned-set" key={setIndex}>
        <div className="planned-set-heading"><span>Подход {setIndex + 1}</span>{exercise.sets.length > 1 && <button type="button" className="link danger" aria-label={`Удалить подход ${setIndex + 1}`} onClick={() => removeSet(exerciseIndex, setIndex)}>×</button>}</div>
        {setFields(exercise, exerciseIndex, setIndex)}
      </div>)}
      <button type="button" className="secondary" onClick={() => addSet(exerciseIndex)}>＋ Подход</button>
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
          <select aria-label="Тип блока" value={block.blockType} onChange={(event) => onChange(setBlockType([...exercises], block.blockId, event.target.value as BlockType))}>
            <option value="superset">Суперсет</option>
            <option value="triset">Трисет</option>
            <option value="circuit">Круговая</option>
          </select>
          <label className="block-rounds">Кругов<input aria-label="Кругов" type="number" min="1" max="20" value={block.blockRounds} onChange={(event) => onChange(syncBlockRounds([...exercises], block.blockId, Number(event.target.value) || 1))} /></label>
          {blocks.length > 1 && reorderButtons(block.blockId, isFirst, isLast)}
          <button type="button" className="link" onClick={() => onChange(splitBlock([...exercises], block.blockId))}>Разбить</button>
        </div>
        {/* Список упражнений блока с удалением (значения — ниже по кругам). */}
        <div className="block-exercises">{block.items.map(({ exercise, index }) => <div className="block-exercise-row" key={exercise.blockId ? `${exercise.ref}-${index}` : index}><strong>{exercise.name}</strong><button type="button" className="link danger" onClick={() => removeExercise(index)}>Удалить</button></div>)}</div>
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
