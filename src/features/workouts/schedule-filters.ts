import type { Workout } from '../../shared/domain'

export const SCHEDULE_STATUSES = [
  ['all', 'Все статусы'], ['planned', 'Запланированные'], ['in_progress', 'Идут сейчас'],
  ['done', 'Проведённые'], ['cancelled', 'Отменённые'],
] as const
export type ScheduleStatusFilter = typeof SCHEDULE_STATUSES[number][0]
export function scheduleStatusFilter(value: string | null): ScheduleStatusFilter {
  return SCHEDULE_STATUSES.find(([key]) => key === value)?.[0] ?? 'all'
}
export function filterScheduleWorkouts(items: Workout[], clientId: string, status: ScheduleStatusFilter): Workout[] {
  return items.filter((item) => (!clientId || item.clientId === clientId) && (status === 'all' || item.status === status))
}

export function isIndependentScheduleWorkout(workout: Workout): boolean {
  // Same legacy fallback as the workout read model. Never infer format from execution actors.
  return (workout.trainingFormat ?? 'self') === 'self'
}

export function trainerScheduleWorkouts(items: Workout[], trainerId: string | undefined, showIndependent: boolean): Workout[] {
  if (!trainerId) return []
  return items.filter((item) => {
    // Legacy ownership is valid only for this trainer's partition, not every missing author.
    const own = item.createdBy ? item.createdBy === trainerId : item.trainerId === trainerId
    return own && (showIndependent || !isIndependentScheduleWorkout(item))
  })
}
