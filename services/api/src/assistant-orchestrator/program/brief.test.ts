import { describe, expect, it } from 'vitest'
import { decodeQuotedBriefPatch, mergeExtractedBrief, briefSummary, readProgramBrief } from './brief.js'

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

it('keeps quotes adjacent to normalized values in the model contract', () => {
  const decoded = decodeQuotedBriefPatch({ changes: [{ field: 'weekdays', operation: 'set', value: '1,4', quote: 'понедельник и четверг' }], clarification: null })
  expect(mergeExtractedBrief({}, 'понедельник и четверг', decoded).brief.weekdays).toEqual([1, 4])
})

it('accepts unchanged confirmed values without requesting old evidence again', () => {
  const result = mergeExtractedBrief({ goal: 'strength', frequency: 2 }, 'Теперь три занятия', {
    patch: { goal: 'strength', frequency: 3 }, clear: [], evidence: { goal: 'старая цитата', frequency: 'три занятия' }, clarification: null,
  })
  expect(result.brief).toEqual({ goal: 'strength', frequency: 3 })
})
