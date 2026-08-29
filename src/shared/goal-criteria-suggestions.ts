import type { CustomMetric, ExerciseSnapshot, SaveGoalCriterionInput } from './domain'
import { GOAL_CRITERION_METRICS, validateGoalCriterionInput } from './goal-criterion-rules'

export interface GoalCriteriaSuggestionResult {
  criteria: SaveGoalCriterionInput[]
  needsInput: Array<{ message: string; exerciseRefs: string[] }>
  unsupportedReason: string | null
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function optionalFinite(value: unknown): number | null | undefined {
  return value === null || value === undefined ? null : typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

export function validateGoalCriteriaSuggestion(
  value: unknown,
  exercises: readonly ExerciseSnapshot[],
  customMetrics: readonly CustomMetric[],
): GoalCriteriaSuggestionResult {
  const root = record(value)
  if (!root || !Array.isArray(root.criteria) || !Array.isArray(root.needsInput)
    || !(root.unsupportedReason === null || typeof root.unsupportedReason === 'string')) throw new Error('invalid_goal_suggestion')
  const exerciseByRef = new Map(exercises.map((exercise) => [exercise.ref, exercise]))
  const metricById = new Map(customMetrics.filter((metric) => !metric.archivedAt).map((metric) => [metric.id, metric]))
  const criteria = root.criteria.map((raw, position) => {
    const item = record(raw)
    if (!item || typeof item.metric !== 'string' || !(item.metric in GOAL_CRITERION_METRICS)
      || !['decrease_to', 'increase_to', 'maintain_range', 'change_by', 'track_only'].includes(String(item.operation))) throw new Error('invalid_goal_suggestion')
    const metric = item.metric as SaveGoalCriterionInput['metric']
    const targetValue = optionalFinite(item.targetValue)
    const rangeMin = optionalFinite(item.rangeMin)
    const rangeMax = optionalFinite(item.rangeMax)
    const secondaryTargetValue = optionalFinite(item.secondaryTargetValue)
    if (targetValue === undefined || rangeMin === undefined || rangeMax === undefined || secondaryTargetValue === undefined) throw new Error('invalid_goal_suggestion')
    const result: SaveGoalCriterionInput = {
      metric, operation: item.operation as SaveGoalCriterionInput['operation'], targetValue, rangeMin, rangeMax,
      unit: typeof item.unit === 'string' ? item.unit : GOAL_CRITERION_METRICS[metric].unit,
      secondaryTargetValue, secondaryUnit: typeof item.secondaryUnit === 'string' ? item.secondaryUnit : null,
      confirmationStatus: 'confirmed', position,
    }
    if (GOAL_CRITERION_METRICS[metric].family === 'exercise' || GOAL_CRITERION_METRICS[metric].family === 'cardio') {
      if (typeof item.exerciseRef !== 'string') throw new Error('invalid_goal_suggestion')
      const exercise = exerciseByRef.get(item.exerciseRef)
      if (!exercise) throw new Error('invalid_goal_suggestion')
      Object.assign(result, { exerciseSource: exercise.source, exerciseRef: exercise.ref, exerciseName: exercise.name, customExerciseId: exercise.customExerciseId ?? null })
    }
    if (metric === 'custom') {
      if (typeof item.customMetricId !== 'string') throw new Error('invalid_goal_suggestion')
      const custom = metricById.get(item.customMetricId)
      if (!custom) throw new Error('invalid_goal_suggestion')
      Object.assign(result, { customMetricId: custom.id, customMetricName: custom.name, unit: custom.unit ?? 'ед.' })
    }
    if (metric === 'workout_regularity') {
      if (!['week', 'month'].includes(String(item.regularityPeriod)) || !['average', 'each_period'].includes(String(item.regularityMode))) throw new Error('invalid_goal_suggestion')
      Object.assign(result, { regularityPeriod: item.regularityPeriod, regularityMode: item.regularityMode })
    }
    if (validateGoalCriterionInput(result)) throw new Error('invalid_goal_suggestion')
    return result
  })
  if (criteria.length > 10) throw new Error('invalid_goal_suggestion')
  const needsInput = root.needsInput.map((raw) => {
    const item = record(raw)
    if (!item || typeof item.message !== 'string' || !Array.isArray(item.exerciseRefs)) throw new Error('invalid_goal_suggestion')
    const exerciseRefs = item.exerciseRefs.filter((ref): ref is string => typeof ref === 'string' && exerciseByRef.has(ref)).slice(0, 4)
    if (!item.message.trim()) throw new Error('invalid_goal_suggestion')
    return { message: item.message.trim(), exerciseRefs }
  })
  return { criteria, needsInput, unsupportedReason: root.unsupportedReason?.trim() || null }
}
