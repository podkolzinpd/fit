import { describe, expect, it } from 'vitest'
import { defaultWorkoutTrainingFormat, workoutTrainingFormatLabel } from './workout-training-format'

describe('workout training format', () => {
  it('uses the authors role instead of financial service eligibility', () => {
    expect(defaultWorkoutTrainingFormat('trainer')).toBe('with_trainer')
    expect(defaultWorkoutTrainingFormat('client')).toBe('self')
  })
  it('uses short user-facing labels', () => {
    expect(workoutTrainingFormatLabel('self')).toBe('Самостоятельно')
    expect(workoutTrainingFormatLabel('with_trainer')).toBe('С тренером')
  })
})
