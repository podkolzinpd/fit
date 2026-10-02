import { describe, expect, it } from 'vitest'
import { actualWorkoutDurationSeconds } from './actual-workout-duration'
import { workoutDurationLabel } from '../../data/repositories/workout-rules'

describe('actual workout duration', () => {
  it('converts explicit minutes and accepts both decimal separators', () => {
    expect(actualWorkoutDurationSeconds('50')).toBe(3000)
    expect(actualWorkoutDurationSeconds('50.5')).toBe(3030)
    expect(actualWorkoutDurationSeconds('50,5')).toBe(3030)
    expect(actualWorkoutDurationSeconds('')).toBeNull()
  })
  it.each(['0', '-2', '721', 'abc', '1e3'])('rejects invalid duration %s', (input) => {
    expect(() => actualWorkoutDurationSeconds(input)).toThrow('Укажите длительность')
  })
  it('prefers the entered fact to a short recording timer without changing audit timestamps', () => {
    expect(workoutDurationLabel(null, null, 3000)).toBe('50 мин')
    expect(workoutDurationLabel('2026-10-02T10:00:00Z', '2026-10-02T10:02:00Z', 3000)).toBe('50 мин')
    expect(workoutDurationLabel('2026-10-02T10:00:00Z', '2026-10-02T10:02:00Z', null)).toBe('2 мин')
    expect(workoutDurationLabel(null, null)).toBeNull()
  })
})
