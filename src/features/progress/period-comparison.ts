import type { ClientGoal, GoalCriterion, ProgressEntry, Workout } from '../../shared/domain'
import { GOAL_CRITERION_METRICS, isStandardGoalCriterionMetric } from '../../shared/goal-criterion-rules'
import { calculateStandardGoalProgress } from '../../shared/goal-progress'
import { calculateTrainingGoalProgress } from '../../shared/goal-training-progress'
import { daysBetween, type LocalDate } from '../../shared/local-date'

export type ComparisonPeriod = { start: LocalDate; end: LocalDate }

export type PeriodComparisonFactKind =
  | 'goal'
  | 'measurement'
  | 'strength'
  | 'cardio'
  | 'regularity'
  | 'load'

export type PeriodComparisonFact = {
  factId: string
  kind: PeriodComparisonFactKind
  subject: string
  value: string
  label: string
  previousLabel: string
  currentLabel: string
  tone: 'positive' | 'neutral'
  priority: number
  numericAnchors: number[]
}

export type PeriodComparisonConclusion = {
  kind: 'change' | 'limitation'
  factIds: string[]
  text: string
  source: 'llm' | 'deterministic'
}

export type PeriodComparison = {
  title: string
  periodLabel: string
  comparable: boolean
  facts: PeriodComparisonFact[]
  conclusions: PeriodComparisonConclusion[]
  emptyMessage?: string
}

export type BuildPeriodComparisonOptions = {
  currentPeriod: ComparisonPeriod
  previousPeriod: ComparisonPeriod
  currentWorkouts: readonly Workout[]
  previousWorkouts: readonly Workout[]
  measurements?: readonly ProgressEntry[]
  goal?: ClientGoal | null
  llmCandidates?: readonly string[]
  excludedSubject?: string
  excludedKinds?: readonly PeriodComparisonFactKind[]
}

const number = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 })
const sentenceBoundary = /[.!?](?:\s|$)/g
const unsafeConclusion = /\b(?:нужно|следует|стоит|рекоменду|добавь|увеличь|снизь|измени|программ|из-за|потому\s+что)\b/i

function done(workouts: readonly Workout[]): Workout[] {
  return workouts.filter((workout) => workout.status === 'done')
}

function confirmedSets(workouts: readonly Workout[]) {
  return done(workouts).flatMap((workout) => workout.exercises.flatMap((exercise) =>
    exercise.sets.filter((set) => Boolean(set.confirmedAt)).map((set) => ({ exercise, set }))))
}

function mondayKey(value: LocalDate): string {
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1))
  const offset = (date.getUTCDay() + 6) % 7
  date.setUTCDate(date.getUTCDate() - offset)
  return date.toISOString().slice(0, 10)
}

function activeWeeks(workouts: readonly Workout[]): number {
  return new Set(done(workouts).map((workout) => mondayKey(workout.workoutDate))).size
}

function searchable(value: string): string {
  return value.toLocaleLowerCase('ru-RU').replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

function subjectAnchors(value: string): string[] {
  return searchable(value).split(' ').filter((token) => token.length >= 4)
}

function hasNumber(text: string, value: number): boolean {
  const variants = new Set([
    number.format(value),
    String(value),
    String(Math.round(value)),
  ].map((item) => item.replace(/\s/g, '').replace('.', ',')))
  const compact = text.replace(/\s/g, '').replace('.', ',')
  return [...variants].some((variant) => compact.includes(variant))
}

function signed(value: number): string {
  return `${value > 0 ? '+' : value < 0 ? '−' : ''}${number.format(Math.abs(value))}`
}

function percentValue(current: number, previous: number): string {
  if (previous === 0) return signed(current - previous)
  const percent = Math.round(((current - previous) / previous) * 100)
  return percent === 0 ? 'Без изменений' : `${percent > 0 ? '+' : '−'}${Math.abs(percent)}%`
}

function countFact(options: {
  factId: string
  kind: PeriodComparisonFactKind
  subject: string
  current: number
  previous: number
  unit: string
  priority: number
  favorable?: boolean
}): PeriodComparisonFact | null {
  const delta = options.current - options.previous
  if (delta === 0) return null
  return {
    factId: options.factId,
    kind: options.kind,
    subject: options.subject,
    value: signed(delta),
    label: `${options.subject}: ${number.format(options.previous)} → ${number.format(options.current)} ${options.unit}`,
    previousLabel: `${number.format(options.previous)} ${options.unit}`,
    currentLabel: `${number.format(options.current)} ${options.unit}`,
    tone: options.favorable === true ? 'positive' : 'neutral',
    priority: options.priority,
    numericAnchors: [options.previous, options.current, delta],
  }
}

function valueFact(options: {
  factId: string
  kind: PeriodComparisonFactKind
  subject: string
  current: number
  previous: number
  unit: string
  priority: number
  favorable?: boolean
}): PeriodComparisonFact | null {
  if (Math.abs(options.current - options.previous) < 0.001 || options.previous <= 0) return null
  return {
    factId: options.factId,
    kind: options.kind,
    subject: options.subject,
    value: percentValue(options.current, options.previous),
    label: `${options.subject}: ${number.format(options.previous)} → ${number.format(options.current)} ${options.unit}`,
    previousLabel: `${number.format(options.previous)} ${options.unit}`,
    currentLabel: `${number.format(options.current)} ${options.unit}`,
    tone: options.favorable === true ? 'positive' : 'neutral',
    priority: options.priority,
    numericAnchors: [options.previous, options.current],
  }
}

function strengthVolume(workouts: readonly Workout[]): number {
  return confirmedSets(workouts).reduce((sum, { exercise, set }) => {
    if (exercise.inputKind !== 'strength') return sum
    const weight = set.fact.weightKg ?? set.weightKg
    const reps = set.fact.reps ?? set.reps
    return typeof weight === 'number' && typeof reps === 'number' ? sum + weight * reps : sum
  }, 0)
}

function cardioTotals(workouts: readonly Workout[]): { distance: number; duration: number } {
  return confirmedSets(workouts).reduce((totals, { exercise, set }) => {
    if (exercise.inputKind !== 'distance' && exercise.muscleGroup !== 'cardio') return totals
    totals.distance += set.fact.distanceKm ?? set.distanceKm ?? 0
    totals.duration += (set.fact.durationSec ?? set.durationSec ?? ((set.fact.durationMin ?? set.durationMin ?? 0) * 60)) / 60
    return totals
  }, { distance: 0, duration: 0 })
}

type ExerciseResult = { subject: string; value: number }

function bestStrengthResults(workouts: readonly Workout[]): Map<string, ExerciseResult> {
  const results = new Map<string, ExerciseResult>()
  for (const { exercise, set } of confirmedSets(workouts)) {
    if (exercise.inputKind !== 'strength') continue
    const value = set.fact.weightKg ?? set.weightKg
    if (typeof value !== 'number' || value <= 0) continue
    const key = `${exercise.ref}:${exercise.name}`.toLocaleLowerCase('ru-RU')
    const existing = results.get(key)
    if (!existing || value > existing.value) results.set(key, { subject: exercise.name, value })
  }
  return results
}

function strengthFacts(current: readonly Workout[], previous: readonly Workout[]): PeriodComparisonFact[] {
  const currentResults = bestStrengthResults(current)
  const previousResults = bestStrengthResults(previous)
  return [...currentResults.entries()].flatMap(([key, result]) => {
    const before = previousResults.get(key)
    if (!before) return []
    const fact = valueFact({
      factId: `comparison:strength:${searchable(result.subject)}:${before.value}:${result.value}`,
      kind: 'strength', subject: `${result.subject} · рабочий вес`,
      current: result.value, previous: before.value, unit: 'кг', priority: 92,
      favorable: result.value > before.value,
    })
    return fact ? [fact] : []
  }).sort((left, right) => Math.abs(parseFloat(right.value)) - Math.abs(parseFloat(left.value)))
}

const standardMeasurements = [
  { metric: 'weight', key: 'weightKg', label: 'Вес', unit: 'кг' },
  { metric: 'waist', key: 'waistCm', label: 'Талия', unit: 'см' },
  { metric: 'chest', key: 'chestCm', label: 'Грудь', unit: 'см' },
  { metric: 'hips', key: 'hipCm', label: 'Бёдра', unit: 'см' },
] as const

function lastPeriodValue(entries: readonly ProgressEntry[], period: ComparisonPeriod, read: (entry: ProgressEntry) => number | undefined): number | null {
  return [...entries]
    .filter((entry) => entry.recordedOn >= period.start && entry.recordedOn <= period.end)
    .sort((left, right) => left.recordedOn.localeCompare(right.recordedOn) || left.id.localeCompare(right.id))
    .flatMap((entry) => {
      const value = read(entry)
      return typeof value === 'number' && Number.isFinite(value) ? [value] : []
    }).at(-1) ?? null
}

function criterionDistance(value: number, criterion: GoalCriterion): number {
  if (criterion.operation === 'track_only') return 0
  if (criterion.operation === 'maintain_range') {
    if (value < (criterion.rangeMin ?? 0)) return (criterion.rangeMin ?? 0) - value
    if (value > (criterion.rangeMax ?? 0)) return value - (criterion.rangeMax ?? 0)
    return 0
  }
  const target = criterion.operation === 'change_by'
    ? criterion.baselineValue === null ? null : criterion.baselineValue + (criterion.targetValue ?? 0)
    : criterion.targetValue
  if (target === null) return 0
  const decreasing = criterion.operation === 'decrease_to'
    || (criterion.operation === 'change_by' && (criterion.targetValue ?? 0) < 0)
    || criterion.metric === 'cardio_pace'
  return decreasing ? Math.max(0, value - target) : Math.max(0, target - value)
}

function goalFacts(
  goal: ClientGoal | null | undefined,
  entries: readonly ProgressEntry[],
  workouts: readonly Workout[],
  currentPeriod: ComparisonPeriod,
  previousPeriod: ComparisonPeriod,
): { facts: PeriodComparisonFact[]; coveredStandard: Set<string>; coveredExercises: Set<string>; coversRegularity: boolean } {
  const facts: PeriodComparisonFact[] = []
  const coveredStandard = new Set<string>()
  const coveredExercises = new Set<string>()
  let coversRegularity = false
  for (const criterion of goal?.criteria ?? []) {
    if (criterion.confirmationStatus !== 'confirmed') continue
    let label = GOAL_CRITERION_METRICS[criterion.metric].label
    if (isStandardGoalCriterionMetric(criterion.metric)) {
      coveredStandard.add(criterion.metric)
    } else if (criterion.metric === 'custom' && criterion.customMetricId) {
      label = criterion.customMetricName?.trim() || 'Пользовательский показатель'
    } else if (criterion.exerciseName) {
      label = `${label} · ${criterion.exerciseName}`
      coveredExercises.add(searchable(criterion.exerciseName))
    }
    if (criterion.metric === 'workout_regularity') coversRegularity = true
    const combinedWorkouts = workouts.filter((workout) => workout.workoutDate <= currentPeriod.end)
    const previousResult = isStandardGoalCriterionMetric(criterion.metric)
      ? calculateStandardGoalProgress(criterion, entries, previousPeriod.start, previousPeriod.end, previousPeriod.end)
      : calculateTrainingGoalProgress(criterion, combinedWorkouts, entries, previousPeriod.start, previousPeriod.end, previousPeriod.end)
    const currentResult = isStandardGoalCriterionMetric(criterion.metric)
      ? calculateStandardGoalProgress(criterion, entries, currentPeriod.start, currentPeriod.end, currentPeriod.end)
      : calculateTrainingGoalProgress(criterion, combinedWorkouts, entries, currentPeriod.start, currentPeriod.end, currentPeriod.end)
    const current = currentResult.periodEnd?.value ?? null
    const previous = previousResult.periodEnd?.value ?? null
    if (current === null || previous === null || currentResult.dynamics.count === 0 || previousResult.dynamics.count === 0) continue
    const fact = valueFact({
      factId: `comparison:goal:${criterion.id}:${previous}:${current}`,
      kind: 'goal', subject: `Цель · ${label}`, current, previous, unit: criterion.unit,
      priority: 120, favorable: criterion.operation !== 'track_only' && criterionDistance(current, criterion) < criterionDistance(previous, criterion),
    })
    if (fact) facts.push(fact)
  }
  return { facts, coveredStandard, coveredExercises, coversRegularity }
}

function measurementFacts(
  entries: readonly ProgressEntry[],
  currentPeriod: ComparisonPeriod,
  previousPeriod: ComparisonPeriod,
  coveredStandard: ReadonlySet<string>,
): PeriodComparisonFact[] {
  return standardMeasurements.flatMap((definition) => {
    if (coveredStandard.has(definition.metric)) return []
    const current = lastPeriodValue(entries, currentPeriod, (entry) => entry[definition.key])
    const previous = lastPeriodValue(entries, previousPeriod, (entry) => entry[definition.key])
    if (current === null || previous === null) return []
    const fact = valueFact({
      factId: `comparison:measurement:${definition.metric}:${previous}:${current}`,
      kind: 'measurement', subject: definition.label, current, previous, unit: definition.unit,
      priority: 84,
    })
    return fact ? [fact] : []
  })
}

function groundedConclusion(facts: readonly PeriodComparisonFact[], candidates: readonly string[]): PeriodComparisonConclusion | null {
  for (const fact of facts) {
    const anchors = subjectAnchors(fact.subject)
    for (const raw of candidates) {
      const text = raw.trim()
      if (!text || text.length > 180 || (text.match(sentenceBoundary)?.length ?? 0) > 2 || unsafeConclusion.test(text)) continue
      const normalized = searchable(text)
      if (anchors.length > 0 && !anchors.some((anchor) => normalized.includes(anchor))) continue
      const matchedNumbers = new Set(fact.numericAnchors.filter((anchor) => hasNumber(text, anchor)))
      if (matchedNumbers.size < Math.min(2, new Set(fact.numericAnchors).size)) continue
      return { kind: 'change', factIds: [fact.factId], text, source: 'llm' }
    }
  }
  return null
}

function periodLabel(current: ComparisonPeriod, previous: ComparisonPeriod): string {
  const month = new Intl.DateTimeFormat('ru-RU', { month: 'long' })
  const periodMonths = (period: ComparisonPeriod) => {
    const [startYear, startMonth] = period.start.split('-').map(Number)
    const [endYear, endMonth] = period.end.split('-').map(Number)
    const start = month.format(new Date(Date.UTC(startYear ?? 0, (startMonth ?? 1) - 1, 1)))
    const end = month.format(new Date(Date.UTC(endYear ?? 0, (endMonth ?? 1) - 1, 1)))
    return startYear === endYear && startMonth === endMonth ? start : `${start}–${end}`
  }
  const years = new Set([previous.start, previous.end, current.start, current.end].map((value) => value.slice(0, 4)))
  if (years.size === 1) return `${periodMonths(previous)} → ${periodMonths(current)} ${current.start.slice(0, 4)}`
  return `${periodMonths(previous)} ${previous.start.slice(0, 4)} → ${periodMonths(current)} ${current.start.slice(0, 4)}`
}

export function buildPeriodComparison(options: BuildPeriodComparisonOptions): PeriodComparison {
  const title = 'Сравнение периодов'
  const currentDays = daysBetween(options.currentPeriod.start, options.currentPeriod.end) + 1
  const previousDays = daysBetween(options.previousPeriod.start, options.previousPeriod.end) + 1
  const label = periodLabel(options.currentPeriod, options.previousPeriod)
  if (currentDays !== previousDays) return {
    title, periodLabel: label, comparable: false, facts: [], conclusions: [{
      kind: 'limitation', factIds: [], source: 'deterministic',
      text: 'Периоды имеют разную длину, поэтому изменения не сравниваются.',
    }],
    emptyMessage: 'Для сравнения нужны периоды одинаковой длины.',
  }

  const currentDone = done(options.currentWorkouts)
  const previousDone = done(options.previousWorkouts)
  const goalComparison = goalFacts(
    options.goal,
    options.measurements ?? [],
    [...options.previousWorkouts, ...options.currentWorkouts],
    options.currentPeriod,
    options.previousPeriod,
  )
  const currentCardio = cardioTotals(currentDone)
  const previousCardio = cardioTotals(previousDone)
  const candidates: Array<PeriodComparisonFact | null> = [
    ...goalComparison.facts,
    ...strengthFacts(currentDone, previousDone).filter((fact) =>
      ![...goalComparison.coveredExercises].some((name) => searchable(fact.subject).includes(name))),
    ...measurementFacts(options.measurements ?? [], options.currentPeriod, options.previousPeriod, goalComparison.coveredStandard),
    goalComparison.coversRegularity ? null : countFact({ factId: `comparison:workouts:${previousDone.length}:${currentDone.length}`, kind: 'regularity', subject: 'Завершённые тренировки', current: currentDone.length, previous: previousDone.length, unit: 'трен.', priority: 82 }),
    goalComparison.coversRegularity ? null : countFact({ factId: `comparison:active-weeks:${activeWeeks(previousDone)}:${activeWeeks(currentDone)}`, kind: 'regularity', subject: 'Активные недели', current: activeWeeks(currentDone), previous: activeWeeks(previousDone), unit: 'нед.', priority: 78 }),
    valueFact({ factId: `comparison:strength-volume:${strengthVolume(previousDone)}:${strengthVolume(currentDone)}`, kind: 'load', subject: 'Силовой объём', current: strengthVolume(currentDone), previous: strengthVolume(previousDone), unit: 'кг', priority: 74 }),
    countFact({ factId: `comparison:sets:${confirmedSets(previousDone).length}:${confirmedSets(currentDone).length}`, kind: 'load', subject: 'Выполненные подходы', current: confirmedSets(currentDone).length, previous: confirmedSets(previousDone).length, unit: 'подх.', priority: 70 }),
    valueFact({ factId: `comparison:cardio-distance:${previousCardio.distance}:${currentCardio.distance}`, kind: 'cardio', subject: 'Кардио · дистанция', current: currentCardio.distance, previous: previousCardio.distance, unit: 'км', priority: 76 }),
    valueFact({ factId: `comparison:cardio-duration:${previousCardio.duration}:${currentCardio.duration}`, kind: 'cardio', subject: 'Кардио · время', current: currentCardio.duration, previous: previousCardio.duration, unit: 'мин', priority: 68 }),
  ]

  const excludedKinds = new Set(options.excludedKinds ?? [])
  const excludedSubject = searchable(options.excludedSubject ?? '')
  const facts = candidates
    .filter((fact): fact is PeriodComparisonFact => fact !== null)
    .filter((fact) => !excludedKinds.has(fact.kind))
    .filter((fact) => !excludedSubject || !searchable(fact.subject).includes(excludedSubject))
    .sort((left, right) => right.priority - left.priority || left.factId.localeCompare(right.factId))

  if (previousDone.length === 0 && goalComparison.facts.length === 0 && measurementFacts(options.measurements ?? [], options.currentPeriod, options.previousPeriod, goalComparison.coveredStandard).length === 0) {
    return {
      title, periodLabel: label, comparable: true, facts: [], conclusions: [],
      emptyMessage: 'Сравнение появится, когда будут данные за два периода.',
    }
  }

  if (facts.length === 0) return {
    title, periodLabel: label, comparable: true, facts: [], conclusions: [],
    emptyMessage: 'Заметных изменений между периодами нет.',
  }

  const llm = groundedConclusion(facts, options.llmCandidates ?? [])
  const conclusions: PeriodComparisonConclusion[] = []
  if (facts[0]) conclusions.push(llm ?? {
    kind: 'change', factIds: [facts[0].factId], source: 'deterministic',
    text: `Самое заметное изменение — «${facts[0].subject}», ${facts[0].value}.`,
  })
  const limitedCount = Math.min(currentDone.length, previousDone.length)
  if (limitedCount > 0 && limitedCount < 2) conclusions.push({
    kind: 'limitation', factIds: [`comparison:workouts:${previousDone.length}:${currentDone.length}`], source: 'deterministic',
    text: `Мало данных: в одном из периодов только ${limitedCount} завершённая тренировка.`,
  })

  return { title, periodLabel: label, comparable: true, facts, conclusions: conclusions.slice(0, 2) }
}
