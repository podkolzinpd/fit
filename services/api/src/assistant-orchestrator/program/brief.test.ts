import { describe, expect, it } from 'vitest'
import { mergeExtractedBrief, briefSummary, readProgramBrief } from './brief.js'

describe('quiz updates', () => {
  it('preserves unrelated answers and invalidates old weekdays when frequency changes', () => {
    const result = mergeExtractedBrief({ frequency: 3, weekdays: [1, 3, 5], durationMin: 60, goalText: 'Сила' }, 'Теперь два занятия', {
      patch: { frequency: 2 }, clear: [], evidence: { frequency: 'два занятия' }, clarification: null,
    })
    expect(result.brief).toEqual({ frequency: 2, durationMin: 60, goalText: 'Сила' })
  })
  it('rejects invented answers without a quote from the latest message', () => {
    expect(() => mergeExtractedBrief({}, 'Сила', { patch: { limitations: 'none' }, clear: [], evidence: { limitations: 'нет боли' }, clarification: null })).toThrow('brief_evidence_missing')
  })
  it.each([0, 4, '3', null])('rejects unsupported frequency %s', (frequency) => {
    expect(readProgramBrief({ frequency })).toBeUndefined()
  })
  it('shows equipment and adulthood before confirmation', () => {
    expect(briefSummary({ equipment: ['dumbbells'], adult: true })).toContain('гантели')
    expect(briefSummary({ equipment: [], adult: false })).toContain('Совершеннолетний: нет')
  })
})
