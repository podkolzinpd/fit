import { describe, expect, it } from 'vitest'
import { workoutFeedbackConfirmation } from './workout-feedback-copy'

describe('workoutFeedbackConfirmation', () => {
  it('promises trainer visibility only for an active trainer connection', () => {
    expect(workoutFeedbackConfirmation(true)).toBe('✓ Спасибо, тренер увидит ваш отзыв.')
  })

  it('confirms the saved wellbeing data for a standalone client', () => {
    expect(workoutFeedbackConfirmation(false)).toBe('✓ Спасибо, данные о самочувствии сохранены.')
  })
})
