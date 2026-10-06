import { describe, expect, it } from 'vitest'
import { actualWorkoutDurationSeconds, workoutDurationMinutes } from './actual-workout-duration'
import { workoutDurationLabel } from '../../data/repositories/workout-rules'

describe('actual workout duration', () => {
  it('converts explicit minutes and accepts both decimal separators', () => {
    expect(actualWorkoutDurationSeconds('50')).toBe(3000)
    expect(actualWorkoutDurationSeconds('50.5')).toBe(3030)
    expect(actualWorkoutDurationSeconds('50,5')).toBe(3030)
    expect(actualWorkoutDurationSeconds(' 50,5 ')).toBe(3030)
    expect(actualWorkoutDurationSeconds('')).toBeNull()
  })
  it('prefills manual, overnight Live and unknown durations without the recording clock', () => {
    const live = { startedAt: '2026-10-02T23:30:00Z', completedAt: '2026-10-03T00:30:00Z' }
    expect(workoutDurationMinutes(live)).toBe('60')
    expect(workoutDurationMinutes({ ...live, actualDurationSec: 3030 })).toBe('50.5')
    expect(workoutDurationMinutes({ startedAt: null, completedAt: live.completedAt })).toBe('')
    expect(workoutDurationMinutes({ ...live, completedAt: live.startedAt })).toBe('')
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
