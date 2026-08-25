import type { MuscleGroup, PublishedTrainingSummary, TrainingProgressFactChange, Workout } from '../../shared/domain'
import { SYSTEM_EXERCISE_CATALOG } from '../../shared/system-exercises'
import { progressFactChangeLabel } from './progress-facts'

export type BodyMapMode = 'progress' | 'load'

export type BodyMapZone =
  | 'chest'
  | 'shoulders'
  | 'biceps'
  | 'triceps'
  | 'forearms'
  | 'core'
  | 'upper_back'
  | 'lower_back'
  | 'glutes'
  | 'quadriceps'
  | 'hamstrings'
  | 'calves'
  | 'inner_thigh'
  | 'outer_thigh'
  | 'arms'
  | 'legs'
  | 'back'

export interface BodyMapRegion {
  group: BodyMapZone
  label: string
  percent: number
  valueLabel: string
  summaryLabel: string
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

const BODY_ZONE_LABELS: Record<BodyMapZone, string> = {
  chest: 'Грудь',
  shoulders: 'Плечи',
  biceps: 'Бицепс',
  triceps: 'Трицепс',
  forearms: 'Предплечья',
  core: 'Кор',
  upper_back: 'Верх спины',
  lower_back: 'Поясница',
  glutes: 'Ягодицы',
  quadriceps: 'Передняя поверхность бедра',
  hamstrings: 'Задняя поверхность бедра',
  calves: 'Икры',
  inner_thigh: 'Внутренняя поверхность бедра',
  outer_thigh: 'Наружная поверхность бедра',
  arms: 'Руки',
  legs: 'Ноги',
  back: 'Спина',
}

const BROAD_BODY_ZONES: Partial<Record<MuscleGroup, BodyMapZone>> = {
  legs: 'legs',
  glutes: 'glutes',
  chest: 'chest',
  back: 'back',
  shoulders: 'shoulders',
  arms: 'arms',
  core: 'core',
}

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
    primaryMuscleDetail: exercise.primaryMuscleDetail,
  }))
  .filter((exercise) => exercise.normalized.length > 2)
  .sort((left, right) => right.normalized.length - left.normalized.length)

function catalogExercise(name: string): typeof CATALOG_NAMES[number] | undefined {
  const normalized = normalizeExerciseName(name)
  return CATALOG_NAMES.find((exercise) => normalized === exercise.normalized)
    ?? CATALOG_NAMES.find((exercise) =>
      normalized.startsWith(`${exercise.normalized} `)
      || exercise.normalized.startsWith(`${normalized} `))
}

export function muscleGroupForExerciseName(name: string): MuscleGroup {
  const normalized = normalizeExerciseName(name)
  const catalogMatch = catalogExercise(name)
  if (catalogMatch) return catalogMatch.group

  if (/ягод|глют/.test(normalized)) return 'glutes'
  if (/пресс|планк|скручив|кор /.test(normalized)) return 'core'
  if (/бицепс|трицепс|молот|французск|предплеч/.test(normalized)) return 'arms'
  if (/плеч|дельт|шраг/.test(normalized)) return 'shoulders'
  if (/тяга|подтяг|гиперэкстенз/.test(normalized)) return 'back'
  if (/жим ног|присед|выпад|бедр|голен|икрон|сгибание ног|разгибание ног/.test(normalized)) return 'legs'
  if (/жим|груд|развод|отжим|бабочк/.test(normalized)) return 'chest'
  if (/бег|ходьб|вел|греб|эллип|скакал|берпи/.test(normalized)) return 'cardio'
  return 'other'
}

function zoneForMuscleDetail(detail?: string): BodyMapZone | undefined {
  const normalized = normalizeExerciseName(detail ?? '')
  if (!normalized) return undefined
  if (/внутренняя поверхность бедра/.test(normalized)) return 'inner_thigh'
  if (/наружная поверхность бедра/.test(normalized)) return 'outer_thigh'
  if (/передняя поверхность бедра/.test(normalized)) return 'quadriceps'
  if (/задняя поверхность бедра/.test(normalized)) return 'hamstrings'
  if (/икрон/.test(normalized)) return 'calves'
  if (/ягод/.test(normalized)) return 'glutes'
  if (/бицепс/.test(normalized)) return 'biceps'
  if (/трицепс/.test(normalized)) return 'triceps'
  if (/предплеч/.test(normalized)) return 'forearms'
  if (/груд/.test(normalized)) return 'chest'
  if (/дельт|плеч/.test(normalized)) return 'shoulders'
  if (/поясниц/.test(normalized)) return 'lower_back'
  if (/широч|середина спины|трапец|верх спины/.test(normalized)) return 'upper_back'
  if (/пресс|кор/.test(normalized)) return 'core'
  return undefined
}

export function bodyZoneForExerciseName(name: string, fallbackGroup?: MuscleGroup): BodyMapZone | undefined {
  const catalogMatch = catalogExercise(name)
  const detailed = zoneForMuscleDetail(catalogMatch?.primaryMuscleDetail)
  if (detailed) return detailed

  const normalized = normalizeExerciseName(name)
  if (/сгибание ног|румынск|прямых ног/.test(normalized)) return 'hamstrings'
  if (/разгибание ног/.test(normalized)) return 'quadriceps'
  if (/икрон|подъем на носки|подъём на носки|голен/.test(normalized)) return 'calves'
  if (/ягод|глют/.test(normalized)) return 'glutes'
  if (/бицепс|молот/.test(normalized)) return 'biceps'
  if (/трицепс|французск/.test(normalized)) return 'triceps'
  if (/предплеч/.test(normalized)) return 'forearms'
  if (/плеч|дельт|шраг/.test(normalized)) return 'shoulders'
  if (/гиперэкстенз|поясниц/.test(normalized)) return 'lower_back'
  if (/тяга верхнего блока|тяга нижнего блока|подтяг|широч|тяга .*наклон/.test(normalized)) return 'upper_back'
  if (/пресс|планк|скручив|кор /.test(normalized)) return 'core'
  if (/жим|груд|развод|отжим|бабочк/.test(normalized)) return 'chest'

  const group = fallbackGroup ?? catalogMatch?.group ?? muscleGroupForExerciseName(name)
  return BROAD_BODY_ZONES[group]
}

function favorableChange(changes: readonly TrainingProgressFactChange[]): TrainingProgressFactChange | undefined {
  for (const metric of METRIC_PRIORITY) {
    const match = changes.find((change) => change.metric === metric && change.favorable === true)
    if (match) return match
  }
  return undefined
}

function exerciseCountLabel(count: number): string {
  if (count % 10 === 1 && count % 100 !== 11) return `${count} упражнение с прогрессом`
  if ([2, 3, 4].includes(count % 10) && ![12, 13, 14].includes(count % 100)) return `${count} упражнения с прогрессом`
  return `${count} упражнений с прогрессом`
}

function setCountLabel(count: number): string {
  if (count % 10 === 1 && count % 100 !== 11) return `${count} подход`
  if ([2, 3, 4].includes(count % 10) && ![12, 13, 14].includes(count % 100)) return `${count} подхода`
  return `${count} подходов`
}

export function progressBodyMap(summary: PublishedTrainingSummary): BodyMapData {
  const grouped = new Map<BodyMapZone, Array<{ percent: number; detail: string }>>()
  for (const fact of summary.metrics.progressFacts) {
    const change = favorableChange(fact.changes)
    if (!change) continue
    const group = bodyZoneForExerciseName(fact.exerciseName)
    if (!group) continue
    const current = grouped.get(group) ?? []
    current.push({
      percent: Math.abs(change.changePercent),
      detail: `${fact.exerciseName} · ${progressFactChangeLabel(change)}`,
    })
    grouped.set(group, current)
  }

  const regions = [...grouped.entries()]
    .map(([group, values]) => {
      const sorted = values.sort((left, right) => right.percent - left.percent)
      const percent = Math.max(1, Math.round(sorted[0]!.percent))
      return {
        group,
        label: BODY_ZONE_LABELS[group],
        percent,
        valueLabel: `+${percent}%`,
        summaryLabel: exerciseCountLabel(values.length),
        details: sorted.slice(0, 3).map((value) => value.detail),
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
  const counts = new Map<BodyMapZone, { sets: number; exercises: Map<string, number> }>()
  let totalSets = 0
  for (const workout of workouts) {
    if (workout.status !== 'done' || workout.workoutDate < periodStart || workout.workoutDate > periodEnd) continue
    for (const exercise of workout.exercises) {
      const confirmedSets = exercise.sets.filter((set) => Boolean(set.confirmedAt)).length
      if (confirmedSets === 0) continue
      const group = bodyZoneForExerciseName(exercise.name, exercise.muscleGroup)
      if (!group) continue
      totalSets += confirmedSets
      const current = counts.get(group) ?? { sets: 0, exercises: new Map<string, number>() }
      current.sets += confirmedSets
      current.exercises.set(exercise.name, (current.exercises.get(exercise.name) ?? 0) + confirmedSets)
      counts.set(group, current)
    }
  }

  const regions = [...counts.entries()]
    .map(([group, value]) => {
      const percent = totalSets > 0 ? Math.max(1, Math.round(value.sets / totalSets * 100)) : 0
      const details = [...value.exercises.entries()]
        .sort((left, right) => right[1] - left[1])
        .slice(0, 3)
        .map(([name, sets]) => `${name}: ${setCountLabel(sets)}`)
      return {
        group,
        label: BODY_ZONE_LABELS[group],
        percent,
        valueLabel: `${percent}%`,
        summaryLabel: `${setCountLabel(value.sets)} из ${totalSets}`,
        details,
        intensity: Math.min(1, Math.max(.28, percent / 45)),
      }
    })
    .sort((left, right) => right.percent - left.percent)

  return {
    mode: 'load',
    title: 'Куда пришлась работа',
    description: 'Доля подтверждённых подходов за выбранный период',
    regions,
    emptyMessage: 'После завершённой тренировки покажем, на какие зоны пришлась работа.',
  }
}
