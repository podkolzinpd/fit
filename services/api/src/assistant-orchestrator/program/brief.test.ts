import { describe, expect, it } from 'vitest'
import { decodeQuotedBriefPatch, mergeExtractedBrief, briefSummary, readProgramBrief, missingBriefFields } from './brief.js'

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
  it.each(['Три занятия в неделю', '2 или 3 тренировки', 'Два–три раза в неделю', 'Не два раза'])('rejects a misleading frequency quote: %s', (message) => {
    expect(() => mergeExtractedBrief({}, message, { patch: { frequency: 2 }, clear: [], evidence: { frequency: message }, clarification: null })).toThrow('brief_frequency_ambiguous')
  })
  it.each(['Не три, а два занятия в неделю', 'Две тренировки', '2'])('accepts an unambiguous frequency or correction: %s', (message) => {
    expect(mergeExtractedBrief({}, message, { patch: { frequency: 2 }, clear: [], evidence: { frequency: message }, clarification: null }).brief.frequency).toBe(2)
  })
  it('requires details of other activity and invalidates them on a new description', () => {
    expect(missingBriefFields({ otherActivity: 'Бегаю' })).toContain('otherActivities')
    expect(missingBriefFields({ otherActivity: 'Нет' })).not.toContain('otherActivities')
    const result = mergeExtractedBrief({ otherActivity: 'бег', otherActivities: [{ kind: 'бег', frequency: 2, weekdays: [2, 4] }], activityOverlapConfirmed: true }, 'Теперь футбол', {
      patch: { otherActivity: 'футбол' }, clear: [], evidence: { otherActivity: 'футбол' }, clarification: null,
    })
    expect(result.brief.otherActivities).toBeUndefined()
    expect(result.brief.activityOverlapConfirmed).toBeUndefined()
  })
  it('does not accept an overlap acknowledgement invented by the model', () => {
    expect(() => mergeExtractedBrief({}, 'Бег в понедельник', { patch: { activityOverlapConfirmed: true }, clear: [], evidence: { activityOverlapConfirmed: 'Бег' }, clarification: null })).toThrow('brief_activity_confirmation_missing')
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

it('decodes activity details and history confirmation in quoted changes', () => {
  const message = 'Бегаю по вторникам и субботам; записана только часть тренировок'
  const decoded = decodeQuotedBriefPatch({ changes: [
    { field: 'otherActivities', operation: 'set', value: JSON.stringify([{ kind: 'бег', frequency: 2, weekdays: [2, 6] }]), quote: 'Бегаю по вторникам и субботам' },
    { field: 'historyComplete', operation: 'set', value: 'false', quote: 'записана только часть тренировок' },
  ], clarification: null })
  expect(mergeExtractedBrief({}, message, decoded).brief).toEqual({ otherActivities: [{ kind: 'бег', frequency: 2, weekdays: [2, 6] }], historyComplete: false })
})

it('asks what to continue only when history exists and preserves an explicit answer', () => {
  expect(missingBriefFields({}, false)).not.toContain('continuationPlan')
  expect(missingBriefFields({}, true)).toContain('continuationPlan')
  const result = mergeExtractedBrief({}, 'Продолжаем прежний подход, оставь жим лёжа', { patch: { continuationPlan: 'Продолжаем прежний подход', preserveRefs: ['bench-press'] }, clear: [], evidence: { continuationPlan: 'Продолжаем прежний подход', preserveRefs: 'оставь жим лёжа' }, clarification: null })
  expect(missingBriefFields(result.brief, true)).not.toContain('continuationPlan')
  expect(result.brief.preserveRefs).toEqual(['bench-press'])
})

it('retains years of experience and break duration alongside the returning category', () => {
  const message = 'Опыт пять лет, перерыв два месяца'
  const { brief } = mergeExtractedBrief({}, message, { patch: { experience: 'returning', experienceText: message }, clear: [],
    evidence: { experience: message, experienceText: message }, clarification: null })
  expect(brief).toEqual({ experience: 'returning', experienceText: message })
  expect(briefSummary(brief)).toContain(message)
})
it('does not invent experience details or retain them after a corrected category', () => {
  expect(() => mergeExtractedBrief({}, 'Был перерыв', { patch: { experienceText: 'Перерыв два месяца' }, clear: [], evidence: { experienceText: 'Был перерыв' }, clarification: null })).toThrow('brief_evidence_missing')
  expect(mergeExtractedBrief({ experience: 'returning', experienceText: 'Перерыв два месяца' }, 'Я новичок', { patch: { experience: 'beginner' }, clear: [], evidence: { experience: 'Я новичок' }, clarification: null }).brief).toEqual({ experience: 'beginner' })
})
