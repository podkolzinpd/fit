import { compactPlannedSetSummary } from '../../data/repositories/workout-rules'
import type { ClientGoal, ProgressEntry, PublishedTrainingSummary, TrainingSummary, Workout } from '../../shared/domain'
import { formatLocalDate, type LocalDate } from '../../shared/local-date'
import { bodyZoneForExerciseName } from './body-progress-map'
import { progressFactChangeLabel } from './progress-facts'
import { progressMetricNoun } from './summary-format'

type ProgressSummary = PublishedTrainingSummary | TrainingSummary

export type StoryOptions = {
  currentWorkouts?: readonly Workout[]
  previousWorkouts?: readonly Workout[]
  measurements?: readonly ProgressEntry[]
  goal?: ClientGoal | null
  profileGoal?: string | null
  upcomingWorkouts?: readonly Workout[]
  today?: LocalDate
  role?: 'client' | 'trainer'
}

export type ClientProgressPresentation = {
  hero?: { value: string; exerciseName: string; detail: string }
  stats: Array<{ value: string; label: string }>
  wins: Array<{ title: string; detail: string }>
  comparison: {
    title: string
    items: Array<{ value: string; label: string; tone: 'positive' | 'neutral' }>
    emptyMessage?: string
  }
  goal?: { title: string; evidence: string[]; planEvidence?: string }
  nextWorkout?: { date: string; title: string; exercises: Array<{ name: string; plan?: string }> }
  conclusion: string
  orientations: string[]
}

const number = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 })

function improvedExerciseLabel(value: number): string {
  const mod100 = Math.abs(value) % 100
  const mod10 = Math.abs(value) % 10
  if (mod100 >= 11 && mod100 <= 14) return 'упражнений улучшено'
  if (mod10 === 1) return 'упражнение улучшено'
  if (mod10 >= 2 && mod10 <= 4) return 'упражнения улучшены'
  return 'упражнений улучшено'
}

function confirmedSetsLabel(value: number): string {
  const mod100 = Math.abs(value) % 100
  const mod10 = Math.abs(value) % 10
  if (mod100 >= 11 && mod100 <= 14) return 'подтверждённых подходов'
  if (mod10 === 1) return 'подтверждённый подход'
  if (mod10 >= 2 && mod10 <= 4) return 'подтверждённых подхода'
  return 'подтверждённых подходов'
}

function done(workouts: readonly Workout[]): Workout[] {
  return workouts.filter((workout) => workout.status === 'done')
}

type ExerciseWeightResult = { exerciseName: string; value: number }

function bestWorkingWeights(workouts: readonly Workout[]): Map<string, ExerciseWeightResult> {
  const results = new Map<string, ExerciseWeightResult>()
  for (const workout of done(workouts)) {
    for (const exercise of workout.exercises) {
      const values = exercise.sets
        .filter((set) => Boolean(set.confirmedAt))
        .map((set) => set.fact?.weightKg ?? set.weightKg)
        .filter((value): value is number => typeof value === 'number' && value > 0)
      const value = values.length > 0 ? Math.max(...values) : undefined
      if (value === undefined) continue
      const key = `${exercise.ref ?? ''}:${exercise.name}`.toLocaleLowerCase('ru-RU')
      const existing = results.get(key)
      if (!existing || value > existing.value) results.set(key, { exerciseName: exercise.name, value })
    }
  }
  return results
}

function mostImportantMeasuredChange(
  current: readonly Workout[],
  previous: readonly Workout[],
): { value: string; label: string; tone: 'positive' | 'neutral' } | undefined {
  const currentWeights = bestWorkingWeights(current)
  const previousWeights = bestWorkingWeights(previous)
  const candidates = [...currentWeights.entries()].flatMap(([key, currentResult]) => {
    const previousResult = previousWeights.get(key)
    if (!previousResult || previousResult.value <= 0 || previousResult.value === currentResult.value) return []
    return [{
      exerciseName: currentResult.exerciseName,
      from: previousResult.value,
      to: currentResult.value,
      percent: Math.round(((currentResult.value - previousResult.value) / previousResult.value) * 100),
    }]
  }).sort((left, right) => Math.abs(right.percent) - Math.abs(left.percent))
  const best = candidates[0]
  if (!best) return undefined
  return {
    value: `${best.percent > 0 ? '+' : ''}${best.percent}%`,
    label: `${best.exerciseName}: рабочий вес ${number.format(best.from)} → ${number.format(best.to)} кг`,
    tone: best.percent > 0 ? 'positive' : 'neutral',
  }
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

function periodWeeks(start: LocalDate, end: LocalDate): number {
  const startKey = mondayKey(start)
  const endKey = mondayKey(end)
  const startDate = new Date(`${startKey}T00:00:00Z`)
  const endDate = new Date(`${endKey}T00:00:00Z`)
  return Math.max(1, Math.round((endDate.getTime() - startDate.getTime()) / 604_800_000) + 1)
}

function comparison(current: readonly Workout[], previous: readonly Workout[]): ClientProgressPresentation['comparison'] {
  const currentDone = done(current).length
  const previousDone = done(previous).length
  if (previousDone === 0) return {
    title: 'Сравнение периодов',
    items: [],
    emptyMessage: 'Текущий период сохранён как отправная точка. Сравнение появится, когда накопится следующий сопоставимый период.',
  }

  const items: NonNullable<ClientProgressPresentation['comparison']>['items'] = []
  const workoutDelta = currentDone - previousDone
  items.push({
    value: workoutDelta > 0 ? `+${workoutDelta}` : workoutDelta === 0 ? 'Столько же' : String(currentDone),
    label: workoutDelta > 0
      ? `${progressMetricNoun(workoutDelta, 'workout')} к предыдущему периоду`
      : workoutDelta === 0
        ? `${currentDone} ${progressMetricNoun(currentDone, 'workout')} в обоих периодах`
        : `${progressMetricNoun(currentDone, 'workout')} сейчас · было ${previousDone}`,
    tone: workoutDelta > 0 ? 'positive' : 'neutral',
  })

  const measuredChange = mostImportantMeasuredChange(current, previous)
  if (measuredChange) items.push(measuredChange)

  return { title: 'Изменения к предыдущему периоду', items: items.slice(0, 2) }
}

type MeasurementKey = 'weightKg' | 'chestCm' | 'waistCm' | 'hipCm'

function measurementForGoal(goal: string): { key: MeasurementKey; label: string; unit: string } | undefined {
  const normalized = goal.toLocaleLowerCase('ru-RU')
  if (/вес|масс|похуд|набрать|сброс/.test(normalized)) return { key: 'weightKg', label: 'Вес', unit: 'кг' }
  if (/тал/.test(normalized)) return { key: 'waistCm', label: 'Талия', unit: 'см' }
  if (/груд/.test(normalized)) return { key: 'chestCm', label: 'Обхват груди', unit: 'см' }
  if (/бедр|ягод/.test(normalized)) return { key: 'hipCm', label: 'Обхват бёдер', unit: 'см' }
  return undefined
}

function measurementEvidence(
  goal: string,
  measurements: readonly ProgressEntry[],
  periodStart: LocalDate,
  periodEnd: LocalDate,
): string | undefined {
  const metric = measurementForGoal(goal)
  if (!metric) return undefined
  const values = [...measurements]
    .filter((entry) => entry[metric.key] !== undefined && entry.recordedOn <= periodEnd)
    .sort((left, right) => left.recordedOn.localeCompare(right.recordedOn))
  const periodValues = values.filter((entry) => entry.recordedOn >= periodStart)
  const lastEntry = periodValues.at(-1)
  const baselineEntry = values.filter((entry) => entry.recordedOn <= periodStart).at(-1) ?? periodValues[0]
  if (!baselineEntry || !lastEntry || baselineEntry.recordedOn === lastEntry.recordedOn) return undefined
  const first = baselineEntry[metric.key]
  const last = lastEntry[metric.key]
  if (first === undefined || last === undefined || first === last) return undefined
  const delta = Math.round((last - first) * 10) / 10
  return `${metric.label}: ${number.format(first)} → ${number.format(last)} ${metric.unit} (${delta > 0 ? '+' : '−'}${number.format(Math.abs(delta))} ${metric.unit})`
}

function targetZones(goal: string): Set<string> {
  const normalized = goal.toLocaleLowerCase('ru-RU')
  const zones = new Set<string>()
  if (/плеч|дельт/.test(normalized)) zones.add('shoulders')
  if (/рук|бицеп|трицеп/.test(normalized)) zones.add('arms')
  if (/груд/.test(normalized)) zones.add('chest')
  if (/спин/.test(normalized)) zones.add('back')
  if (/ягод/.test(normalized)) zones.add('glutes')
  if (/ног|бедр|икр/.test(normalized)) zones.add('legs')
  if (/пресс|кор/.test(normalized)) zones.add('core')
  return zones
}

function broadZone(zone: ReturnType<typeof bodyZoneForExerciseName>): string | undefined {
  if (!zone) return undefined
  if (['biceps', 'triceps', 'forearms'].includes(zone)) return 'arms'
  if (['quadriceps', 'hamstrings', 'inner_thigh', 'outer_thigh', 'calves'].includes(zone)) return 'legs'
  if (['upper_back', 'lower_back'].includes(zone)) return 'back'
  return zone
}

function targetPlanEvidence(goal: string, workouts: readonly Workout[]): string | undefined {
  const zones = targetZones(goal)
  if (zones.size === 0) return undefined
  let planned = 0
  let confirmed = 0
  for (const workout of done(workouts)) {
    for (const exercise of workout.exercises) {
      const zone = broadZone(bodyZoneForExerciseName(exercise.name, exercise.muscleGroup))
      if (!zone || !zones.has(zone)) continue
      planned += exercise.sets.length
      confirmed += exercise.sets.filter((set) => Boolean(set.confirmedAt)).length
    }
  }
  return planned > 0
    ? `Целевые мышцы получили ${confirmed} ${confirmedSetsLabel(confirmed)}; в плане было ${planned}.`
    : undefined
}

function bestGoalFact(summary: ProgressSummary, goal: string): string | undefined {
  const zones = targetZones(goal)
  const change = storyChanges(summary).find((item) => zones.has(broadZone(bodyZoneForExerciseName(item.exerciseName)) ?? ''))
  return change ? `${change.exerciseName}: ${change.percent}% улучшения по подтверждённым результатам.` : undefined
}

function goalStory(summary: ProgressSummary, options: StoryOptions): ClientProgressPresentation['goal'] {
  const title = options.goal?.title ?? options.profileGoal?.trim()
  if (!title) return undefined
  const evidence = [
    measurementEvidence(title, options.measurements ?? [], summary.periodStart, summary.periodEnd),
    bestGoalFact(summary, title),
  ].filter((item): item is string => Boolean(item)).slice(0, 2)
  return { title, evidence, planEvidence: targetPlanEvidence(title, options.currentWorkouts ?? []) }
}

function nextWorkoutStory(workouts: readonly Workout[], today?: LocalDate): ClientProgressPresentation['nextWorkout'] {
  const next = [...workouts]
    .filter((workout) => workout.status === 'planned' && (!today || workout.workoutDate >= today))
    .sort((left, right) => left.workoutDate.localeCompare(right.workoutDate) || (left.startTime ?? '').localeCompare(right.startTime ?? ''))[0]
  if (!next) return undefined
  return {
    date: `${formatLocalDate(next.workoutDate)}${next.startTime ? ` · ${next.startTime}` : ''}`,
    title: next.stageTitle ?? 'Ближайшая тренировка',
    exercises: next.exercises.slice(0, 3).map((exercise) => ({
      name: exercise.name,
      plan: compactPlannedSetSummary(exercise.sets) ?? undefined,
    })),
  }
}

type StoryChange = { exerciseName: string; detail: string; percent: number }

function parseNumber(value: string): number {
  return Number(value.replace(/\s/g, '').replace(',', '.'))
}

function legacyStoryChanges(summary: ProgressSummary): StoryChange[] {
  return (clientCopy(summary).achievements ?? []).flatMap((raw) => {
    const text = raw.trim()
    const movement = text.match(/^([^:]+):\s*(.+?)\s+(?:вырос(?:ла|ло)?|увеличил(?:ся|ась|ось))\s+с\s+([\d\s.,]+)\s+до\s+([\d\s.,]+)\s*(кг|км|повт\.?|мин)?(?:\s*\(\+?([\d.,]+)%\))?/i)
    const arrow = text.match(/^([^:]+):\s*(.+?):?\s+([\d\s.,]+)\s*→\s*([\d\s.,]+)\s*(кг|км|повт\.?|мин)?(?:.*?\+([\d.,]+)%)?/i)
    const match = movement ?? arrow
    if (!match) return []
    const from = parseNumber(match[3] ?? '')
    const to = parseNumber(match[4] ?? '')
    if (!Number.isFinite(from) || !Number.isFinite(to) || from <= 0 || to <= from) return []
    const percent = Math.round(match[6] ? parseNumber(match[6]) : ((to - from) / from) * 100)
    const metric = (match[2] ?? 'Результат').trim().replace(/^./u, (letter) => letter.toLocaleUpperCase('ru-RU'))
    const unit = match[5] ? ` ${match[5].replace(/\.$/, '')}` : ''
    return [{
      exerciseName: (match[1] ?? '').trim(),
      detail: `${metric}: ${number.format(from)} → ${number.format(to)}${unit} · +${percent}%`,
      percent,
    }]
  })
}

function storyChanges(summary: ProgressSummary): StoryChange[] {
  const structured = summary.metrics.progressFacts
    .flatMap((fact) => fact.changes
      .filter((change) => change.favorable === true)
      .map((change) => ({
        exerciseName: fact.exerciseName,
        detail: progressFactChangeLabel(change),
        percent: Math.abs(Math.round(change.changePercent)),
      })))
  return (structured.length > 0 ? structured : legacyStoryChanges(summary))
    .sort((left, right) => right.percent - left.percent)
}

function presentationWins(summary: ProgressSummary): ClientProgressPresentation['wins'] {
  return storyChanges(summary)
    .map((item) => ({ title: item.exerciseName, detail: item.detail }))
    .slice(0, 3)
}

function clientCopy(summary: ProgressSummary) {
  return 'summary' in summary ? summary.summary : summary.client
}

function usefulOrientations(summary: ProgressSummary): string[] {
  const copy = clientCopy(summary)
  const generic = /продолжать отслеживать|поддерживать регулярность|сравнивать текущие результаты|на верном пути/i
  const exerciseTokens = summary.metrics.progressFacts
    .flatMap((fact) => fact.exerciseName.toLocaleLowerCase('ru-RU').split(' (')[0]?.split(/[^а-яё]+/u) ?? [])
    .filter((word) => word.length >= 4)
    .map((word) => word.slice(0, Math.max(4, word.length - 2)))
  return (copy.nextSteps ?? [])
    .map((item) => item.trim())
    .filter((item) => item.length > 0 && !generic.test(item))
    .filter((item) => {
      const normalized = item.toLocaleLowerCase('ru-RU')
      return /\d/u.test(normalized) || exerciseTokens.some((token) => normalized.includes(token))
    })
    .slice(0, 2)
}

function conclusion(summary: ProgressSummary, options: StoryOptions, totalWeeks: number): string {
  const current = done(options.currentWorkouts ?? []).length
  const previous = done(options.previousWorkouts ?? []).length
  if (previous > 0 && current !== previous) {
    const delta = Math.abs(current - previous)
    return current > previous
      ? `В этом периоде состоялось на ${delta} ${progressMetricNoun(delta, 'workout')} больше, чем в предыдущем.`
      : `В этом периоде состоялось ${current} ${progressMetricNoun(current, 'workout')}; в предыдущем было ${previous}.`
  }
  const useFetchedWorkouts = options.currentWorkouts !== undefined
    && (current > 0 || summary.metrics.completedWorkouts === 0)
  const weeks = useFetchedWorkouts ? activeWeeks(options.currentWorkouts ?? []) : summary.metrics.activeWeeks
  if (weeks > 0 && weeks === totalWeeks) return `Тренировки были в каждой неделе выбранного периода.`
  const favorable = new Set(storyChanges(summary).map((item) => item.exerciseName)).size
  if (favorable > 0) return favorable === 1
    ? 'За период подтверждено улучшение в одном упражнении.'
    : `За период подтверждено улучшение в ${favorable} упражнениях.`
  return options.role === 'trainer'
    ? 'Период сохранён как база для следующего решения по программе.'
    : 'Результаты этого периода сохранены как база для следующего сравнения.'
}

export function progressStoryPresentation(summary: ProgressSummary, options: StoryOptions = {}): ClientProgressPresentation {
  const changes = storyChanges(summary)
  const favorableCount = new Set(changes.map((item) => item.exerciseName)).size
  const fetchedCompletedWorkouts = done(options.currentWorkouts ?? []).length
  const useFetchedWorkouts = options.currentWorkouts !== undefined
    && (fetchedCompletedWorkouts > 0 || summary.metrics.completedWorkouts === 0)
  const completedWorkouts = useFetchedWorkouts ? fetchedCompletedWorkouts : summary.metrics.completedWorkouts
  const currentActiveWeeks = useFetchedWorkouts ? activeWeeks(options.currentWorkouts ?? []) : summary.metrics.activeWeeks
  const totalWeeks = periodWeeks(summary.periodStart, summary.periodEnd)
  const best = changes[0]
  const stats: ClientProgressPresentation['stats'] = [
    { value: String(completedWorkouts), label: progressMetricNoun(completedWorkouts, 'workout') },
    { value: `${currentActiveWeeks}/${totalWeeks}`, label: 'недель с тренировками' },
  ]
  if (favorableCount > 0) stats.push({ value: String(favorableCount), label: improvedExerciseLabel(favorableCount) })
  return {
    hero: best ? {
      value: `+${best.percent}%`,
      exerciseName: best.exerciseName,
      detail: best.detail,
    } : undefined,
    stats,
    wins: presentationWins(summary),
    comparison: comparison(options.currentWorkouts ?? [], options.previousWorkouts ?? []),
    goal: goalStory(summary, options),
    nextWorkout: nextWorkoutStory(options.upcomingWorkouts ?? [], options.today),
    conclusion: conclusion(summary, options, totalWeeks),
    orientations: usefulOrientations(summary),
  }
}

export function clientProgressPresentation(summary: PublishedTrainingSummary, options: StoryOptions = {}): ClientProgressPresentation {
  return progressStoryPresentation(summary, options)
}
