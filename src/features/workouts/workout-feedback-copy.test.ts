import { describe, expect, it } from 'vitest'
import { workoutFeedbackConfirmation } from './workout-feedback-copy'

describe('workoutFeedbackConfirmation', () => {
  it('confirms the saved workout result without naming a recipient', () => {
    expect(workoutFeedbackConfirmation()).toBe('Итоги тренировки сохранены.')
  })
})
