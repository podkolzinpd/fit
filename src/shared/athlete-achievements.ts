import type { Workout } from './domain'
import { addDays, daysBetween, todayInTimeZone, weekdayIndex, type LocalDate } from './local-date'

export type AchievementId = 'workouts-1' | 'workouts-10' | 'workouts-25' | 'workouts-50' | 'workouts-100' | 'weeks-4' | 'weeks-8' | 'weeks-12'
export type AchievementKind = 'workouts' | 'weeks'

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
  { id: 'workouts-10', kind: 'workouts', title: 'В ритме', threshold: 10, description: 'Завершить 10 тренировок' },
  { id: 'workouts-25', kind: 'workouts', title: 'Крепкая привычка', threshold: 25, description: 'Завершить 25 тренировок' },
  { id: 'workouts-50', kind: 'workouts', title: 'Полсотни', threshold: 50, description: 'Завершить 50 тренировок' },
  { id: 'workouts-100', kind: 'workouts', title: 'Сотня', threshold: 100, description: 'Завершить 100 тренировок' },
  { id: 'weeks-4', kind: 'weeks', title: 'Четыре недели', threshold: 4, description: 'Завершить тренировку 4 недели подряд' },
  { id: 'weeks-8', kind: 'weeks', title: 'Восемь недель', threshold: 8, description: 'Завершить тренировку 8 недель подряд' },
  { id: 'weeks-12', kind: 'weeks', title: 'Двенадцать недель', threshold: 12, description: 'Завершить тренировку 12 недель подряд' },
]

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
  const awarded = new Map<AchievementId, { date: LocalDate; at: string; workoutId: string }>()
  let weekRun = 0
  let lastWeek: LocalDate | null = null
  for (const [index, workout] of completed.entries()) {
    const date = completedDate(workout, timeZone)
    const week = monday(date)
    if (lastWeek !== week) {
      weekRun = lastWeek && daysBetween(lastWeek, week) === 7 ? weekRun + 1 : 1
      lastWeek = week
    }
    for (const item of definitions) {
      if (awarded.has(item.id)) continue
      if ((item.kind === 'workouts' && index + 1 >= item.threshold)
        || (item.kind === 'weeks' && weekRun >= item.threshold)) {
        awarded.set(item.id, { date, at: workout.completedAt ?? `${date}T00:00:00`, workoutId: workout.id })
      }
    }
  }
  const currentWeek = monday(today)
  const activeWeeks = lastWeek && daysBetween(lastWeek, currentWeek) <= 7 && daysBetween(lastWeek, currentWeek) >= 0 ? weekRun : 0
  return definitions.map((item) => {
    const earned = awarded.get(item.id)
    const current = item.kind === 'workouts' ? completed.length : activeWeeks
    return {
      ...item,
      earnedOn: earned?.date ?? null,
      earnedAt: earned?.at ?? null,
      sourceWorkoutId: earned?.workoutId ?? null,
      progress: earned ? item.threshold : Math.min(current, item.threshold),
      nearest: !earned && !definitions.some((other) => other.kind === item.kind && other.threshold < item.threshold && !awarded.has(other.id)),
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
