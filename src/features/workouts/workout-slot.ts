import { daysBetween } from '../../shared/local-date'
import type { Workout, WorkoutSlotDraft } from '../../shared/domain'

export function slotMinutes(value: string | null): number | null {
  if (!value || !/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(value)) return null
  return Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5))
}
export function slotClock(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}
export function workoutSlot(workout: Workout): WorkoutSlotDraft {
  return { workoutDate: workout.workoutDate, startTime: workout.startTime?.slice(0, 5) ?? null, endTime: workout.endTime?.slice(0, 5) ?? null }
}
export function slotDurationMinutes(startTime: string | null, endTime: string | null): number | null {
  const start = slotMinutes(startTime), end = slotMinutes(endTime)
  return start === null || end === null ? null : (end - start + 1440) % 1440
}
export function shiftWorkoutSlot(slot: WorkoutSlotDraft, startTime: string | null): WorkoutSlotDraft {
  const duration = slotDurationMinutes(slot.startTime, slot.endTime), next = slotMinutes(startTime)
  return { ...slot, startTime, endTime: duration !== null && duration > 0 && next !== null
    ? slotClock((next + duration) % 1440) : slot.endTime }
}
export function overlappingWorkoutSlots(workout: Workout, slot: WorkoutSlotDraft, items: Workout[]): Workout[] {
  const start = slotMinutes(slot.startTime), duration = slotDurationMinutes(slot.startTime, slot.endTime)
  if (start === null) return []
  return items.filter(other => {
    if (other.id === workout.id || other.status === 'cancelled'
      || other.trainingFormat === 'self' || (other.createdBy ?? other.trainerId) !== (workout.createdBy ?? workout.trainerId)) return false
    const clock = slotMinutes(other.startTime)
    if (clock === null) return false
    const otherStart = clock + daysBetween(slot.workoutDate, other.workoutDate) * 1440
    const otherDuration = slotDurationMinutes(other.startTime, other.endTime)
    if (duration === null && otherDuration === null) return start === otherStart
    if (duration === null) return start >= otherStart && start < otherStart + otherDuration!
    if (otherDuration === null) return otherStart >= start && otherStart < start + duration
    return start < otherStart + otherDuration && start + duration > otherStart
  })
}
export function slotTimeLabel(slot: Pick<WorkoutSlotDraft, 'startTime' | 'endTime'>): string {
  return slot.startTime ? `${slot.startTime.slice(0, 5)}${slot.endTime ? `–${slot.endTime.slice(0, 5)}` : ''}` : 'без времени'
}
