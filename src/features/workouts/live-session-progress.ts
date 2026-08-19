export interface LiveProgressExercise {
  sets: Array<{ confirmedAt?: string | null }>
}

export interface LiveSessionProgress {
  activeExerciseNumber: number
  exerciseCount: number
  activeSetNumber: number
  activeExerciseSetCount: number
  completedSetCount: number
  setCount: number
  complete: boolean
  percent: number
}

export function liveSessionProgress(exercises: LiveProgressExercise[]): LiveSessionProgress {
  const sets = exercises.flatMap((exercise) => exercise.sets)
  const completedSetCount = sets.filter((set) => Boolean(set.confirmedAt)).length
  const activeExerciseIndex = exercises.findIndex((exercise) => exercise.sets.some((set) => !set.confirmedAt))
  const activeExercise = activeExerciseIndex >= 0 ? exercises[activeExerciseIndex] : exercises.at(-1)
  const activeSetIndex = activeExercise?.sets.findIndex((set) => !set.confirmedAt) ?? -1
  const complete = sets.length > 0 && completedSetCount === sets.length

  return {
    activeExerciseNumber: activeExerciseIndex >= 0 ? activeExerciseIndex + 1 : exercises.length,
    exerciseCount: exercises.length,
    activeSetNumber: activeSetIndex >= 0 ? activeSetIndex + 1 : activeExercise?.sets.length ?? 0,
    activeExerciseSetCount: activeExercise?.sets.length ?? 0,
    completedSetCount,
    setCount: sets.length,
    complete,
    percent: sets.length > 0 ? Math.round((completedSetCount / sets.length) * 100) : 0,
  }
}
