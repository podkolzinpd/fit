import type {
  GoalCriterion,
  GoalCriterionMetric,
  GoalCriterionOperation,
  ProgressEntry,
  SaveGoalCriterionInput,
  StandardGoalCriterionMetric,
} from './domain'

export type GoalCriterionFoundationState = 'unconfigured' | 'needs_review' | 'needs_data' | 'configured'
type ProgressMeasurementKey = 'weightKg' | 'waistCm' | 'chestCm' | 'hipCm'
type GoalMetricFamily = 'standard' | 'exercise' | 'cardio' | 'regularity' | 'custom'

type GoalMetricDefinition = {
  label: string
  unit: string
  family: GoalMetricFamily
  progressKey?: ProgressMeasurementKey
}

export const GOAL_CRITERION_METRICS: Record<GoalCriterionMetric, GoalMetricDefinition> = {
  weight: { label: 'Вес', unit: 'кг', family: 'standard', progressKey: 'weightKg' },
  waist: { label: 'Талия', unit: 'см', family: 'standard', progressKey: 'waistCm' },
  chest: { label: 'Грудь', unit: 'см', family: 'standard', progressKey: 'chestCm' },
  hips: { label: 'Бёдра', unit: 'см', family: 'standard', progressKey: 'hipCm' },
  exercise_working_weight: { label: 'Рабочий вес', unit: 'кг', family: 'exercise' },
  exercise_reps: { label: 'Повторения', unit: 'повт.', family: 'exercise' },
  exercise_volume: { label: 'Объём', unit: 'кг·повт.', family: 'exercise' },
  exercise_best_result: { label: 'Лучший результат', unit: 'ед.', family: 'exercise' },
  cardio_distance: { label: 'Дистанция кардио', unit: 'км', family: 'cardio' },
  cardio_duration: { label: 'Длительность кардио', unit: 'мин', family: 'cardio' },
  cardio_pace: { label: 'Темп кардио', unit: 'мин/км', family: 'cardio' },
  cardio_distance_time: { label: 'Дистанция за время', unit: 'км', family: 'cardio' },
  workout_regularity: { label: 'Регулярность тренировок', unit: 'трен.', family: 'regularity' },
  custom: { label: 'Пользовательский показатель', unit: 'ед.', family: 'custom' },
}

export const GOAL_CRITERION_OPERATIONS: Record<GoalCriterionOperation, string> = {
  decrease_to: 'Снизить до',
  increase_to: 'Увеличить до',
  maintain_range: 'Удерживать в диапазоне',
  change_by: 'Изменить на',
  track_only: 'Только отслеживать',
}

export const GOAL_CRITERION_VALUE_POLICY: Record<GoalCriterionMetric, { min: number; max: number }> = {
  weight: { min: 1, max: 500 },
  waist: { min: 1, max: 500 },
  chest: { min: 1, max: 500 },
  hips: { min: 1, max: 500 },
  exercise_working_weight: { min: 0.1, max: 1_000 },
  exercise_reps: { min: 1, max: 10_000 },
  exercise_volume: { min: 0.1, max: 10_000_000 },
  exercise_best_result: { min: 0.1, max: 10_000_000 },
  cardio_distance: { min: 0.01, max: 1_000 },
  cardio_duration: { min: 0.1, max: 1_440 },
  cardio_pace: { min: 1, max: 60 },
  cardio_distance_time: { min: 0.01, max: 1_000 },
  workout_regularity: { min: 1, max: 31 },
  custom: { min: -999_999_999, max: 999_999_999 },
}

export function isStandardGoalCriterionMetric(metric: GoalCriterionMetric): metric is StandardGoalCriterionMetric {
  return GOAL_CRITERION_METRICS[metric].family === 'standard'
}

export function goalCriterionFoundationState(
  criterion: GoalCriterion | undefined,
  measurements: readonly ProgressEntry[],
): GoalCriterionFoundationState {
  if (!criterion) return 'unconfigured'
  if (criterion.confirmationStatus !== 'confirmed') return 'needs_review'
  if (!isStandardGoalCriterionMetric(criterion.metric)) return 'configured'
  const key = GOAL_CRITERION_METRICS[criterion.metric].progressKey!
  return measurements.some((entry) => Number.isFinite(entry[key])) ? 'configured' : 'needs_data'
}

export function goalCriterionTargetLabel(criterion: Pick<GoalCriterion, 'metric' | 'operation' | 'targetValue' | 'rangeMin' | 'rangeMax' | 'unit' | 'secondaryTargetValue' | 'secondaryUnit'>): string {
  const number = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 3 })
  if (criterion.operation === 'track_only') return 'Без числового ориентира'
  if (criterion.metric === 'cardio_distance_time') {
    return `${number.format(criterion.targetValue ?? 0)} ${criterion.unit} за ${number.format(criterion.secondaryTargetValue ?? 0)} ${criterion.secondaryUnit ?? 'мин'}`
  }
  if (criterion.operation === 'maintain_range') {
    return `${number.format(criterion.rangeMin ?? 0)}–${number.format(criterion.rangeMax ?? 0)} ${criterion.unit}`
  }
  if (criterion.operation === 'change_by') {
    const value = criterion.targetValue ?? 0
    return `изменить на ${value > 0 ? '+' : ''}${number.format(value)} ${criterion.unit}`
  }
  return `${GOAL_CRITERION_OPERATIONS[criterion.operation].toLocaleLowerCase('ru-RU')} ${number.format(criterion.targetValue ?? 0)} ${criterion.unit}`
}

function finiteInPolicy(value: number | null | undefined, metric: GoalCriterionMetric, signed = false): boolean {
  if (typeof value !== 'number' || !Number.isFinite(value)) return false
  const policy = GOAL_CRITERION_VALUE_POLICY[metric]
  return signed
    ? value !== 0 && Math.abs(value) <= Math.max(Math.abs(policy.min), Math.abs(policy.max))
    : value >= policy.min && value <= policy.max
}

export function validateGoalCriterionInput(input: SaveGoalCriterionInput): string | undefined {
  const definition = GOAL_CRITERION_METRICS[input.metric]
  if (!input.unit.trim() || input.unit.length > 40) return 'Укажите единицу измерения'
  if (definition.family !== 'custom' && input.metric !== 'exercise_best_result' && input.unit !== definition.unit) {
    return `Для показателя «${definition.label}» используется единица «${definition.unit}»`
  }
  if (definition.family === 'exercise' || definition.family === 'cardio') {
    if (!input.exerciseRef?.trim() || !input.exerciseName?.trim()
      || (input.exerciseSource !== 'system' && input.exerciseSource !== 'custom')
      || (input.exerciseSource === 'custom') !== Boolean(input.customExerciseId)) {
      return 'Выберите существующее упражнение из каталога'
    }
  }
  if (definition.family === 'custom' && (!input.customMetricId || !input.customMetricName?.trim())) {
    return 'Выберите существующий пользовательский показатель'
  }
  if (definition.family === 'regularity') {
    if ((input.regularityPeriod !== 'week' && input.regularityPeriod !== 'month')
      || (input.regularityMode !== 'average' && input.regularityMode !== 'each_period')) {
      return 'Укажите период и способ проверки регулярности'
    }
  }
  if (input.metric === 'cardio_distance_time') {
    return input.operation === 'increase_to'
      && finiteInPolicy(input.targetValue, input.metric)
      && finiteInPolicy(input.secondaryTargetValue, 'cardio_duration')
      && input.rangeMin == null && input.rangeMax == null && input.secondaryUnit === 'мин'
      ? undefined : 'Укажите дистанцию и время одной кардиотренировки'
  }
  if (input.operation === 'change_by' && definition.family !== 'standard') {
    return 'Относительное изменение доступно для стандартных замеров'
  }
  if (input.operation === 'track_only') {
    return input.targetValue == null && input.rangeMin == null && input.rangeMax == null
      ? undefined : 'Для отслеживания без ориентира числовые значения не нужны'
  }
  if (input.operation === 'maintain_range') {
    if (!(input.targetValue == null
      && finiteInPolicy(input.rangeMin, input.metric)
      && finiteInPolicy(input.rangeMax, input.metric)
      && input.rangeMax! >= input.rangeMin!)) return 'Укажите корректный диапазон'
    return undefined
  }
  const targetValid = input.operation === 'change_by'
    ? finiteInPolicy(input.targetValue, input.metric, true)
    : finiteInPolicy(input.targetValue, input.metric)
  if (input.targetValue == null) return 'Укажите целевое значение'
  if (!(targetValid && input.rangeMin == null && input.rangeMax == null)) return 'Укажите допустимое целевое значение'
  if (input.metric === 'workout_regularity' && !Number.isInteger(input.targetValue)) {
    return 'Количество тренировок должно быть целым числом'
  }
  return undefined
}
