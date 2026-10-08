import { describe, expect, it } from 'vitest'
import { localDate } from '../../shared/local-date'
import { trainerHomeContext } from '../../features/workouts/trainer-home-context'
import { workoutHomeSummaries } from './workout-home'

type Root = Parameters<typeof workoutHomeSummaries>[0][number]
function root(id: string, status: Root['status'], date: string, clientId = 'client', time: string | null = null): Root {
  return { id, clientId, clientName: clientId, status, workoutDate: localDate(date), startTime: time, exercises: [] }
}
const today = localDate('2026-10-08')

describe('compact home representatives', () => {
  it('keeps all active and today plans but not every old or distant history root', () => {
    const history = Array.from({ length: 121 }, (_, index) => root(`old-${index}`, 'done', '2026-01-01'))
    const rows = [...history, root('live-1', 'in_progress', '2025-01-01'), root('live-2', 'in_progress', '2025-01-01', 'other'),
      root('past', 'planned', '2026-10-07'), root('past-old', 'planned', '2026-10-01'),
      root('today-1', 'planned', '2026-10-08'), root('today-2', 'planned', '2026-10-08'),
      root('future', 'planned', '2026-10-09'), root('cancelled', 'cancelled', '2027-01-01')]
    const home = workoutHomeSummaries(rows, today)
    expect(home.map((item) => item.id)).toEqual(expect.arrayContaining(['live-1', 'live-2', 'past', 'today-1', 'today-2', 'cancelled']))
    expect(home.some((item) => item.id === 'past-old' || item.id === 'future')).toBe(false)
    expect(home.length).toBeLessThan(10)
    expect(home.every((item) => !('exercises' in item) && !('sets' in item))).toBe(true)
    expect(rows).toHaveLength(129)
  })

  it('preserves the canonical home choice for active, nearest future and latest done', () => {
    const rows = [root('a', 'done', '2026-09-01'), root('b', 'done', '2026-09-01'),
      root('c', 'done', '2026-09-01', 'client', '10:00'), root('x', 'cancelled', '2026-10-08')]
    for (const input of [rows, [...rows, root('plan', 'planned', '2026-10-09')],
      [...rows, root('plan', 'planned', '2026-10-09'), root('live', 'in_progress', '2025-01-01')]]) {
      const full = trainerHomeContext(input, today)
      const compact = trainerHomeContext(workoutHomeSummaries(input, today), today)
      expect(compact?.title).toBe(full?.title)
      expect(compact?.workout.id).toBe(full?.workout.id)
    }
  })

  it('distinguishes empty history from a client with only cancelled history', () => {
    expect(workoutHomeSummaries([], today)).toEqual([])
    expect(workoutHomeSummaries([root('cancelled', 'cancelled', '2026-01-01')], today)).toMatchObject([{ id: 'cancelled', exerciseCount: 0, exerciseNames: [] }])
  })
})
