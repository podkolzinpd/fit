import type { Workout } from '../../shared/domain'
import { addDays, weekdayIndex, type LocalDate } from '../../shared/local-date'
import { workoutStatusPresentation } from '../../data/repositories/workout-rules'

export type ScheduleEventTone = 'planned' | 'current' | 'done' | 'partial' | 'skipped' | 'decision'

export interface ScheduleEventStatus {
  label: string
  tone: ScheduleEventTone
}

export function mondayWeekStart(value: LocalDate): LocalDate {
  const weekday = weekdayIndex(value)
  return addDays(value, weekday === 0 ? -6 : 1 - weekday)
}

export function formatScheduleDateLabel(value: LocalDate, locale = 'ru-RU'): string {
  const [year, month, day] = value.split('-').map(Number)
  const label = new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long' })
    .format(new Date(year ?? 0, (month ?? 1) - 1, day))
  return `${label.charAt(0).toUpperCase()}${label.slice(1)}`
}

export function scheduleEventStatus(workout: Workout, today: LocalDate): ScheduleEventStatus {
  const status = workoutStatusPresentation(workout, today)
  if (status.tone === 'cancelled') return { label: 'Пропущена', tone: 'skipped' }
  if (status.tone === 'in_progress') return { label: status.label, tone: 'current' }
  return { label: status.label, tone: status.tone }
}

export function scheduleExerciseLine(names: readonly string[]): string {
  if (names.length === 0) return 'Без упражнений'
  const visible = names.slice(0, 2).join(', ')
  const remaining = names.length - 2
  return remaining > 0 ? `${visible} · ещё ${remaining}` : visible
}

function minutesOfTime(time: string): number {
  const [hours, minutes] = time.slice(0, 5).split(':').map(Number)
  return (hours ?? 0) * 60 + (minutes ?? 0)
}

export function scheduleFocusMinutes(workouts: readonly Workout[], currentTime: string): number {
  const currentMinutes = minutesOfTime(currentTime)
  const timed = workouts
    .filter((workout) => workout.startTime)
    .slice()
    .sort((left, right) => minutesOfTime(left.startTime!) - minutesOfTime(right.startTime!))

  if (timed.length === 0) return currentMinutes
  const nearest = timed.find((workout) => {
    const start = minutesOfTime(workout.startTime!)
    const end = workout.endTime ? minutesOfTime(workout.endTime) : start + 60
    return end >= currentMinutes
  })
  return minutesOfTime((nearest ?? timed[0]!).startTime!)
}
