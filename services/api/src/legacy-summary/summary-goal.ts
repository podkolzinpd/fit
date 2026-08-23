type StructuredStage = {
  title: string
  startsOn: string
  endsOn: string
}

type StructuredGoal = {
  title: string
  targetDate: string | null
  stages: StructuredStage[]
}

export type TrainingGoalContext = {
  title: string
  target_date: string | null
  current_stage: {
    title: string
    starts_on: string
    ends_on: string
  } | null
} | null

function structuredGoal(value: unknown): StructuredGoal | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const item = value as Record<string, unknown>
  if (typeof item.title !== 'string' || !item.title.trim()) return null
  const stages = Array.isArray(item.stages)
    ? item.stages.flatMap((stage) => {
      if (!stage || typeof stage !== 'object' || Array.isArray(stage)) return []
      const value = stage as Record<string, unknown>
      return typeof value.title === 'string' && typeof value.startsOn === 'string' && typeof value.endsOn === 'string'
        ? [{ title: value.title.trim(), startsOn: value.startsOn, endsOn: value.endsOn }]
        : []
    })
    : []
  return {
    title: item.title.trim(),
    targetDate: typeof item.targetDate === 'string' ? item.targetDate : null,
    stages,
  }
}

export function buildTrainingGoalContext(
  profileGoal: string | null | undefined,
  rawStructuredGoal: unknown,
  onDate: string,
): TrainingGoalContext {
  const goal = structuredGoal(rawStructuredGoal)
  if (goal) {
    const stage = goal.stages.find((item) => item.startsOn <= onDate && item.endsOn >= onDate)
    return {
      title: goal.title,
      target_date: goal.targetDate,
      current_stage: stage
        ? { title: stage.title, starts_on: stage.startsOn, ends_on: stage.endsOn }
        : null,
    }
  }

  const title = profileGoal?.trim()
  return title ? { title, target_date: null, current_stage: null } : null
}
