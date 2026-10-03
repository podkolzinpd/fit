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
