import { describe, expect, it } from 'vitest'
import { parseAssistantInlineSummary } from './assistant-inline-summary'

const valid = {
  status: 'applied', summaryId: 'summary-1', clientId: 'client-1', clientName: 'Сан Саныч',
  periodStart: '2026-08-01', periodEnd: '2026-08-25', periodLabel: 'Последний месяц',
  trainer: { headline: 'Темп стал стабильнее', progress: ['Жим растёт'], consistency: 'Две тренировки в неделю', attention: ['Следить за плечом'] },
  metrics: { completedWorkouts: 6, workoutsPerWeek: 1.5, activeWeeks: 4 },
}

describe('assistant inline summary parser', () => {
  it('parses the durable chat snapshot', () => {
    expect(parseAssistantInlineSummary(valid)).toEqual({
      summaryId: valid.summaryId,
      clientId: valid.clientId,
      clientName: valid.clientName,
      periodStart: valid.periodStart,
      periodEnd: valid.periodEnd,
      periodLabel: valid.periodLabel,
      trainer: valid.trainer,
      metrics: valid.metrics,
    })
  })

  it.each([
    null,
    { ...valid, trainer: { ...valid.trainer, progress: ['ok', 1] } },
    { ...valid, metrics: { ...valid.metrics, activeWeeks: '4' } },
    { ...valid, periodLabel: '' },
  ])('rejects malformed snapshot %j', (value) => {
    expect(parseAssistantInlineSummary(value)).toBeUndefined()
  })
})
