import type {
  GoalCriterion,
  GoalCriterionMetric,
  GoalCriterionOperation,
  ProgressEntry,
  SaveGoalCriterionInput,
} from './domain'

export type GoalCriterionFoundationState = 'unconfigured' | 'needs_review' | 'needs_data' | 'configured'
type ProgressMeasurementKey = 'weightKg' | 'waistCm' | 'chestCm' | 'hipCm'

export const GOAL_CRITERION_METRICS: Record<GoalCriterionMetric, { label: string; unit: string; progressKey: ProgressMeasurementKey }> = {
  weight: { label: 'Вес', unit: 'кг', progressKey: 'weightKg' },
  waist: { label: 'Талия', unit: 'см', progressKey: 'waistCm' },
  chest: { label: 'Грудь', unit: 'см', progressKey: 'chestCm' },
  hips: { label: 'Бёдра', unit: 'см', progressKey: 'hipCm' },
}

export const GOAL_CRITERION_OPERATIONS: Record<GoalCriterionOperation, string> = {
  decrease_to: 'Снизить до',
  increase_to: 'Увеличить до',
  maintain_range: 'Удерживать в диапазоне',
  change_by: 'Изменить на',
  track_only: 'Только отслеживать',
}

export function goalCriterionFoundationState(
  criterion: GoalCriterion | undefined,
  measurements: readonly ProgressEntry[],
): GoalCriterionFoundationState {
  if (!criterion) return 'unconfigured'
  if (criterion.confirmationStatus !== 'confirmed') return 'needs_review'
  const key = GOAL_CRITERION_METRICS[criterion.metric].progressKey
  return measurements.some((entry) => Number.isFinite(entry[key])) ? 'configured' : 'needs_data'
}

export function goalCriterionTargetLabel(criterion: Pick<GoalCriterion, 'operation' | 'targetValue' | 'rangeMin' | 'rangeMax' | 'unit'>): string {
  const number = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 3 })
  if (criterion.operation === 'track_only') return 'Без числового ориентира'
  if (criterion.operation === 'maintain_range') {
    return `${number.format(criterion.rangeMin ?? 0)}–${number.format(criterion.rangeMax ?? 0)} ${criterion.unit}`
  }
  if (criterion.operation === 'change_by') {
    const value = criterion.targetValue ?? 0
    return `изменить на ${value > 0 ? '+' : ''}${number.format(value)} ${criterion.unit}`
  }
  return `${GOAL_CRITERION_OPERATIONS[criterion.operation].toLocaleLowerCase('ru-RU')} ${number.format(criterion.targetValue ?? 0)} ${criterion.unit}`
}

export function validateGoalCriterionInput(input: SaveGoalCriterionInput): string | undefined {
  const metric = GOAL_CRITERION_METRICS[input.metric]
  if (input.unit !== metric.unit) return `Для показателя «${metric.label}» используется единица «${metric.unit}»`
  if (input.operation === 'track_only') {
    return input.targetValue == null && input.rangeMin == null && input.rangeMax == null
      ? undefined : 'Для отслеживания без ориентира числовые значения не нужны'
  }
  if (input.operation === 'maintain_range') {
    if (!(input.targetValue == null
      && typeof input.rangeMin === 'number' && Number.isFinite(input.rangeMin) && input.rangeMin > 0
      && typeof input.rangeMax === 'number' && Number.isFinite(input.rangeMax) && input.rangeMax >= input.rangeMin)) {
      return 'Укажите корректный диапазон'
    }
    return undefined
  }
  const targetValid = input.operation === 'change_by'
    ? typeof input.targetValue === 'number' && Number.isFinite(input.targetValue) && input.targetValue !== 0
    : typeof input.targetValue === 'number' && Number.isFinite(input.targetValue) && input.targetValue > 0
  if (!(targetValid
    && input.rangeMin == null && input.rangeMax == null)) return 'Укажите целевое значение'
  return undefined
}
