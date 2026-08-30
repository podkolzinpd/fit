import type { Workout } from '../../shared/domain'
import { addDays, daysBetween, formatLocalDateShort, type LocalDate } from '../../shared/local-date'

export const WORKOUT_REGULARITY_POLICY = {
  minimumWorkoutsForPattern: 2,
  minimumElapsedWeeksForPattern: 2,
  longGapDays: 14,
  returnWindowDays: 7,
  stableActiveWeekShare: 0.75,
  concentratedWeekShare: 0.6,
  frequencyDeclineRatio: 0.75,
  frequencyDeclinePerWeek: 0.5,
  maximumExplanationLength: 180,
  maximumExplanationSentences: 2,
} as const

export type RegularityPattern =
  | 'stability'
  | 'return'
  | 'frequency_decline'
  | 'activity_concentration'
  | 'insufficient_data'

export type RegularityWeekStatus = 'active' | 'missed' | 'current'

export interface RegularityWeek {
  start: LocalDate
  end: LocalDate
  workoutCount: number
  status: RegularityWeekStatus
}

export interface WorkoutRegularityProgress {
  factId: string
  completedWorkouts: number
  weeks: RegularityWeek[]
  elapsedWeeks: number
  activeWeeks: number
  missedWeeks: number
  averageIntervalDays: number | null
  longestGapDays: number | null
  currentStreakWeeks: number
  workoutsPerWeek: number
  previousWorkoutsPerWeek: number | null
  frequencyChange: number | null
  pattern: RegularityPattern
  explanation: {
    text: string
    source: 'llm' | 'deterministic'
    factIds: string[]
  }
}

const number = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 })

function mondayStart(value: LocalDate): LocalDate {
  const [year, month, day] = value.split('-').map(Number)
  const weekday = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1)).getUTCDay()
  return addDays(value, -((weekday + 6) % 7))
}

function minimum(left: LocalDate, right: LocalDate): LocalDate {
  return left <= right ? left : right
}

function maximum(left: LocalDate, right: LocalDate): LocalDate {
  return left >= right ? left : right
}

function doneDates(workouts: readonly Workout[], start: LocalDate, end: LocalDate): LocalDate[] {
  return workouts
    .filter((workout) => workout.status === 'done' && workout.workoutDate >= start && workout.workoutDate <= end)
    .map((workout) => workout.workoutDate)
    .sort((left, right) => left.localeCompare(right))
}

function weeksForPeriod(
  dates: readonly LocalDate[],
  periodStart: LocalDate,
  periodEnd: LocalDate,
  today: LocalDate,
): RegularityWeek[] {
  const effectiveEnd = minimum(periodEnd, today)
  const weeks: RegularityWeek[] = []
  for (let cursor = mondayStart(periodStart); cursor <= effectiveEnd; cursor = addDays(cursor, 7)) {
    const start = maximum(cursor, periodStart)
    const bucketEnd = minimum(addDays(cursor, 6), periodEnd)
    const end = minimum(bucketEnd, effectiveEnd)
    const workoutCount = dates.filter((date) => date >= start && date <= end).length
    weeks.push({
      start,
      end,
      workoutCount,
      status: workoutCount > 0 ? 'active' : bucketEnd <= effectiveEnd ? 'missed' : 'current',
    })
  }
  return weeks
}

function intervalFacts(dates: readonly LocalDate[]): { average: number | null; longest: number | null } {
  const unique = [...new Set(dates)]
  if (unique.length < 2) return { average: null, longest: null }
  const intervals = unique.slice(1).map((date, index) => daysBetween(unique[index]!, date))
  return {
    average: Math.round((intervals.reduce((sum, value) => sum + value, 0) / intervals.length) * 10) / 10,
    longest: Math.max(...intervals),
  }
}

function currentStreak(weeks: readonly RegularityWeek[]): number {
  const eligible = weeks.filter((week) => week.status !== 'current')
  if (weeks.at(-1)?.status === 'active' && weeks.at(-1) !== eligible.at(-1)) eligible.push(weeks.at(-1)!)
  let streak = 0
  for (let index = eligible.length - 1; index >= 0; index -= 1) {
    if (eligible[index]?.status !== 'active') break
    streak += 1
  }
  return streak
}

function weeklyFrequency(count: number, start: LocalDate, end: LocalDate): number {
  const days = Math.max(1, daysBetween(start, end) + 1)
  return Math.round(((count / days) * 7) * 10) / 10
}

function selectPattern(options: {
  dates: readonly LocalDate[]
  weeks: readonly RegularityWeek[]
  elapsedWeeks: number
  activeWeeks: number
  longestGapDays: number | null
  frequency: number
  previousFrequency: number | null
  effectiveEnd: LocalDate
}): RegularityPattern {
  const { dates, weeks, elapsedWeeks, activeWeeks, longestGapDays, frequency, previousFrequency, effectiveEnd } = options
  if (dates.length < WORKOUT_REGULARITY_POLICY.minimumWorkoutsForPattern
    || elapsedWeeks < WORKOUT_REGULARITY_POLICY.minimumElapsedWeeksForPattern) return 'insufficient_data'
  const lastWorkout = dates.at(-1)
  if (longestGapDays !== null && longestGapDays >= WORKOUT_REGULARITY_POLICY.longGapDays
    && lastWorkout && daysBetween(lastWorkout, effectiveEnd) <= WORKOUT_REGULARITY_POLICY.returnWindowDays) return 'return'
  if (previousFrequency !== null && previousFrequency >= WORKOUT_REGULARITY_POLICY.frequencyDeclinePerWeek
    && frequency <= previousFrequency * WORKOUT_REGULARITY_POLICY.frequencyDeclineRatio
    && previousFrequency - frequency >= WORKOUT_REGULARITY_POLICY.frequencyDeclinePerWeek) return 'frequency_decline'
  const busiestWeek = Math.max(...weeks.map((week) => week.workoutCount), 0)
  if (dates.length >= 3 && busiestWeek / dates.length >= WORKOUT_REGULARITY_POLICY.concentratedWeekShare) {
    return 'activity_concentration'
  }
  if (activeWeeks / elapsedWeeks >= WORKOUT_REGULARITY_POLICY.stableActiveWeekShare) return 'stability'
  return 'insufficient_data'
}

function sentenceCount(value: string): number {
  return value.split(/[.!?]+/).map((part) => part.trim()).filter(Boolean).length
}

function normalized(value: string): string {
  return value.toLocaleLowerCase('ru-RU').replace(/ё/g, 'е')
}

function numericAnchors(progress: Omit<WorkoutRegularityProgress, 'explanation'>): string[] {
  const values = [
    progress.completedWorkouts,
    progress.activeWeeks,
    progress.elapsedWeeks,
    progress.missedWeeks,
    progress.averageIntervalDays,
    progress.longestGapDays,
    progress.currentStreakWeeks,
    progress.workoutsPerWeek,
    progress.previousWorkoutsPerWeek,
  ].filter((value): value is number => value !== null)
  return [...new Set(values.flatMap((value) => [number.format(value), String(value)]))]
}

function matchesPattern(candidate: string, pattern: RegularityPattern): boolean {
  const text = normalized(candidate)
  if (pattern === 'stability') return /(стабил|регуляр|кажд.*недел|ритм.*удерж)/u.test(text)
  if (pattern === 'return') return /(возвращ|возобнов|снова.*трен|после.*пауз)/u.test(text)
  if (pattern === 'frequency_decline') return /(сниз|реже|частот.*уменьш)/u.test(text)
  if (pattern === 'activity_concentration') return /(концентр|сосредоточ|больш.*одн.*недел)/u.test(text)
  return /(недостаточно|мало данных|пока нельзя|нет данных)/u.test(text)
}

function patternMatchCount(candidate: string): number {
  const patterns: RegularityPattern[] = [
    'stability', 'return', 'frequency_decline', 'activity_concentration', 'insufficient_data',
  ]
  return patterns.filter((pattern) => matchesPattern(candidate, pattern)).length
}

function acceptedExplanation(
  progress: Omit<WorkoutRegularityProgress, 'explanation'>,
  candidates: readonly string[],
): string | undefined {
  const anchors = numericAnchors(progress)
  const requiredAnchors = progress.pattern === 'insufficient_data' ? 1 : Math.min(2, anchors.length)
  return candidates.map((candidate) => candidate.trim()).find((candidate) => {
    if (!candidate || candidate.length > WORKOUT_REGULARITY_POLICY.maximumExplanationLength) return false
    if (sentenceCount(candidate) > WORKOUT_REGULARITY_POLICY.maximumExplanationSentences) return false
    if (!matchesPattern(candidate, progress.pattern) || patternMatchCount(candidate) !== 1) return false
    if (/(ленив|дисциплин|мотивац|характер|из-за|потому что|нужно|следует|рекоменд|совет|увеличь|снизь|добавь)/iu.test(candidate)) return false
    const allowedNumbers = new Set(anchors.map((anchor) => anchor.replace('.', ',')))
    const candidateNumbers = [...new Set((candidate.match(/\d+(?:[.,]\d+)?/g) ?? []).map((value) => value.replace('.', ',')))]
    if (candidateNumbers.some((value) => !allowedNumbers.has(value))) return false
    if (candidateNumbers.length < requiredAnchors) return false
    return true
  })
}

function workoutNoun(count: number): string {
  const mod100 = count % 100
  const mod10 = count % 10
  if (mod100 >= 11 && mod100 <= 14) return 'тренировок'
  if (mod10 === 1) return 'тренировка'
  if (mod10 >= 2 && mod10 <= 4) return 'тренировки'
  return 'тренировок'
}

function weekNoun(count: number): string {
  const mod100 = count % 100
  const mod10 = count % 10
  if (mod100 >= 11 && mod100 <= 14) return 'недель'
  if (mod10 === 1) return 'неделя'
  if (mod10 >= 2 && mod10 <= 4) return 'недели'
  return 'недель'
}

function deterministicExplanation(progress: Omit<WorkoutRegularityProgress, 'explanation'>): string {
  if (progress.completedWorkouts === 0) return 'За выбранный период пока нет завершённых тренировок — ритм оценить нельзя.'
  if (progress.pattern === 'return') {
    return `После паузы ${progress.longestGapDays} дн. тренировки возобновились; всего за период — ${progress.completedWorkouts}.`
  }
  if (progress.pattern === 'frequency_decline' && progress.previousWorkoutsPerWeek !== null) {
    return `Частота снизилась: ${number.format(progress.previousWorkoutsPerWeek)} → ${number.format(progress.workoutsPerWeek)} тренировки в неделю.`
  }
  if (progress.pattern === 'activity_concentration') {
    const busiest = Math.max(...progress.weeks.map((week) => week.workoutCount))
    return `${busiest} из ${progress.completedWorkouts} тренировок пришлись на одну неделю; активных недель — ${progress.activeWeeks} из ${progress.elapsedWeeks}.`
  }
  if (progress.pattern === 'stability') {
    return `${progress.completedWorkouts} ${workoutNoun(progress.completedWorkouts)} распределены по ${progress.activeWeeks} из ${progress.elapsedWeeks} недель — ритм стабилен.`
  }
  return `${progress.completedWorkouts} ${workoutNoun(progress.completedWorkouts)} за ${progress.elapsedWeeks} ${weekNoun(progress.elapsedWeeks)} — данных пока недостаточно для устойчивого паттерна.`
}

export function buildWorkoutRegularityProgress(options: {
  currentWorkouts: readonly Workout[]
  previousWorkouts?: readonly Workout[]
  periodStart: LocalDate
  periodEnd: LocalDate
  previousPeriodStart?: LocalDate
  previousPeriodEnd?: LocalDate
  today: LocalDate
  llmCandidates?: readonly string[]
}): WorkoutRegularityProgress {
  const effectiveEnd = minimum(options.periodEnd, options.today)
  const dates = doneDates(options.currentWorkouts, options.periodStart, effectiveEnd)
  const weeks = weeksForPeriod(dates, options.periodStart, options.periodEnd, options.today)
  const elapsedWeeks = weeks.filter((week) => week.status !== 'current').length
  const activeWeeks = weeks.filter((week) => week.status === 'active').length
  const missedWeeks = weeks.filter((week) => week.status === 'missed').length
  const intervals = intervalFacts(dates)
  const workoutsPerWeek = weeklyFrequency(dates.length, options.periodStart, effectiveEnd)
  const previousDates = options.previousWorkouts && options.previousPeriodStart && options.previousPeriodEnd
    ? doneDates(options.previousWorkouts, options.previousPeriodStart, options.previousPeriodEnd)
    : null
  const previousWorkoutsPerWeek = previousDates && options.previousPeriodStart && options.previousPeriodEnd
    ? weeklyFrequency(previousDates.length, options.previousPeriodStart, options.previousPeriodEnd)
    : null
  const frequencyChange = previousWorkoutsPerWeek === null
    ? null
    : Math.round((workoutsPerWeek - previousWorkoutsPerWeek) * 10) / 10
  const base = {
    factId: `workout-regularity:${options.periodStart}:${options.periodEnd}`,
    completedWorkouts: dates.length,
    weeks,
    elapsedWeeks,
    activeWeeks,
    missedWeeks,
    averageIntervalDays: intervals.average,
    longestGapDays: intervals.longest,
    currentStreakWeeks: currentStreak(weeks),
    workoutsPerWeek,
    previousWorkoutsPerWeek,
    frequencyChange,
    pattern: selectPattern({
      dates,
      weeks,
      elapsedWeeks,
      activeWeeks,
      longestGapDays: intervals.longest,
      frequency: workoutsPerWeek,
      previousFrequency: previousWorkoutsPerWeek,
      effectiveEnd,
    }),
  }
  const llm = acceptedExplanation(base, options.llmCandidates ?? [])
  return {
    ...base,
    explanation: {
      text: llm ?? deterministicExplanation(base),
      source: llm ? 'llm' : 'deterministic',
      factIds: [base.factId],
    },
  }
}

export function regularityWeekLabel(week: RegularityWeek): string {
  return `${formatLocalDateShort(week.start)}–${formatLocalDateShort(week.end)}`
}

export function formatRegularityNumber(value: number): string {
  return number.format(value)
}

export function regularityWorkoutLabel(count: number): string {
  return `${count} ${workoutNoun(count)}`
}

export function regularityWeekCountLabel(count: number): string {
  return `${count} ${weekNoun(count)}`
}
