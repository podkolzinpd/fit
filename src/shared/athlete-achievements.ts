import type { Workout } from './domain'
import { addDays, daysBetween, todayInTimeZone, weekdayIndex, type LocalDate } from './local-date'
import { resultExerciseKey, workoutResults } from './workout-results'

export type AchievementId = 'workouts-1' | 'workouts-5' | 'workouts-10' | 'workouts-25' | 'workouts-50' | 'workouts-100'
  | 'weeks-4' | 'weeks-8' | 'weeks-12' | 'weeks-total-52' | 'comeback-21' | 'records-1' | 'records-5'
  | 'plank-5m' | 'plank-30m' | 'plank-2h'
  | 'workout-tonnage-1t' | 'workout-tonnage-5t' | 'workout-tonnage-10t'
  | 'lifetime-tonnage-10t' | 'lifetime-tonnage-100t' | 'lifetime-tonnage-500t'
  | 'distance-5km' | 'distance-50km' | 'distance-250km'
  | 'cardio-1h' | 'cardio-10h' | 'cardio-50h'
  | 'record-exercises-3' | 'record-exercises-10'
  | 'variety-3' | 'variety-15' | 'variety-40'
export type AchievementKind = 'workouts' | 'weeks' | 'weeks-total' | 'comeback' | 'records'
  | 'plank' | 'workout-tonnage' | 'lifetime-tonnage' | 'distance' | 'cardio' | 'record-exercises' | 'variety'

export interface AthleteAchievement {
  id: AchievementId
  kind: AchievementKind
  title: string
  threshold: number
  description: string
  earnedOn: LocalDate | null
  earnedAt: string | null
  sourceWorkoutId: string | null
  progress: number
  nearest: boolean
}

const definitions: readonly Pick<AthleteAchievement, 'id' | 'kind' | 'title' | 'threshold' | 'description'>[] = [
  { id: 'workouts-1', kind: 'workouts', title: 'Первый шаг', threshold: 1, description: 'Завершить 1 тренировку' },
  { id: 'workouts-5', kind: 'workouts', title: 'Первая пятёрка', threshold: 5, description: 'Завершить 5 тренировок' },
  { id: 'workouts-10', kind: 'workouts', title: 'В ритме', threshold: 10, description: 'Завершить 10 тренировок' },
  { id: 'workouts-25', kind: 'workouts', title: 'Крепкая привычка', threshold: 25, description: 'Завершить 25 тренировок' },
  { id: 'workouts-50', kind: 'workouts', title: 'Полсотни', threshold: 50, description: 'Завершить 50 тренировок' },
  { id: 'workouts-100', kind: 'workouts', title: 'Сотня', threshold: 100, description: 'Завершить 100 тренировок' },
  { id: 'weeks-4', kind: 'weeks', title: 'Четыре недели', threshold: 4, description: 'Завершить тренировку 4 недели подряд' },
  { id: 'weeks-8', kind: 'weeks', title: 'Восемь недель', threshold: 8, description: 'Завершить тренировку 8 недель подряд' },
  { id: 'weeks-12', kind: 'weeks', title: 'Двенадцать недель', threshold: 12, description: 'Завершить тренировку 12 недель подряд' },
  { id: 'weeks-total-52', kind: 'weeks-total', title: 'Год движения', threshold: 52, description: 'Завершить тренировки в 52 разные недели за всё время. Недели могут идти не подряд' },
  { id: 'comeback-21', kind: 'comeback', title: 'Снова в деле', threshold: 21, description: 'Завершить тренировку после перерыва не менее 21 дня' },
  { id: 'records-1', kind: 'records', title: 'Первый рекорд', threshold: 1, description: 'Установить первый личный рекорд в завершённой тренировке' },
  { id: 'records-5', kind: 'records', title: 'Рекорды копятся', threshold: 5, description: 'Установить личные рекорды в 5 разных тренировках' },
  { id: 'plank-5m', kind: 'plank', title: 'Начинающий стоятель', threshold: 300, description: 'Накопить 5 минут в упражнении «Планка»' },
  { id: 'plank-30m', kind: 'plank', title: 'Фанат планки', threshold: 1_800, description: 'Накопить 30 минут в упражнении «Планка»' },
  { id: 'plank-2h', kind: 'plank', title: 'Железный корпус', threshold: 7_200, description: 'Накопить 2 часа в упражнении «Планка»' },
  { id: 'workout-tonnage-1t', kind: 'workout-tonnage', title: 'Легковушка', threshold: 1_000, description: 'Поднять суммарно 1 тонну за одну тренировку' },
  { id: 'workout-tonnage-5t', kind: 'workout-tonnage', title: 'Микроавтобус', threshold: 5_000, description: 'Поднять суммарно 5 тонн за одну тренировку' },
  { id: 'workout-tonnage-10t', kind: 'workout-tonnage', title: 'Автобус', threshold: 10_000, description: 'Поднять суммарно 10 тонн за одну тренировку' },
  { id: 'lifetime-tonnage-10t', kind: 'lifetime-tonnage', title: 'Первый груз', threshold: 10_000, description: 'Поднять суммарно 10 тонн за всё время' },
  { id: 'lifetime-tonnage-100t', kind: 'lifetime-tonnage', title: 'Тяжеловоз', threshold: 100_000, description: 'Поднять суммарно 100 тонн за всё время' },
  { id: 'lifetime-tonnage-500t', kind: 'lifetime-tonnage', title: 'Гора сдвинута', threshold: 500_000, description: 'Поднять суммарно 500 тонн за всё время' },
  { id: 'distance-5km', kind: 'distance', title: 'Первые километры', threshold: 5, description: 'Накопить 5 км фактически записанной дистанции' },
  { id: 'distance-50km', kind: 'distance', title: 'Любитель маршрутов', threshold: 50, description: 'Накопить 50 км фактически записанной дистанции' },
  { id: 'distance-250km', kind: 'distance', title: 'Дальний путь', threshold: 250, description: 'Накопить 250 км фактически записанной дистанции' },
  { id: 'cardio-1h', kind: 'cardio', title: 'Минута за минутой', threshold: 3_600, description: 'Накопить 1 час фактического времени кардиоупражнений' },
  { id: 'cardio-10h', kind: 'cardio', title: 'Время в деле', threshold: 36_000, description: 'Накопить 10 часов фактического времени кардиоупражнений' },
  { id: 'cardio-50h', kind: 'cardio', title: 'Мастер выдержки', threshold: 180_000, description: 'Накопить 50 часов фактического времени кардиоупражнений' },
  { id: 'record-exercises-3', kind: 'record-exercises', title: 'Коллекционер рекордов', threshold: 3, description: 'Установить личные рекорды в 3 разных упражнениях' },
  { id: 'record-exercises-10', kind: 'record-exercises', title: 'Без границ', threshold: 10, description: 'Установить личные рекорды в 10 разных упражнениях' },
  { id: 'variety-3', kind: 'variety', title: 'Пробую новое', threshold: 3, description: 'Выполнить подходы в 3 разных упражнениях' },
  { id: 'variety-15', kind: 'variety', title: 'Широкий арсенал', threshold: 15, description: 'Выполнить подходы в 15 разных упражнениях' },
  { id: 'variety-40', kind: 'variety', title: 'Знаю своё дело', threshold: 40, description: 'Выполнить подходы в 40 разных упражнениях' },
]

const positive = (value: number | undefined): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0
const nonNegative = (value: number | undefined): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0
const factSeconds = (fact: { durationSec?: number; durationMin?: number }): number =>
  positive(fact.durationSec) ? fact.durationSec : positive(fact.durationMin) ? fact.durationMin * 60 : 0

/** Keep the agreed thresholds in their exact source units; only the UI formats them. */
export function achievementProgressLabel(item: AthleteAchievement): string {
  const scale = item.kind === 'plank' ? 60 : item.kind === 'cardio' ? 3_600
    : item.kind === 'workout-tonnage' || item.kind === 'lifetime-tonnage' ? 1_000 : 1
  const unit = item.kind === 'plank' ? 'мин' : item.kind === 'cardio' ? 'ч'
    : item.kind === 'workout-tonnage' || item.kind === 'lifetime-tonnage' ? 'т'
      : item.kind === 'distance' ? 'км' : ''
  const format = (value: number) => (Math.floor(value / scale * 10) / 10).toLocaleString('ru-RU', { maximumFractionDigits: 1 })
  return `${format(item.progress)} из ${format(item.threshold)}${unit ? ` ${unit}` : ''}`
}

function monday(date: LocalDate): LocalDate {
  return addDays(date, -((weekdayIndex(date) + 6) % 7))
}

function completedDate(workout: Workout, timeZone?: string | null): LocalDate {
  const completedAt = workout.completedAt ? new Date(workout.completedAt) : null
  return completedAt && !Number.isNaN(completedAt.getTime())
    ? todayInTimeZone(timeZone, completedAt)
    : workout.workoutDate
}

export function computeAthleteAchievements(workouts: readonly Workout[], today: LocalDate, timeZone?: string | null): AthleteAchievement[] {
  const unique = new Map<string, Workout>()
  for (const workout of workouts) if (workout.status === 'done') unique.set(workout.id, workout)
  const completed = [...unique.values()].sort((a, b) =>
    (a.completedAt ?? `${a.workoutDate}T00:00:00`).localeCompare(b.completedAt ?? `${b.workoutDate}T00:00:00`)
      || a.id.localeCompare(b.id))
  // Reuse the same confirmed-fact comparison as the workout result screen. A
  // first result is a baseline, not a record; several metrics in one workout
  // still count as only one record-bearing workout.
  const recordsByWorkout = new Map<string, Set<string>>()
  for (const result of workoutResults(completed)) {
    if (result.state !== 'record') continue
    const keys = recordsByWorkout.get(result.workout.id) ?? new Set<string>()
    keys.add(result.exerciseKey)
    recordsByWorkout.set(result.workout.id, keys)
  }
  const awarded = new Map<AchievementId, { date: LocalDate; at: string; workoutId: string }>()
  let weekRun = 0
  let lastWeek: LocalDate | null = null
  let lastDate: LocalDate | null = null
  const distinctWeeks = new Set<LocalDate>()
  let recordWorkouts = 0
  let totalPlankSeconds = 0
  let bestWorkoutVolumeKg = 0
  let totalVolumeKg = 0
  let totalDistanceKm = 0
  let totalCardioSeconds = 0
  const performedExerciseKeys = new Set<string>()
  const recordExerciseKeys = new Set<string>()
  for (const [index, workout] of completed.entries()) {
    const date = completedDate(workout, timeZone)
    const week = monday(date)
    const returnedAfterBreak = lastDate !== null && daysBetween(lastDate, date) >= 21
    lastDate = date
    distinctWeeks.add(week)
    const recordKeys = recordsByWorkout.get(workout.id)
    if (recordKeys?.size) {
      recordWorkouts += 1
      for (const key of recordKeys) recordExerciseKeys.add(key)
    }
    let workoutVolumeKg = 0
    for (const exercise of workout.exercises) {
      const confirmed = exercise.sets.filter((set) => set.confirmedAt)
      if (confirmed.length && exercise.ref) performedExerciseKeys.add(resultExerciseKey(exercise))
      for (const set of confirmed) {
        const fact = set.fact
        const seconds = factSeconds(fact)
        if (exercise.source === 'system' && exercise.ref === 'plank') totalPlankSeconds += seconds
        if (exercise.inputKind === 'strength' && nonNegative(fact.weightKg) && positive(fact.reps)) workoutVolumeKg += fact.weightKg * fact.reps
        if (positive(fact.distanceKm)) totalDistanceKm += fact.distanceKm
        if ((exercise.muscleGroup === 'cardio' || exercise.inputKind === 'distance') && !(exercise.source === 'system' && exercise.ref === 'plank')) totalCardioSeconds += seconds
      }
    }
    totalVolumeKg += workoutVolumeKg
    bestWorkoutVolumeKg = Math.max(bestWorkoutVolumeKg, workoutVolumeKg)
    if (lastWeek !== week) {
      weekRun = lastWeek && daysBetween(lastWeek, week) === 7 ? weekRun + 1 : 1
      lastWeek = week
    }
    for (const item of definitions) {
      if (awarded.has(item.id)) continue
      if ((item.kind === 'workouts' && index + 1 >= item.threshold)
        || (item.kind === 'weeks' && weekRun >= item.threshold)
        || (item.kind === 'weeks-total' && distinctWeeks.size >= item.threshold)
        || (item.kind === 'comeback' && returnedAfterBreak)
        || (item.kind === 'records' && recordWorkouts >= item.threshold)
        || (item.kind === 'plank' && totalPlankSeconds >= item.threshold)
        || (item.kind === 'workout-tonnage' && workoutVolumeKg >= item.threshold)
        || (item.kind === 'lifetime-tonnage' && totalVolumeKg >= item.threshold)
        || (item.kind === 'distance' && totalDistanceKm >= item.threshold)
        || (item.kind === 'cardio' && totalCardioSeconds >= item.threshold)
        || (item.kind === 'record-exercises' && recordExerciseKeys.size >= item.threshold)
        || (item.kind === 'variety' && performedExerciseKeys.size >= item.threshold)) {
        awarded.set(item.id, { date, at: workout.completedAt ?? `${date}T00:00:00`, workoutId: workout.id })
      }
    }
  }
  const currentWeek = monday(today)
  const activeWeeks = lastWeek && daysBetween(lastWeek, currentWeek) <= 7 && daysBetween(lastWeek, currentWeek) >= 0 ? weekRun : 0
  return definitions.map((item) => {
    const earned = awarded.get(item.id)
    const current = item.kind === 'workouts' ? completed.length : item.kind === 'weeks' ? activeWeeks
      : item.kind === 'weeks-total' ? distinctWeeks.size : item.kind === 'records' ? recordWorkouts
        : item.kind === 'plank' ? totalPlankSeconds : item.kind === 'workout-tonnage' ? bestWorkoutVolumeKg
          : item.kind === 'lifetime-tonnage' ? totalVolumeKg : item.kind === 'distance' ? totalDistanceKm
            : item.kind === 'cardio' ? totalCardioSeconds : item.kind === 'record-exercises' ? recordExerciseKeys.size
              : item.kind === 'variety' ? performedExerciseKeys.size : 0
    return {
      ...item,
      earnedOn: earned?.date ?? null,
      earnedAt: earned?.at ?? null,
      sourceWorkoutId: earned?.workoutId ?? null,
      progress: earned ? item.threshold : Math.min(current, item.threshold),
      nearest: item.kind !== 'comeback' && !earned && !definitions.some((other) => other.kind === item.kind && other.threshold < item.threshold && !awarded.has(other.id)),
    }
  })
}

export function latestAthleteAchievement(items: readonly AthleteAchievement[]): AthleteAchievement | null {
  return items.filter((item) => item.earnedOn).sort((a, b) =>
    b.earnedAt!.localeCompare(a.earnedAt!) || definitions.findIndex((item) => item.id === b.id) - definitions.findIndex((item) => item.id === a.id))[0] ?? null
}

export function newlyEarnedAchievements(items: readonly AthleteAchievement[], workoutId: string): AthleteAchievement[] {
  return items.filter((item) => item.sourceWorkoutId === workoutId)
}
