import { describe, expect, it } from 'vitest'
import type { ClientGoal, GoalStage } from './domain'
import { currentStage, daysToTarget, orderedStages, stageProgress, stageStatus } from './goal-rules'
import { localDate } from './local-date'

const stage = (over: { id?: string; title?: string; startsOn?: string; endsOn?: string; position?: number }): GoalStage => ({
  id: over.id ?? 's', goalId: 'g', title: over.title ?? 'Этап',
  startsOn: localDate(over.startsOn ?? '2026-01-01'), endsOn: localDate(over.endsOn ?? '2026-01-31'),
  position: over.position ?? 0, version: 1,
})

const goal = (stages: GoalStage[], targetDate: string | null = null): ClientGoal => ({
  id: 'g', clientId: 'c', title: 'Цель', targetDate: targetDate === null ? null : localDate(targetDate),
  status: 'active', version: 1, stages,
})

describe('goal-rules', () => {
  const today = localDate('2026-01-20')

  it('сортирует этапы по position, затем по дате начала', () => {
    const a = stage({ id: 'a', position: 1, startsOn: '2026-02-01' })
    const b = stage({ id: 'b', position: 0, startsOn: '2026-03-01' })
    const c = stage({ id: 'c', position: 0, startsOn: '2026-01-01' })
    expect(orderedStages(goal([a, b, c])).map((s) => s.id)).toEqual(['c', 'b', 'a'])
  })

  it('определяет статус этапа относительно сегодня', () => {
    expect(stageStatus(stage({ startsOn: '2026-01-01', endsOn: '2026-01-10' }), today)).toBe('done')
    expect(stageStatus(stage({ startsOn: '2026-01-15', endsOn: '2026-01-25' }), today)).toBe('current')
    expect(stageStatus(stage({ startsOn: '2026-02-01', endsOn: '2026-02-10' }), today)).toBe('upcoming')
  })

  it('границы этапа включительны (сегодня = начало или конец → идёт)', () => {
    expect(stageStatus(stage({ startsOn: '2026-01-20', endsOn: '2026-01-25' }), today)).toBe('current')
    expect(stageStatus(stage({ startsOn: '2026-01-10', endsOn: '2026-01-20' }), today)).toBe('current')
  })

  it('находит текущий этап', () => {
    const done = stage({ id: 'd', startsOn: '2026-01-01', endsOn: '2026-01-14', position: 0 })
    const now = stage({ id: 'n', startsOn: '2026-01-15', endsOn: '2026-01-31', position: 1 })
    expect(currentStage(goal([done, now]), today)?.id).toBe('n')
  })

  it('нет текущего этапа между периодами', () => {
    const before = stage({ startsOn: '2026-01-01', endsOn: '2026-01-10' })
    const after = stage({ startsOn: '2026-02-01', endsOn: '2026-02-10' })
    expect(currentStage(goal([before, after]), today)).toBeNull()
  })

  it('считает дни до цели', () => {
    expect(daysToTarget(goal([], '2026-01-30'), today)).toBe(10)
    expect(daysToTarget(goal([], '2026-01-20'), today)).toBe(0)
    expect(daysToTarget(goal([], '2026-01-15'), today)).toBe(-5)
    expect(daysToTarget(goal([], null), today)).toBeNull()
  })

  it('даёт прогресс «этап N из M»', () => {
    const done = stage({ id: 'd', startsOn: '2026-01-01', endsOn: '2026-01-14', position: 0 })
    const now = stage({ id: 'n', startsOn: '2026-01-15', endsOn: '2026-01-31', position: 1 })
    const next = stage({ id: 'x', startsOn: '2026-02-01', endsOn: '2026-02-28', position: 2 })
    expect(stageProgress(goal([done, now, next]), today)).toEqual({ index: 2, total: 3 })
    expect(stageProgress(goal([]), today)).toBeNull()
  })

  it('прогресс без текущего этапа = index 0', () => {
    const before = stage({ startsOn: '2026-01-01', endsOn: '2026-01-10' })
    expect(stageProgress(goal([before]), today)).toEqual({ index: 0, total: 1 })
  })
})
