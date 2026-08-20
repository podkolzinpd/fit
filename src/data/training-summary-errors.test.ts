import { describe, expect, it } from 'vitest'
import { generationErrorMessage } from './repositories/training-summary-errors'

describe('generationErrorMessage', () => {
  it('keeps source and model failures actionable instead of generic', () => {
    expect(generationErrorMessage('workouts_lookup_failed')).toContain('завершённые тренировки')
    expect(generationErrorMessage('yandex_cloud_quality_check_failed')).toContain('проверку качества')
    expect(generationErrorMessage('internal_error')).toContain('Сервер не смог подготовить')
  })
})
