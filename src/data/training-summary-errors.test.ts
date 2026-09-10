import { describe, expect, it } from 'vitest'
import { generationErrorMessage } from './repositories/training-summary-errors'

describe('generationErrorMessage', () => {
  it('keeps source and model failures actionable instead of generic', () => {
    expect(generationErrorMessage('workouts_lookup_failed')).toContain('завершённые тренировки')
    expect(generationErrorMessage('yandex_cloud_quality_check_failed')).toContain('проверить качество')
    expect(generationErrorMessage('yandex_cloud_rate_limited')).toContain('через минуту')
    expect(generationErrorMessage('internal_error')).toContain('подготовить анализ')
  })

  it('distinguishes truncated, malformed model, and invalid upstream responses', () => {
    expect(generationErrorMessage('yandex_cloud_truncated_response')).toContain('не успел завершить')
    expect(generationErrorMessage('yandex_cloud_invalid_model_json')).toContain('неполный ответ')
    expect(generationErrorMessage('yandex_cloud_invalid_upstream_json')).toContain('через минуту')
  })

  it('does not expose infrastructure names in user-facing failures', () => {
    const messages = [
      generationErrorMessage('yandex_cloud_unavailable'),
      generationErrorMessage('yandex_cloud_access_rejected'),
      generationErrorMessage('summary_save_failed'),
    ].join(' ')

    expect(messages).not.toMatch(/Yandex|Supabase/i)
  })
})
