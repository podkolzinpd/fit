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
export function shiftWorkoutSlot(slot: WorkoutSlotDraft, startTime: string | null): { slot: WorkoutSlotDraft; overflow: boolean } {
  const previous = slotMinutes(slot.startTime), end = slotMinutes(slot.endTime), next = slotMinutes(startTime)
  const duration = previous !== null && end !== null ? end - previous : null
  const shiftedEnd = duration !== null && duration > 0 && next !== null ? next + duration : null
  const overflow = shiftedEnd !== null && shiftedEnd >= 1440
  return { slot: { ...slot, startTime, endTime: shiftedEnd !== null && !overflow ? slotClock(shiftedEnd) : slot.endTime }, overflow }
}
export function overlappingWorkoutSlots(workout: Workout, slot: WorkoutSlotDraft, items: Workout[]): Workout[] {
  const start = slotMinutes(slot.startTime), end = slotMinutes(slot.endTime)
  if (start === null) return []
  return items.filter(other => {
    if (other.id === workout.id || other.workoutDate !== slot.workoutDate || other.status === 'cancelled'
      || other.trainingFormat === 'self' || (other.createdBy ?? other.trainerId) !== (workout.createdBy ?? workout.trainerId)) return false
    const otherStart = slotMinutes(other.startTime), otherEnd = slotMinutes(other.endTime)
    if (otherStart === null) return false
    if (end === null && otherEnd === null) return start === otherStart
    if (end === null) return start >= otherStart && start < otherEnd!
    if (otherEnd === null) return otherStart >= start && otherStart < end
    return start < otherEnd && end > otherStart
  })
}
export function slotTimeLabel(slot: Pick<WorkoutSlotDraft, 'startTime' | 'endTime'>): string {
  return slot.startTime ? `${slot.startTime.slice(0, 5)}${slot.endTime ? `–${slot.endTime.slice(0, 5)}` : ''}` : 'без времени'
}
