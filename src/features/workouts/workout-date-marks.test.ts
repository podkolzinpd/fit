import { expect, it } from 'vitest'
import { localDate } from '../../shared/local-date'
import type { Workout } from '../../shared/domain'
import { workoutDateMarks } from './workout-date-marks'
const date = localDate('2026-11-02')
const item = (id: string, status: Workout['status'], clientId = 'athlete') => ({ id, status, clientId, workoutDate: date })
it('shows one planned dot regardless of order/count, including an ongoing workout', () => {
  for (const items of [[item('a', 'done'), item('b', 'planned')], [item('b', 'planned'), item('a', 'done')], [item('a', 'in_progress')]]) {
    expect(workoutDateMarks(items, 'athlete')).toEqual({ [date]: 'planned' })
  }
})
it('excludes only the edited workout, cancelled attendance and other athletes', () => {
  const items = [item('editing', 'planned'), item('other', 'planned', 'another'), item('cancelled', 'cancelled'), item('completed', 'done')]
  expect(workoutDateMarks(items, 'athlete', 'editing')).toEqual({ [date]: 'done' })
  expect(workoutDateMarks(items.slice(0, 3), 'athlete', 'editing')).toEqual({})
  expect(workoutDateMarks(items, 'another', 'editing')).toEqual({ [date]: 'planned' })
})
