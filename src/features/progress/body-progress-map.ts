import type { MuscleGroup, PublishedTrainingSummary, TrainingProgressFactChange, Workout } from '../../shared/domain'
import { MUSCLE_GROUP_LABELS, SYSTEM_EXERCISE_CATALOG } from '../../shared/system-exercises'

export type BodyMapMode = 'progress' | 'load'

export interface BodyMapRegion {
  group: MuscleGroup
  label: string
  percent: number
  valueLabel: string
  details: string[]
  intensity: number
}

export interface BodyMapData {
  mode: BodyMapMode
  title: string
  description: string
  regions: BodyMapRegion[]
  emptyMessage: string
}

const BODY_GROUPS = new Set<MuscleGroup>(['legs', 'glutes', 'chest', 'back', 'shoulders', 'arms', 'core'])
const METRIC_PRIORITY: TrainingProgressFactChange['metric'][] = [
  'max_weight', 'volume', 'total_reps', 'pace', 'distance', 'duration',
]

function normalizeExerciseName(value: string): string {
  return value
    .toLocaleLowerCase('ru-RU')
    .replace(/ё/g, 'е')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-zа-я0-9]+/gi, ' ')
    .trim()
}

const CATALOG_NAMES = SYSTEM_EXERCISE_CATALOG
  .map((exercise) => ({
    normalized: normalizeExerciseName(exercise.name),
    group: exercise.muscleGroup,
  }))
  .filter((exercise) => exercise.normalized.length > 2)
  .sort((left, right) => right.normalized.length - left.normalized.length)

export function muscleGroupForExerciseName(name: string): MuscleGroup {
  const normalized = normalizeExerciseName(name)
  const catalogMatch = CATALOG_NAMES.find((exercise) =>
    normalized === exercise.normalized
    || normalized.startsWith(`${exercise.normalized} `)
    || exercise.normalized.startsWith(`${normalized} `))
  if (catalogMatch) return catalogMatch.group

  if (/ягод|глют/.test(normalized)) return 'glutes'
  if (/пресс|планк|скручив|кор /.test(normalized)) return 'core'
  if (/бицепс|трицепс|молот|французск/.test(normalized)) return 'arms'
  if (/плеч|дельт|шраг/.test(normalized)) return 'shoulders'
  if (/тяга|подтяг|гиперэкстенз/.test(normalized)) return 'back'
  if (/жим ног|присед|выпад|бедр|голен|икрон|сгибание ног|разгибание ног/.test(normalized)) return 'legs'
  if (/жим|груд|развод|отжим|бабочк/.test(normalized)) return 'chest'
  if (/бег|ходьб|вел|греб|эллип|скакал|берпи/.test(normalized)) return 'cardio'
  return 'other'
}

function favorableChange(changes: readonly TrainingProgressFactChange[]): TrainingProgressFactChange | undefined {
  for (const metric of METRIC_PRIORITY) {
    const match = changes.find((change) => change.metric === metric && change.favorable === true)
    if (match) return match
  }
  return undefined
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) return sorted[middle]!
  return (sorted[middle - 1]! + sorted[middle]!) / 2
}

function progressDetail(exerciseName: string, change: TrainingProgressFactChange): string {
  const percent = Math.abs(Math.round(change.changePercent))
  if (change.metric === 'pace') return `${exerciseName}: темп быстрее на ${percent}%`
  return `${exerciseName}: +${percent}%`
}

export function progressBodyMap(summary: PublishedTrainingSummary): BodyMapData {
  const grouped = new Map<MuscleGroup, Array<{ percent: number; detail: string }>>()
  for (const fact of summary.metrics.progressFacts) {
    const change = favorableChange(fact.changes)
    if (!change) continue
    const group = muscleGroupForExerciseName(fact.exerciseName)
    if (!BODY_GROUPS.has(group)) continue
    const current = grouped.get(group) ?? []
    current.push({
      percent: Math.abs(change.changePercent),
      detail: progressDetail(fact.exerciseName, change),
    })
    grouped.set(group, current)
  }

  const regions = [...grouped.entries()]
    .map(([group, values]) => {
      const percent = Math.max(1, Math.round(median(values.map((value) => value.percent))))
      return {
        group,
        label: MUSCLE_GROUP_LABELS[group],
        percent,
        valueLabel: `+${percent}%`,
        details: values.sort((left, right) => right.percent - left.percent).slice(0, 3).map((value) => value.detail),
        intensity: Math.min(1, Math.max(.28, percent / 50)),
      }
    })
    .sort((left, right) => right.percent - left.percent)

  return {
    mode: 'progress',
    title: 'Где выросли результаты',
    description: 'Изменения по подтверждённым результатам упражнений',
    regions,
    emptyMessage: 'Сохрани ещё один результат — и здесь появятся первые зоны прогресса.',
  }
}

export function loadBodyMap(workouts: readonly Workout[], periodStart: string, periodEnd: string): BodyMapData {
  const counts = new Map<MuscleGroup, { sets: number; exercises: Map<string, number> }>()
  let totalSets = 0
  for (const workout of workouts) {
    if (workout.status !== 'done' || workout.workoutDate < periodStart || workout.workoutDate > periodEnd) continue
    for (const exercise of workout.exercises) {
      const confirmedSets = exercise.sets.filter((set) => Boolean(set.confirmedAt)).length
      if (confirmedSets === 0) continue
      totalSets += confirmedSets
      const current = counts.get(exercise.muscleGroup) ?? { sets: 0, exercises: new Map<string, number>() }
      current.sets += confirmedSets
      current.exercises.set(exercise.name, (current.exercises.get(exercise.name) ?? 0) + confirmedSets)
      counts.set(exercise.muscleGroup, current)
    }
  }

  const regions = [...counts.entries()]
    .filter(([group]) => BODY_GROUPS.has(group))
    .map(([group, value]) => {
      const percent = totalSets > 0 ? Math.max(1, Math.round(value.sets / totalSets * 100)) : 0
      const details = [...value.exercises.entries()]
        .sort((left, right) => right[1] - left[1])
        .slice(0, 3)
        .map(([name, sets]) => `${name}: ${sets} ${sets === 1 ? 'подход' : sets < 5 ? 'подхода' : 'подходов'}`)
      return {
        group,
        label: MUSCLE_GROUP_LABELS[group],
        percent,
        valueLabel: `${percent}%`,
        details,
        intensity: Math.min(1, Math.max(.28, percent / 45)),
      }
    })
    .sort((left, right) => right.percent - left.percent)

  return {
    mode: 'load',
    title: 'Куда пришлась нагрузка',
    description: 'Доля подтверждённых подходов за выбранный период',
    regions,
    emptyMessage: 'После завершённой тренировки покажем, на какие зоны пришлась нагрузка.',
  }
}
