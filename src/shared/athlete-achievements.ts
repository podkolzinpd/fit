import { createAchievementActivity } from './athlete-achievement-activity'
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
  | 'lifetime-tonnage-250t' | 'lifetime-tonnage-1000t' | 'lifetime-tonnage-1500t' | 'workouts-75' | 'workouts-150'
  | 'records-10' | 'records-25' | 'run-single-5km' | 'run-single-10km' | 'run-total-50km' | 'run-total-100km'
  | 'run-total-250km' | 'run-workouts-10' | 'bike-workouts-5' | 'bike-workouts-15' | 'bike-workouts-30' | 'row-workouts-5'
  | 'row-workouts-15' | 'row-workouts-30' | 'ellipse-workouts-5' | 'ellipse-workouts-15' | 'ellipse-workouts-30'
  | 'rope-reps-500' | 'rope-reps-2000' | 'rope-reps-5000' | 'push-reps-100' | 'push-reps-500' | 'push-reps-1000'
  | 'pull-reps-25' | 'pull-reps-100' | 'pull-reps-250' | 'plank-1h' | 'cardio-25h' | 'cardio-100h' | 'rhythm-4'
  | 'rhythm-8' | 'rhythm-12' | 'three-weekly-4' | 'flexible-6' | 'month-days-8' | 'month-days-12' | 'active-months-3'
  | 'active-months-6' | 'comeback-rhythm' | 'versatile' | 'strength-endurance' | 'movement-balance' | 'cardio-choice'
  | 'equipment-variety' | 'four-seasons'
export type AchievementKind = 'workouts' | 'weeks' | 'weeks-total' | 'comeback' | 'records'
  | 'plank' | 'workout-tonnage' | 'lifetime-tonnage' | 'distance' | 'cardio' | 'record-exercises' | 'variety'
  | 'run-single' | 'run-total' | 'run-workouts' | 'bike-workouts' | 'row-workouts' | 'ellipse-workouts' | 'rope-reps'
  | 'push-reps' | 'pull-reps' | 'rhythm' | 'three-weekly' | 'flexible' | 'month-days' | 'active-months'
  | 'comeback-rhythm' | 'versatile' | 'strength-endurance' | 'movement-balance' | 'cardio-choice' | 'equipment-variety'
  | 'four-seasons'

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
  currentPeriodProgress?: number
  earnedCount?: number
  earnedWorkoutIds?: readonly string[]
  lastEarnedOn?: LocalDate
  lastEarnedAt?: string
}

const definitions: readonly Pick<AthleteAchievement, 'id' | 'kind' | 'title' | 'threshold' | 'description'>[] = [
  { id: 'workouts-1', kind: 'workouts', title: 'Первый шаг', threshold: 1, description: 'Завершить 1 тренировку' },
  { id: 'workouts-5', kind: 'workouts', title: 'Первая пятёрка', threshold: 5, description: 'Завершить 5 тренировок' },
  { id: 'workouts-10', kind: 'workouts', title: 'Десятка тренировок', threshold: 10, description: 'Завершить 10 тренировок' },
  { id: 'workouts-25', kind: 'workouts', title: 'Четверть сотни', threshold: 25, description: 'Завершить 25 тренировок' },
  { id: 'workouts-50', kind: 'workouts', title: 'Полсотни', threshold: 50, description: 'Завершить 50 тренировок' },
  { id: 'workouts-100', kind: 'workouts', title: 'Сотня', threshold: 100, description: 'Завершить 100 тренировок' },
  { id: 'weeks-4', kind: 'weeks', title: 'Четыре недели', threshold: 4, description: '4 недели подряд по 1 тренировке' },
  { id: 'weeks-8', kind: 'weeks', title: 'Восемь недель', threshold: 8, description: '8 недель подряд по 1 тренировке' },
  { id: 'weeks-12', kind: 'weeks', title: 'Двенадцать недель', threshold: 12, description: '12 недель подряд по 1 тренировке' },
  { id: 'weeks-total-52', kind: 'weeks-total', title: '52 активные недели', threshold: 52, description: 'По 1 тренировке в 52 разные недели. Не обязательно подряд' },
  { id: 'comeback-21', kind: 'comeback', title: 'Снова в деле', threshold: 21, description: 'Тренировка после перерыва не менее 21 дня' },
  { id: 'records-1', kind: 'records', title: 'Первый рекорд', threshold: 1, description: 'Установить первый личный рекорд в завершённой тренировке' },
  { id: 'records-5', kind: 'records', title: 'Рекорды копятся', threshold: 5, description: 'Установить личные рекорды в 5 разных тренировках' },
  { id: 'plank-5m', kind: 'plank', title: 'Первая опора', threshold: 300, description: 'Накопить 5 минут в упражнении «Планка»' },
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
  { id: 'lifetime-tonnage-250t', kind: 'lifetime-tonnage', title: 'Весомый результат', threshold: 250000, description: 'Поднять суммарно 250 тонн за всё время' },
  { id: 'lifetime-tonnage-1000t', kind: 'lifetime-tonnage', title: 'Тысяча тонн', threshold: 1000000, description: 'Поднять суммарно 1000 тонн за всё время' },
  { id: 'lifetime-tonnage-1500t', kind: 'lifetime-tonnage', title: 'Большая работа', threshold: 1500000, description: 'Поднять суммарно 1500 тонн за всё время' },
  { id: 'workouts-75', kind: 'workouts', title: 'Три четверти сотни', threshold: 75, description: 'Завершить 75 тренировок' },
  { id: 'workouts-150', kind: 'workouts', title: 'Полторы сотни', threshold: 150, description: 'Завершить 150 тренировок' },
  { id: 'records-10', kind: 'records', title: 'Новая высота', threshold: 10, description: 'Установить личные рекорды в 10 разных тренировках' },
  { id: 'records-25', kind: 'records', title: 'Рекордная история', threshold: 25, description: 'Установить личные рекорды в 25 разных тренировках' },
  { id: 'run-single-5km', kind: 'run-single', title: 'Моя пятёрка', threshold: 5, description: 'Пробежать 5 км за одну тренировку' },
  { id: 'run-single-10km', kind: 'run-single', title: 'Моя десятка', threshold: 10, description: 'Пробежать 10 км за одну тренировку' },
  { id: 'run-total-50km', kind: 'run-total', title: 'Бег: первые 50', threshold: 50, description: 'Накопить 50 км в упражнении «Бег»' },
  { id: 'run-total-100km', kind: 'run-total', title: 'Беговая сотня', threshold: 100, description: 'Накопить 100 км в упражнении «Бег»' },
  { id: 'run-total-250km', kind: 'run-total', title: 'Беговой горизонт', threshold: 250, description: 'Накопить 250 км в упражнении «Бег»' },
  { id: 'run-workouts-10', kind: 'run-workouts', title: 'Бег вошёл в привычку', threshold: 10, description: 'Выполнить упражнение «Бег» в 10 разных тренировках' },
  { id: 'bike-workouts-5', kind: 'bike-workouts', title: 'Кручу педали', threshold: 5, description: 'Заниматься на велотренажёре в 5 разных тренировках' },
  { id: 'bike-workouts-15', kind: 'bike-workouts', title: 'Педали в ритме', threshold: 15, description: 'Заниматься на велотренажёре в 15 разных тренировках' },
  { id: 'bike-workouts-30', kind: 'bike-workouts', title: 'Мастер педалей', threshold: 30, description: 'Заниматься на велотренажёре в 30 разных тренировках' },
  { id: 'row-workouts-5', kind: 'row-workouts', title: 'Держу курс', threshold: 5, description: 'Заниматься на гребном тренажёре в 5 разных тренировках' },
  { id: 'row-workouts-15', kind: 'row-workouts', title: 'Гребной ритм', threshold: 15, description: 'Заниматься на гребном тренажёре в 15 разных тренировках' },
  { id: 'row-workouts-30', kind: 'row-workouts', title: 'Мастер гребли', threshold: 30, description: 'Заниматься на гребном тренажёре в 30 разных тренировках' },
  { id: 'ellipse-workouts-5', kind: 'ellipse-workouts', title: 'На своей орбите', threshold: 5, description: 'Заниматься на эллиптическом тренажёре в 5 разных тренировках' },
  { id: 'ellipse-workouts-15', kind: 'ellipse-workouts', title: 'Орбита движения', threshold: 15, description: 'Заниматься на эллиптическом тренажёре в 15 разных тренировках' },
  { id: 'ellipse-workouts-30', kind: 'ellipse-workouts', title: 'Мастер орбиты', threshold: 30, description: 'Заниматься на эллиптическом тренажёре в 30 разных тренировках' },
  { id: 'rope-reps-500', kind: 'rope-reps', title: 'Первые 500 прыжков', threshold: 500, description: 'Накопить 500 повторений в упражнении «Прыжки со скакалкой»' },
  { id: 'rope-reps-2000', kind: 'rope-reps', title: 'Прыжок за прыжком', threshold: 2000, description: 'Накопить 2000 повторений в упражнении «Прыжки со скакалкой»' },
  { id: 'rope-reps-5000', kind: 'rope-reps', title: 'Мастер скакалки', threshold: 5000, description: 'Накопить 5000 повторений в упражнении «Прыжки со скакалкой»' },
  { id: 'push-reps-100', kind: 'push-reps', title: 'Первая сотня отжиманий', threshold: 100, description: 'Накопить 100 повторений в упражнении «Отжимания»' },
  { id: 'push-reps-500', kind: 'push-reps', title: 'Сильная опора', threshold: 500, description: 'Накопить 500 повторений в упражнении «Отжимания»' },
  { id: 'push-reps-1000', kind: 'push-reps', title: 'Тысяча отжиманий', threshold: 1000, description: 'Накопить 1000 повторений в упражнении «Отжимания»' },
  { id: 'pull-reps-25', kind: 'pull-reps', title: 'Тянусь вверх', threshold: 25, description: 'Накопить 25 повторений в упражнении «Подтягивания»' },
  { id: 'pull-reps-100', kind: 'pull-reps', title: 'Выше перекладины', threshold: 100, description: 'Накопить 100 повторений в упражнении «Подтягивания»' },
  { id: 'pull-reps-250', kind: 'pull-reps', title: 'Сила притяжения', threshold: 250, description: 'Накопить 250 повторений в упражнении «Подтягивания»' },
  { id: 'plank-1h', kind: 'plank', title: 'Час опоры', threshold: 3600, description: 'Накопить 1 час в упражнении «Планка»' },
  { id: 'cardio-25h', kind: 'cardio', title: 'Сердце в ритме', threshold: 90000, description: 'Накопить 25 часов фактического времени кардиоупражнений' },
  { id: 'cardio-100h', kind: 'cardio', title: 'Сто часов движения', threshold: 360000, description: 'Накопить 100 часов фактического времени кардиоупражнений' },
  { id: 'rhythm-4', kind: 'rhythm', title: 'Нашёл ритм', threshold: 4, description: '4 недели подряд по 2 тренировки' },
  { id: 'rhythm-8', kind: 'rhythm', title: 'Держу ритм', threshold: 8, description: '8 недель подряд по 2 тренировки' },
  { id: 'rhythm-12', kind: 'rhythm', title: 'Ритм на квартал', threshold: 12, description: '12 недель подряд по 2 тренировки' },
  { id: 'three-weekly-4', kind: 'three-weekly', title: 'Трижды в неделю', threshold: 4, description: '4 недели подряд по 3 тренировки' },
  { id: 'flexible-6', kind: 'flexible', title: 'В своём темпе', threshold: 6, description: 'В любые 6 из 8 недель — по 2 тренировки' },
  { id: 'month-days-8', kind: 'month-days', title: 'Месяц в движении', threshold: 8, description: '8 тренировок за календарный месяц' },
  { id: 'month-days-12', kind: 'month-days', title: 'Сильный месяц', threshold: 12, description: '12 тренировок за календарный месяц' },
  { id: 'active-months-3', kind: 'active-months', title: 'Три месяца в деле', threshold: 3, description: '3 месяца подряд по 4 тренировки в месяц' },
  { id: 'active-months-6', kind: 'active-months', title: 'Полгода в деле', threshold: 6, description: '6 месяцев подряд по 4 тренировки в месяц' },
  { id: 'comeback-rhythm', kind: 'comeback-rhythm', title: 'Вернулся в ритм', threshold: 3, description: 'После перерыва не менее 21 дня — ещё 2 тренировки в течение 14 дней' },
  { id: 'versatile', kind: 'versatile', title: 'Разносторонний спортсмен', threshold: 3, description: 'За 30 дней выполнить силовые упражнения, кардио и растяжку' },
  { id: 'strength-endurance', kind: 'strength-endurance', title: 'Сила и выносливость', threshold: 2, description: 'В течение одной календарной недели выполнить силовые упражнения и кардио' },
  { id: 'movement-balance', kind: 'movement-balance', title: 'Баланс движения', threshold: 3, description: 'В каждом из 3 последовательных календарных месяцев выполнить силовые упражнения, кардио и растяжку' },
  { id: 'cardio-choice', kind: 'cardio-choice', title: 'Кардио на выбор', threshold: 3, description: 'За 30 дней выполнить 3 вида кардио из пяти: бег, велотренажёр, эллипс, гребной тренажёр, скакалка' },
  { id: 'equipment-variety', kind: 'equipment-variety', title: 'Разный инвентарь', threshold: 3, description: 'В одном календарном месяце выполнить силовые упражнения со штангой, гантелями и на тренажёре' },
  { id: 'four-seasons', kind: 'four-seasons', title: 'Четыре сезона', threshold: 4, description: 'Потренироваться зимой, весной, летом и осенью в течение 365 дней' },
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
      : ['distance', 'run-single', 'run-total'].includes(item.kind) ? 'км'
        : ['weeks', 'weeks-total', 'rhythm', 'three-weekly', 'flexible'].includes(item.kind) ? 'недель'
          : item.kind === 'month-days' || item.kind === 'comeback-rhythm' ? 'дней'
            : item.kind === 'active-months' ? 'месяцев' : ''
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
  const activity = createAchievementActivity()
  const repeatAwards = new Map<AchievementId, { months: Set<string>; workoutIds: string[]; date: LocalDate; at: string }>()
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
    activity.add(workout, date, returnedAfterBreak)
    const activityProgress = activity.progress(date)
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
      if (item.kind === 'month-days' && (activityProgress[item.kind] ?? 0) >= item.threshold) {
        const month = date.slice(0, 7)
        const repeat = repeatAwards.get(item.id) ?? { months: new Set<string>(), workoutIds: [], date, at: workout.completedAt ?? `${date}T00:00:00` }
        if (!repeat.months.has(month)) {
          repeat.months.add(month)
          repeat.workoutIds.push(workout.id)
          repeat.date = date
          repeat.at = workout.completedAt ?? `${date}T00:00:00`
          repeatAwards.set(item.id, repeat)
        }
      }
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
        || (item.kind === 'variety' && performedExerciseKeys.size >= item.threshold)
        || (activityProgress[item.kind] !== undefined && activityProgress[item.kind]! >= item.threshold)) {
        awarded.set(item.id, { date, at: workout.completedAt ?? `${date}T00:00:00`, workoutId: workout.id })
      }
    }
  }
  const currentWeek = monday(today)
  const activeWeeks = lastWeek && daysBetween(lastWeek, currentWeek) <= 7 && daysBetween(lastWeek, currentWeek) >= 0 ? weekRun : 0
  const activityProgress = activity.progress(today)
  return definitions.map((item) => {
    const earned = awarded.get(item.id)
    const current = item.kind === 'workouts' ? completed.length : item.kind === 'weeks' ? activeWeeks
      : item.kind === 'weeks-total' ? distinctWeeks.size : item.kind === 'records' ? recordWorkouts
        : item.kind === 'plank' ? totalPlankSeconds : item.kind === 'workout-tonnage' ? bestWorkoutVolumeKg
          : item.kind === 'lifetime-tonnage' ? totalVolumeKg : item.kind === 'distance' ? totalDistanceKm
            : item.kind === 'cardio' ? totalCardioSeconds : item.kind === 'record-exercises' ? recordExerciseKeys.size
              : item.kind === 'variety' ? performedExerciseKeys.size : activityProgress[item.kind] ?? 0
    return {
      ...item,
      ...(item.kind === 'month-days' ? { currentPeriodProgress: Math.min(activityProgress['month-days'] ?? 0, item.threshold) } : {}),
      ...(repeatAwards.has(item.id) ? { earnedCount: repeatAwards.get(item.id)!.months.size,
        earnedWorkoutIds: repeatAwards.get(item.id)!.workoutIds, lastEarnedOn: repeatAwards.get(item.id)!.date,
        lastEarnedAt: repeatAwards.get(item.id)!.at } : {}),
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
    (b.lastEarnedAt ?? b.earnedAt)!.localeCompare((a.lastEarnedAt ?? a.earnedAt)!) || definitions.findIndex((item) => item.id === b.id) - definitions.findIndex((item) => item.id === a.id))[0] ?? null
}

export function newlyEarnedAchievements(items: readonly AthleteAchievement[], workoutId: string): AthleteAchievement[] {
  return items.filter((item) => (item.earnedWorkoutIds?.includes(workoutId) ?? item.sourceWorkoutId === workoutId))
}
