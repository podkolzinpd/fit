import { compactPlannedSetSummary } from '../../data/repositories/workout-rules'
import type { ClientGoal, ProgressEntry, PublishedTrainingSummary, Workout } from '../../shared/domain'
import { formatLocalDate, type LocalDate } from '../../shared/local-date'
import { bodyZoneForExerciseName } from './body-progress-map'
import { progressMetricNoun } from './summary-format'

type StoryOptions = {
  currentWorkouts?: readonly Workout[]
  previousWorkouts?: readonly Workout[]
  measurements?: readonly ProgressEntry[]
  goal?: ClientGoal | null
  profileGoal?: string | null
  upcomingWorkouts?: readonly Workout[]
  today?: LocalDate
}

export type ClientProgressPresentation = {
  stats: Array<{ value: string; label: string }>
  comparison?: { title: string; items: Array<{ value: string; label: string; tone: 'positive' | 'neutral' }> }
  goal?: { title: string; evidence: string[] }
  nextWorkout?: { date: string; title: string; exercises: Array<{ name: string; plan?: string }> }
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

function activeWeeksLabel(value: number): string {
  const mod100 = Math.abs(value) % 100
  const mod10 = Math.abs(value) % 10
  if (mod100 >= 11 && mod100 <= 14) return 'недель с тренировками'
  if (mod10 === 1) return 'неделя с тренировками'
  if (mod10 >= 2 && mod10 <= 4) return 'недели с тренировками'
  return 'недель с тренировками'
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

function confirmedSets(workouts: readonly Workout[]): number {
  return done(workouts).reduce((total, workout) => total + workout.exercises.reduce(
    (exerciseTotal, exercise) => exerciseTotal + exercise.sets.filter((set) => Boolean(set.confirmedAt)).length,
    0,
  ), 0)
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

function comparison(current: readonly Workout[], previous: readonly Workout[]): ClientProgressPresentation['comparison'] {
  const currentDone = done(current).length
  const previousDone = done(previous).length
  const currentSets = confirmedSets(current)
  const previousSets = confirmedSets(previous)
  if (previousDone === 0 && previousSets === 0) return undefined

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

  if (currentSets > 0 || previousSets > 0) {
    const setDelta = currentSets - previousSets
    items.push({
      value: setDelta > 0 ? `+${setDelta}` : setDelta === 0 ? 'Столько же' : String(currentSets),
      label: setDelta > 0
        ? 'подтверждённых подходов к предыдущему периоду'
        : setDelta === 0
          ? `${currentSets} подтверждённых подходов в обоих периодах`
          : `подтверждённых подходов сейчас · было ${previousSets}`,
      tone: setDelta > 0 ? 'positive' : 'neutral',
    })
  }

  const currentWeeks = activeWeeks(current)
  const previousWeeks = activeWeeks(previous)
  const weekDelta = currentWeeks - previousWeeks
  if (weekDelta !== 0) items.push({
    value: weekDelta > 0 ? `+${weekDelta}` : String(currentWeeks),
    label: weekDelta > 0 ? 'активная неделя к предыдущему периоду' : `активных недель сейчас · было ${previousWeeks}`,
    tone: weekDelta > 0 ? 'positive' : 'neutral',
  })
  return { title: 'Изменения к предыдущему периоду', items: items.slice(0, 3) }
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

function bestGoalFact(summary: PublishedTrainingSummary, goal: string): string | undefined {
  const zones = targetZones(goal)
  const fact = summary.metrics.progressFacts.find((item) => zones.has(broadZone(bodyZoneForExerciseName(item.exerciseName)) ?? '')
    && item.changes.some((change) => change.favorable === true))
  const change = fact?.changes.find((item) => item.favorable === true)
  return fact && change ? `${fact.exerciseName}: ${Math.abs(Math.round(change.changePercent))}% улучшения по подтверждённым результатам.` : undefined
}

function goalStory(summary: PublishedTrainingSummary, options: StoryOptions): ClientProgressPresentation['goal'] {
  const title = options.goal?.title ?? options.profileGoal?.trim()
  if (!title) return undefined
  const evidence = [
    measurementEvidence(title, options.measurements ?? [], summary.periodStart, summary.periodEnd),
    targetPlanEvidence(title, options.currentWorkouts ?? []),
    bestGoalFact(summary, title),
  ].filter((item): item is string => Boolean(item)).slice(0, 2)
  return { title, evidence }
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

export function clientProgressPresentation(summary: PublishedTrainingSummary, options: StoryOptions = {}): ClientProgressPresentation {
  const favorableCount = summary.metrics.progressFacts.filter((fact) => fact.changes.some((change) => change.favorable === true)).length
  const hasCurrentWorkouts = options.currentWorkouts !== undefined
  const completedWorkouts = hasCurrentWorkouts ? done(options.currentWorkouts ?? []).length : summary.metrics.completedWorkouts
  const currentActiveWeeks = hasCurrentWorkouts ? activeWeeks(options.currentWorkouts ?? []) : summary.metrics.activeWeeks
  const stats: ClientProgressPresentation['stats'] = [
    { value: String(completedWorkouts), label: progressMetricNoun(completedWorkouts, 'workout') },
    { value: String(currentActiveWeeks), label: activeWeeksLabel(currentActiveWeeks) },
  ]
  if (favorableCount > 0) stats.push({ value: String(favorableCount), label: improvedExerciseLabel(favorableCount) })
  return {
    stats,
    comparison: comparison(options.currentWorkouts ?? [], options.previousWorkouts ?? []),
    goal: goalStory(summary, options),
    nextWorkout: nextWorkoutStory(options.upcomingWorkouts ?? [], options.today),
  }
}
