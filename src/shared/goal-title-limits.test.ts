import { describe, expect, it } from 'vitest'
import { GOAL_STAGE_TITLE_MAX_LENGTH, GOAL_TITLE_MAX_LENGTH, titleLengthValidation } from './goal-title-limits'

describe('goal title limits', () => {
  it.each([
    ['Цель', GOAL_TITLE_MAX_LENGTH],
    ['Название этапа', GOAL_STAGE_TITLE_MAX_LENGTH],
  ])('accepts %s at the database limit and explains overflow', (label, limit) => {
    expect(titleLengthValidation('а'.repeat(limit), label, limit)).toBe(true)
    expect(titleLengthValidation('а'.repeat(limit + 1), label, limit)).toBe(`${label} — не более ${limit} символов`)
  })
})
