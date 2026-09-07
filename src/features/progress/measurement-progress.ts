import type {
  ClientGoal,
  CustomMetric,
  GoalCriterion,
  ProgressEntry,
  StandardGoalCriterionMetric,
} from '../../shared/domain'
import { goalCriterionTargetLabel } from '../../shared/goal-criterion-rules'
import { STANDARD_GOAL_PROGRESS_POLICY } from '../../shared/goal-progress'
import { daysBetween, type LocalDate } from '../../shared/local-date'
import type { MetricSelector } from './ProgressChart'

export const MEASUREMENT_PROGRESS_POLICY = {
  customFreshnessDays: 30,
  minimumPointsForDynamics: 2,
  minimumPointsForFluctuation: 3,
  plateauAbsoluteEpsilon: 0.05,
  plateauRelativeEpsilon: 0.005,
  noticeableRelativeChange: 0.02,
  maximumVisibleMetrics: 6,
  maximumExplanationLength: 180,
  maximumExplanationSentences: 2,
} as const

export type MeasurementTrend = 'increase' | 'decrease' | 'plateau' | 'fluctuation' | 'insufficient_data'
export type MeasurementFreshness = 'fresh' | 'stale' | 'no_data'
export type MeasurementSufficiency = 'none' | 'position_only' | 'enough_for_dynamics'

export interface MeasurementObservation {
  entryId: string
  date: LocalDate
  value: number
}

export interface MeasurementGoalGuide {
  min: number
  max: number
  label: string
}

export interface MeasurementProgressMetric {
  factId: string
  selector: MetricSelector
  label: string
  unit: string
  goalRelated: boolean
  targetLabel?: string
  goalGuide: MeasurementGoalGuide | null
  latest: MeasurementObservation | null
  periodStart: MeasurementObservation | null
  periodEnd: MeasurementObservation | null
  min: MeasurementObservation | null
  max: MeasurementObservation | null
  delta: number | null
  count: number
  freshness: MeasurementFreshness
  ageDays: number | null
  sufficiency: MeasurementSufficiency
  trend: MeasurementTrend
  noticeable: boolean
  hasNewerValueAfterPeriod: boolean
}

export interface MeasurementProgress {
  metrics: MeasurementProgressMetric[]
  primary: MeasurementProgressMetric | null
  explanation: {
    text: string
    source: 'llm' | 'deterministic'
    factIds: string[]
  } | null
}

type MetricDefinition = {
  selector: MetricSelector
  standardMetric?: StandardGoalCriterionMetric
  customMetricId?: string
  label: string
  unit: string
}

const STANDARD_DEFINITIONS: Array<MetricDefinition & { standardMetric: StandardGoalCriterionMetric }> = [
  { selector: 'weightKg', standardMetric: 'weight', label: 'Вес', unit: 'кг' },
  { selector: 'waistCm', standardMetric: 'waist', label: 'Талия', unit: 'см' },
  { selector: 'chestCm', standardMetric: 'chest', label: 'Грудь', unit: 'см' },
  { selector: 'hipCm', standardMetric: 'hips', label: 'Бёдра', unit: 'см' },
]

const number = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 3 })

function goalGuideFor(criterion: GoalCriterion | undefined): MeasurementGoalGuide | null {
  if (!criterion || criterion.operation === 'track_only') return null
  if (criterion.operation === 'maintain_range') {
    if (criterion.rangeMin === null || criterion.rangeMax === null) return null
    return {
      min: criterion.rangeMin,
      max: criterion.rangeMax,
      label: `Цель · ${number.format(criterion.rangeMin)}–${number.format(criterion.rangeMax)} ${criterion.unit}`,
    }
  }
  const value = criterion.operation === 'change_by'
    ? criterion.baselineValue === null || criterion.targetValue === null
      ? null
      : criterion.baselineValue + criterion.targetValue
    : criterion.targetValue
  return value === null ? null : {
    min: value,
    max: value,
    label: `Цель · ${number.format(value)} ${criterion.unit}`,
  }
}

function valueFor(entry: ProgressEntry, definition: MetricDefinition): number | undefined {
  if (typeof definition.selector === 'string') return entry[definition.selector]
  return entry.customMetrics.find((item) => item.metricId === definition.customMetricId)?.value
}

function observations(entries: readonly ProgressEntry[], definition: MetricDefinition, today: LocalDate): MeasurementObservation[] {
  return entries.flatMap((entry) => {
    const value = valueFor(entry, definition)
    return entry.recordedOn <= today && typeof value === 'number' && Number.isFinite(value)
      ? [{ entryId: entry.id, date: entry.recordedOn, value }]
      : []
  }).sort((left, right) => left.date.localeCompare(right.date) || left.entryId.localeCompare(right.entryId))
}

function confirmedCriterion(goal: ClientGoal | null | undefined, definition: MetricDefinition): GoalCriterion | undefined {
  return goal?.criteria
    .filter((criterion) => criterion.confirmationStatus === 'confirmed')
    .sort((left, right) => left.position - right.position)
    .find((criterion) => definition.standardMetric
      ? criterion.metric === definition.standardMetric
      : criterion.metric === 'custom' && criterion.customMetricId === definition.customMetricId)
}

function epsilon(values: readonly number[]): number {
  const scale = Math.max(...values.map((value) => Math.abs(value)), 1)
  return Math.max(MEASUREMENT_PROGRESS_POLICY.plateauAbsoluteEpsilon, scale * MEASUREMENT_PROGRESS_POLICY.plateauRelativeEpsilon)
}

function trendFor(points: readonly MeasurementObservation[]): MeasurementTrend {
  if (points.length < MEASUREMENT_PROGRESS_POLICY.minimumPointsForDynamics) return 'insufficient_data'
  const values = points.map((point) => point.value)
  const threshold = epsilon(values)
  const delta = values.at(-1)! - values[0]!
  if (Math.abs(delta) <= threshold) return 'plateau'
  if (points.length >= MEASUREMENT_PROGRESS_POLICY.minimumPointsForFluctuation) {
    const directions = values.slice(1).map((value, index) => value - values[index]!)
      .filter((change) => Math.abs(change) > threshold)
      .map((change) => Math.sign(change))
    if (directions.some((direction, index) => index > 0 && direction !== directions[index - 1])) return 'fluctuation'
  }
  return delta > 0 ? 'increase' : 'decrease'
}

function freshnessDays(definition: MetricDefinition): number {
  return definition.standardMetric
    ? STANDARD_GOAL_PROGRESS_POLICY.freshnessDays[definition.standardMetric]
    : MEASUREMENT_PROGRESS_POLICY.customFreshnessDays
}

function buildMetric(
  definition: MetricDefinition,
  entries: readonly ProgressEntry[],
  goal: ClientGoal | null | undefined,
  periodStart: LocalDate,
  periodEnd: LocalDate,
  today: LocalDate,
): MeasurementProgressMetric | null {
  const all = observations(entries, definition, today)
  const criterion = confirmedCriterion(goal, definition)
  if (all.length === 0 && !criterion) return null
  const period = all.filter((point) => point.date >= periodStart && point.date <= periodEnd)
  const first = period[0] ?? null
  const last = period.at(-1) ?? null
  const latest = all.at(-1) ?? null
  const min = period.length > 0 ? period.reduce((best, point) => point.value < best.value ? point : best) : null
  const max = period.length > 0 ? period.reduce((best, point) => point.value > best.value ? point : best) : null
  const ageDays = latest ? daysBetween(latest.date, today) : null
  const freshness: MeasurementFreshness = ageDays === null ? 'no_data'
    : ageDays <= freshnessDays(definition) ? 'fresh' : 'stale'
  const sufficiency: MeasurementSufficiency = latest === null ? 'none'
    : period.length >= MEASUREMENT_PROGRESS_POLICY.minimumPointsForDynamics ? 'enough_for_dynamics' : 'position_only'
  const delta = first && last && first.entryId !== last.entryId ? last.value - first.value : null
  const relativeChange = delta === null ? 0 : Math.abs(delta) / Math.max(Math.abs(first?.value ?? 0), 1)
  const identity = definition.standardMetric ?? `custom:${definition.customMetricId}`
  return {
    factId: `measurement-progress:${identity}:${periodStart}:${periodEnd}`,
    selector: definition.selector,
    label: definition.label,
    unit: definition.unit,
    goalRelated: Boolean(criterion),
    ...(criterion ? { targetLabel: goalCriterionTargetLabel(criterion) } : {}),
    goalGuide: goalGuideFor(criterion),
    latest,
    periodStart: first,
    periodEnd: last,
    min,
    max,
    delta,
    count: period.length,
    freshness,
    ageDays,
    sufficiency,
    trend: trendFor(period),
    noticeable: relativeChange >= MEASUREMENT_PROGRESS_POLICY.noticeableRelativeChange,
    hasNewerValueAfterPeriod: Boolean(latest && latest.date > periodEnd),
  }
}

function priority(metric: MeasurementProgressMetric): number {
  return (metric.goalRelated ? 1_000 : 0)
    + (metric.noticeable ? 100 : 0)
    + (metric.sufficiency === 'enough_for_dynamics' ? 10 : metric.latest ? 5 : 0)
}

function sentenceCount(value: string): number {
  return value.split(/[.!?]+/).map((part) => part.trim()).filter(Boolean).length
}

function formattedAnchors(metric: MeasurementProgressMetric): string[] {
  const values = [metric.periodStart?.value, metric.periodEnd?.value, metric.min?.value, metric.max?.value, metric.latest?.value]
    .filter((value): value is number => value !== undefined)
  return [...new Set(values.map((value) => number.format(value)))]
}

function acceptedExplanation(metric: MeasurementProgressMetric, candidates: readonly string[]): string | undefined {
  const anchors = formattedAnchors(metric)
  const requiredAnchors = metric.sufficiency === 'enough_for_dynamics' ? Math.min(2, anchors.length) : Math.min(1, anchors.length)
  return candidates.map((candidate) => candidate.trim()).find((candidate) => {
    if (!candidate || candidate.length > MEASUREMENT_PROGRESS_POLICY.maximumExplanationLength) return false
    if (sentenceCount(candidate) > MEASUREMENT_PROGRESS_POLICY.maximumExplanationSentences) return false
    if (!candidate.toLocaleLowerCase('ru-RU').includes(metric.label.toLocaleLowerCase('ru-RU'))) return false
    if (/(диагноз|гормон|болезн|травм|из-за|потому что|нужно|следует|рекоменд|совет|увеличь|снизь|добавь)/iu.test(candidate)) return false
    if (anchors.filter((anchor) => candidate.includes(anchor)).length < requiredAnchors) return false
    if (metric.sufficiency !== 'enough_for_dynamics' && !/(недостаточно|одна точка|нет данных)/iu.test(candidate)) return false
    return true
  })
}

function deterministicExplanation(metric: MeasurementProgressMetric): string {
  if (!metric.latest) return `По показателю «${metric.label}» пока нет данных.`
  if (metric.count === 0) {
    return `По показателю «${metric.label}» нет точек за выбранный период; последнее значение — ${number.format(metric.latest.value)} ${metric.unit}.`
  }
  if (metric.sufficiency !== 'enough_for_dynamics' || !metric.periodStart || !metric.periodEnd) {
    return `По показателю «${metric.label}» есть одна точка за период — этого недостаточно для вывода о тренде.`
  }
  const start = number.format(metric.periodStart.value)
  const end = number.format(metric.periodEnd.value)
  if (metric.trend === 'plateau') return `«${metric.label}» почти не изменился: ${start} → ${end} ${metric.unit}.`
  if (metric.trend === 'fluctuation' && metric.min && metric.max) {
    return `«${metric.label}» менялся в диапазоне ${number.format(metric.min.value)}–${number.format(metric.max.value)} ${metric.unit}; итог периода — ${end} ${metric.unit}.`
  }
  const direction = metric.trend === 'increase' ? 'вырос' : 'снизился'
  return `«${metric.label}» ${direction}: ${start} → ${end} ${metric.unit}.`
}

export function buildMeasurementExplanation(
  metric: MeasurementProgressMetric,
  llmCandidates: readonly string[] = [],
): MeasurementProgress['explanation'] {
  const llm = acceptedExplanation(metric, llmCandidates)
  return {
    text: llm ?? deterministicExplanation(metric),
    source: llm ? 'llm' : 'deterministic',
    factIds: [metric.factId],
  }
}

export function buildMeasurementProgress(options: {
  entries: readonly ProgressEntry[]
  customMetrics: readonly CustomMetric[]
  goal?: ClientGoal | null
  periodStart: LocalDate
  periodEnd: LocalDate
  today: LocalDate
  llmCandidates?: readonly string[]
}): MeasurementProgress {
  const customDefinitions: MetricDefinition[] = options.customMetrics.map((metric) => ({
    selector: { customMetricId: metric.id },
    customMetricId: metric.id,
    label: metric.name,
    unit: metric.unit ?? 'ед.',
  }))
  const metrics = [...STANDARD_DEFINITIONS, ...customDefinitions]
    .map((definition) => buildMetric(definition, options.entries, options.goal, options.periodStart, options.periodEnd, options.today))
    .filter((metric): metric is MeasurementProgressMetric => Boolean(metric))
    .sort((left, right) => priority(right) - priority(left)
      || (right.latest?.date ?? '').localeCompare(left.latest?.date ?? '')
      || left.label.localeCompare(right.label, 'ru'))
    .slice(0, MEASUREMENT_PROGRESS_POLICY.maximumVisibleMetrics)
  const primary = metrics[0] ?? null
  if (!primary) return { metrics, primary: null, explanation: null }
  return {
    metrics,
    primary,
    explanation: buildMeasurementExplanation(primary, options.llmCandidates),
  }
}

export function formatMeasurementValue(value: number, unit: string): string {
  return `${number.format(value)} ${unit}`
}

export function formatMeasurementDelta(delta: number, unit: string): string {
  const sign = delta > 0 ? '+' : delta < 0 ? '−' : ''
  return `${sign}${number.format(Math.abs(delta))} ${unit}`
}

export function measurementFreshnessLabel(metric: MeasurementProgressMetric): string {
  if (metric.freshness === 'no_data') return 'Нет данных'
  if (metric.freshness === 'stale') return `Данные устарели · ${metric.ageDays} дн.`
  return metric.ageDays === 0 ? 'Свежие данные · сегодня' : `Свежие данные · ${metric.ageDays} дн.`
}

export function measurementSufficiencyLabel(metric: MeasurementProgressMetric): string {
  if (metric.sufficiency === 'none') return 'Нет измерений'
  if (metric.sufficiency === 'position_only') return 'Недостаточно для динамики'
  const modulo100 = metric.count % 100
  const modulo10 = metric.count % 10
  const points = modulo100 >= 11 && modulo100 <= 14
    ? 'точек'
    : modulo10 === 1
      ? 'точка'
      : modulo10 >= 2 && modulo10 <= 4
        ? 'точки'
        : 'точек'
  return `${metric.count} ${points} · достаточно для динамики`
}
