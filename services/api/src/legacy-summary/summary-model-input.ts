type SummaryExercise = {
  name: string
  kind: string
  session_count: number
  first_session?: unknown
  last_session?: unknown
  change_percent?: unknown
  best?: unknown
}

type SummaryTrainingData = {
  period: unknown
  consistency: unknown
  goal: unknown
  exercises: SummaryExercise[]
}

/**
 * Keeps the model request bounded without losing the aggregates used for the
 * progress conclusions. Raw per-session series remain in the fingerprint and
 * deterministic display facts, but are not repeated in the LLM prompt.
 */
export function buildSummaryModelInput(
  trainingData: SummaryTrainingData,
  exerciseLimit = 12,
) {
  return {
    period: trainingData.period,
    consistency: trainingData.consistency,
    goal: trainingData.goal,
    exercises: trainingData.exercises
      .slice(0, Math.max(0, exerciseLimit))
      .map((exercise) => ({
        name: exercise.name,
        kind: exercise.kind,
        session_count: exercise.session_count,
        first_session: exercise.first_session,
        last_session: exercise.last_session,
        change_percent: exercise.change_percent,
        best: exercise.best,
      })),
  }
}
