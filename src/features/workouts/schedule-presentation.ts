import type { Workout } from '../../shared/domain'
import { addDays, weekdayIndex, type LocalDate } from '../../shared/local-date'
import { workoutStatusPresentation } from '../../data/repositories/workout-rules'

export type ScheduleEventTone = 'planned' | 'current' | 'done' | 'partial' | 'skipped' | 'decision' | 'self-led'

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

export function compactScheduleTime(value?: string | null): string {
  if (!value) return '—'
  const [hours = '', minutes = ''] = value.slice(0, 5).split(':')
  const numericHours = Number(hours)
  if (!Number.isInteger(numericHours) || minutes.length !== 2) return value.slice(0, 5)
  return minutes === '00' ? String(numericHours) : `${numericHours}:${minutes}`
}

export function compactScheduleClientName(value: string): string {
  const firstName = value.trim().split(/\s+/)[0] ?? ''
  return firstName.length <= 2 ? firstName : firstName.slice(0, 2)
}

export function compactScheduleEventLabel(time: string | null | undefined, clientName: string): string {
  const shortTime = compactScheduleTime(time)
  const shortName = compactScheduleClientName(clientName)
  const visibleName = shortTime.includes(':') ? shortName.slice(0, 1) : shortName
  return `${shortTime}\u2009${visibleName}`
}

export function scheduleEventStatus(workout: Workout, today: LocalDate): ScheduleEventStatus {
  const status = workoutStatusPresentation(workout, today)
  const assignmentAuthor = workout.createdBy ?? workout.trainerId
  const selfLed = Boolean(
    assignmentAuthor
    && workout.startedBy
    && workout.completedBy
    && workout.startedBy === workout.completedBy
    && workout.startedBy !== assignmentAuthor,
  )
  if (selfLed && status.tone === 'done') return { label: 'Самостоятельно', tone: 'self-led' }
  if (selfLed && status.tone === 'partial') return { label: 'Самостоятельно · частично', tone: 'partial' }
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
