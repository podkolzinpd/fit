import type { LiveSetDraft, Workout, WorkoutSet } from '../../shared/domain'

// Локальная копия live-тренировки должна сразу отражать автосохранённый факт.
// Иначе при переходе к следующей строке React сворачивает предыдущую по старым
// данным и временно показывает «Без значений», хотя запись уже отправлена.
export function applyLiveSetDraft(workout: Workout, setId: string, draft: LiveSetDraft, version: number): Workout {
  return {
    ...workout,
    exercises: workout.exercises.map((exercise) => ({
      ...exercise,
      sets: exercise.sets.map((set) => set.id === setId ? { ...set, fact: { ...draft }, version } : set),
    })),
  }
}

/** Возвращает строку с локально сохранённым черновиком, если realtime ещё не
 * успел отдать серверную версию. Так быстрый переход между подходами не стирает
 * введённые числа из компактного представления. */
export function setWithLocalDraft(set: WorkoutSet, draft: LiveSetDraft | undefined): WorkoutSet {
  return draft ? { ...set, fact: { ...draft } } : set
}

function carriedWeightSource(exercise: Pick<Workout['exercises'][number], 'sets'>, set: WorkoutSet): WorkoutSet | undefined {
  if (set.confirmedAt || set.fact.weightKg !== undefined || set.weightKg === undefined) return undefined
  const orderedSets = [...exercise.sets].sort((left, right) => left.position - right.position)
  const currentIndex = orderedSets.findIndex((candidate) => candidate.id === set.id)
  if (currentIndex < 0) return undefined

  for (let index = currentIndex - 1; index >= 0; index -= 1) {
    const previousSet = orderedSets[index]
    if (!previousSet || previousSet.weightKg !== set.weightKg) break
    if (previousSet.confirmedAt && previousSet.fact.weightKg !== undefined) return previousSet
  }
  return undefined
}

/** Stable key for remounting an untouched uncontrolled input when its carried
 * suggestion changes. It deliberately ignores the current local draft so
 * typing does not close the iOS keyboard. */
export function carriedLiveWeightKey(exercise: Pick<Workout['exercises'][number], 'sets'>, set: WorkoutSet): string {
  const source = carriedWeightSource(exercise, set)
  return source ? `${source.id}:${source.version}:${source.fact.weightKg}` : 'plan'
}

/**
 * Подставляет последний подтверждённый фактический вес в следующий нетронутый
 * подход той же плановой группы. Это только отображаемый draft: план и будущие
 * факты не меняются, пока пользователь не подтвердит сам подход.
 */
export function setWithCarriedLiveWeight(
  exercise: Pick<Workout['exercises'][number], 'sets'>,
  set: WorkoutSet,
  draft?: LiveSetDraft,
): WorkoutSet {
  const currentSet = setWithLocalDraft(set, draft)
  if (
    draft !== undefined
    || currentSet.confirmedAt
    || currentSet.fact.weightKg !== undefined
    || currentSet.weightKg === undefined
  ) return currentSet
  const source = carriedWeightSource(exercise, currentSet)
  return source
    ? { ...currentSet, fact: { ...currentSet.fact, weightKg: source.fact.weightKg } }
    : currentSet
}

export function sameLiveSetDraft(left: LiveSetDraft, right: LiveSetDraft): boolean {
  return left.weightKg === right.weightKg
    && left.reps === right.reps
    && left.durationSec === right.durationSec
    && left.durationMin === right.durationMin
    && left.distanceKm === right.distanceKm
    && left.rpe === right.rpe
}

/** Called only after confirmation succeeds, never optimistically before the RPC. */
export function applyLiveSetConfirmation(workout: Workout, setId: string, draft: LiveSetDraft, version: number, confirmedAt: string): Workout {
  const next = applyLiveSetDraft(workout, setId, draft, version)
  return { ...next, exercises: next.exercises.map((exercise) => ({ ...exercise,
    sets: exercise.sets.map((set) => set.id === setId ? { ...set, confirmedAt: set.confirmedAt ?? confirmedAt } : set),
  })) }
}

/** A refetch started before save/confirm must not undo an acknowledged set. */
export function reconcileLiveWorkout(current: Workout | undefined, incoming: Workout): Workout {
  if (!current || current.id !== incoming.id) return incoming
  if (current.version > incoming.version) return current
  const currentSets = new Map(current.exercises.flatMap((exercise) => exercise.sets).map((set) => [set.id, set]))
  return { ...incoming, exercises: incoming.exercises.map((exercise) => ({ ...exercise,
    sets: exercise.sets.map((set) => {
      const previous = currentSets.get(set.id)
      return previous && previous.version > set.version ? previous : set
    }),
  })) }
}
