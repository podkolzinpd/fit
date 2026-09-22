import { describe, expect, it } from 'vitest'
import {
  generationErrorMessage,
  immediateSummaryRetryAllowed,
  trainingSummaryGenerationError,
} from './repositories/training-summary-errors'

describe('generationErrorMessage', () => {
  it('keeps source and model failures actionable instead of generic', () => {
    expect(generationErrorMessage('workouts_lookup_failed')).toContain('завершённые тренировки')
    expect(generationErrorMessage('yandex_cloud_quality_check_failed')).toContain('ещё раз')
    expect(generationErrorMessage('yandex_cloud_rate_limited')).toContain('через минуту')
    expect(generationErrorMessage('internal_error')).toContain('подготовить анализ')
  })

  it('distinguishes truncated, malformed model, and invalid upstream responses', () => {
    expect(generationErrorMessage('yandex_cloud_truncated_response')).toContain('не успел завершить')
    expect(generationErrorMessage('yandex_cloud_invalid_model_json')).toContain('неполный ответ')
    expect(generationErrorMessage('yandex_cloud_invalid_upstream_json')).toContain('через минуту')
  })

  it('explains token guards without inviting an immediate duplicate retry', () => {
    expect(generationErrorMessage('summary_generation_in_progress')).toContain('уже формируется')
    expect(generationErrorMessage('summary_generation_cooldown')).toContain('создать анализ')
    expect(generationErrorMessage('summary_generation_period_limit')).toContain('Лимит генераций анализа')
    expect(generationErrorMessage('summary_generation_daily_limit')).toContain('Лимит генераций анализа')
  })

  it('allows retry after a failed generation but not after a successful daily guard', () => {
    expect(immediateSummaryRetryAllowed(trainingSummaryGenerationError('yandex_cloud_quality_check_failed'))).toBe(true)
    expect(immediateSummaryRetryAllowed(trainingSummaryGenerationError('summary_generation_cooldown'))).toBe(true)
    expect(immediateSummaryRetryAllowed(trainingSummaryGenerationError('summary_generation_period_limit'))).toBe(false)
    expect(immediateSummaryRetryAllowed(trainingSummaryGenerationError('yandex_cloud_timeout'))).toBe(true)
    expect(immediateSummaryRetryAllowed(new Error('Сетевая ошибка'))).toBe(true)
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
