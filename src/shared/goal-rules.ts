import type { ClientGoal, GoalStage } from './domain'
import { daysBetween, type LocalDate } from './local-date'

export type StageStatus = 'done' | 'current' | 'upcoming'

// Этапы по порядку: position, затем дата начала.
export function orderedStages(goal: ClientGoal): GoalStage[] {
  return [...goal.stages].sort((a, b) =>
    a.position - b.position || (a.startsOn < b.startsOn ? -1 : a.startsOn > b.startsOn ? 1 : 0))
}

// Статус этапа относительно сегодня: завершён / идёт / впереди.
export function stageStatus(stage: GoalStage, today: LocalDate): StageStatus {
  if (today > stage.endsOn) return 'done'
  if (today < stage.startsOn) return 'upcoming'
  return 'current'
}

// Текущий этап = где starts_on ≤ сегодня ≤ ends_on (первый подходящий по порядку).
export function currentStage(goal: ClientGoal, today: LocalDate): GoalStage | null {
  return orderedStages(goal).find((stage) => stageStatus(stage, today) === 'current') ?? null
}

// Дней до цели (target_date - сегодня). null — если даты нет; 0 — если срок сегодня;
// отрицательное — если срок прошёл.
export function daysToTarget(goal: ClientGoal, today: LocalDate): number | null {
  return goal.targetDate === null ? null : daysBetween(today, goal.targetDate)
}

// Индекс текущего этапа (1-based) и всего этапов — для «этап 2 из 3».
export function stageProgress(goal: ClientGoal, today: LocalDate): { index: number; total: number } | null {
  const stages = orderedStages(goal)
  if (stages.length === 0) return null
  const current = currentStage(goal, today)
  if (!current) return { index: 0, total: stages.length }
  return { index: stages.findIndex((stage) => stage.id === current.id) + 1, total: stages.length }
}
