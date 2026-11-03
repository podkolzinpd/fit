import { beforeEach, describe, expect, it, vi } from 'vitest'
import { localDate } from '../../shared/local-date'
import { templateAssignmentDraftKey, templateAssignmentDraftChoices, hasWorkoutFormContent, quickPlanDraftChoices, retainQuickPlanDraft, readWorkoutEditDraft, readWorkoutFormDraft, removeWorkoutFormDraft, workoutFormDraftKey, writeWorkoutFormDraft, type WorkoutFormDraft } from './workout-form-draft'

describe('workout form draft storage', () => {
  const key = workoutFormDraftKey('trainer', 'workout-1')
  const draft: WorkoutFormDraft = {
    clientId: 'client-1', workoutDate: localDate('2026-08-04'), startTime: '09:00', endTime: '', notes: 'заметка', stageId: '', recordCompleted: false, exercises: [],
  }

  beforeEach(() => {
    const values = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      get length() { return values.size },
      key: (index: number) => Array.from(values.keys())[index] ?? null,
      getItem: (itemKey: string) => values.get(itemKey) ?? null,
      setItem: (itemKey: string, value: string) => values.set(itemKey, value),
      removeItem: (itemKey: string) => values.delete(itemKey),
    })
  })

  it('isolates template assignments while retaining legacy and previous contexts', () => {
    const legacy = workoutFormDraftKey('trainer', 'template-one')
    const oldKey = templateAssignmentDraftKey('trainer', 'one', 'client-1', draft.workoutDate)
    const nextKey = templateAssignmentDraftKey('trainer', 'one', 'client-2', localDate('2026-08-11'))
    writeWorkoutFormDraft(legacy, { ...draft, requestId: 'legacy' })
    writeWorkoutFormDraft(oldKey, { ...draft, requestId: 'previous' })
    writeWorkoutFormDraft(nextKey, { ...draft, clientId: 'client-2', requestId: 'current', workoutDate: localDate('2026-08-11') })
    expect(new Set([oldKey, nextKey, templateAssignmentDraftKey('trainer', 'one', 'client-2', localDate('2026-08-11'), true)]).size).toBe(3)
    expect(templateAssignmentDraftChoices('trainer', 'one').map(choice => choice.draft.requestId)).toEqual(['legacy', 'previous', 'current'])
    expect(templateAssignmentDraftChoices('another-user', 'one')).toEqual([])
    expect(templateAssignmentDraftChoices('trainer', 'another-template')).toEqual([])
    expect(retainQuickPlanDraft(nextKey, draft.workoutDate)).toBe(true)
    writeWorkoutFormDraft(nextKey, { ...draft, requestId: 'fresh' })
    expect(templateAssignmentDraftChoices('trainer', 'one').map(choice => choice.draft.requestId)).toContain('current')
    expect(readWorkoutFormDraft(legacy)?.requestId).toBe('legacy')
  })

  it('preserves scoped raw text, explicit clearing, and backwards-compatible invalid previews', () => {
    const snapshot = { text: 'Планка 40 секунд', parsedText: '', entries: [], choices: {} }
    writeWorkoutFormDraft(key, { ...draft, requestId: 'one', composerText: snapshot.text, composerSnapshot: snapshot })
    expect(readWorkoutFormDraft(key)?.composerSnapshot).toEqual(snapshot)
    writeWorkoutFormDraft(key, { ...draft, requestId: 'one' })
    expect(readWorkoutFormDraft(key)?.composerSnapshot).toEqual(snapshot)
    writeWorkoutFormDraft(key, { ...draft, requestId: 'one', composerText: '', composerSnapshot: undefined })
    expect(readWorkoutFormDraft(key)?.composerText).toBe('')
    expect(readWorkoutFormDraft(key)?.composerSnapshot).toBeUndefined()
    localStorage.setItem(key, JSON.stringify({ ...draft, composerText: 'Не терять', composerSnapshot: { text: 'Другой текст', entries: 'bad' } }))
    expect(readWorkoutFormDraft(key)).toMatchObject({ clientId: draft.clientId, composerText: 'Не терять' })
    expect(readWorkoutFormDraft(key)?.composerSnapshot).toBeUndefined()
    writeWorkoutFormDraft(key, { ...draft, requestId: 'old', sourceVersion: 1, composerText: 'Другой план' })
    writeWorkoutFormDraft(key, { ...draft, requestId: 'new', sourceVersion: 2 })
    expect(readWorkoutFormDraft(key)?.composerText).toBeUndefined()
  })

  it('round-trips a draft per source workout', () => {
    writeWorkoutFormDraft(key, draft)
    expect(readWorkoutFormDraft(key)).toEqual(draft)
    expect(readWorkoutFormDraft(workoutFormDraftKey('trainer', 'other'))).toBeNull()
  })

  it('restores an edit only for its exact version, never from an unfinished copy or another account', () => {
    const editKey = workoutFormDraftKey('trainer', 'edit-workout-1')
    writeWorkoutFormDraft(key, draft)
    expect(readWorkoutEditDraft(editKey, 4)).toBeNull()
    writeWorkoutFormDraft(editKey, { ...draft, sourceVersion: 4 })
    expect(readWorkoutEditDraft(editKey, 4)?.sourceVersion).toBe(4)
    expect(readWorkoutEditDraft(editKey, 5)).toBeNull()
    expect(readWorkoutEditDraft(editKey, undefined)).toBeNull()
    expect(readWorkoutEditDraft(workoutFormDraftKey('other', 'edit-workout-1'), 4)).toBeNull()
    expect(readWorkoutEditDraft(key, 4)).toBeNull()
  })

  it('removes a saved draft', () => {
    writeWorkoutFormDraft(key, draft)
    removeWorkoutFormDraft(key)
    expect(readWorkoutFormDraft(key)).toBeNull()
  })

  it('preserves the quick-plan name and retry identity through editor handoff', () => {
    const named = { ...draft, title: 'Всё тело', requestId: '10000000-0000-4000-8000-000000000001' }
    writeWorkoutFormDraft(key, named)
    expect(readWorkoutFormDraft(key)).toEqual(named)
  })

  it('ignores an untouched quick form, but retains every previous meaningful draft', () => {
    const date = localDate('2026-08-04')
    expect(hasWorkoutFormContent({ ...draft, clientId: '', notes: '', startTime: '' }, date)).toBe(false)
    writeWorkoutFormDraft(key, { ...draft, requestId: 'one' })
    expect(retainQuickPlanDraft(key, date)).toBe(true)
    writeWorkoutFormDraft(key, { ...draft, requestId: 'two', title: 'Новый план' })
    expect(quickPlanDraftChoices(key, date).map((choice) => choice.draft.requestId)).toEqual(['two', 'one'])
    expect(quickPlanDraftChoices(workoutFormDraftKey('another-user'), date)).toEqual([])
  })

  it('refuses to replace a meaningful draft when storage cannot retain it', () => {
    writeWorkoutFormDraft(key, draft)
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('quota') })
    expect(retainQuickPlanDraft(key, draft.workoutDate)).toBe(false)
    expect(readWorkoutFormDraft(key)).toEqual(draft)
  })

  it('retains unparsed text even before a client or exercise is selected', () => {
    const pending = { ...draft, requestId: 'voice-plan', clientId: '', notes: '', startTime: '', composerText: 'Планка три раза' }
    expect(hasWorkoutFormContent(pending, draft.workoutDate)).toBe(true)
    writeWorkoutFormDraft(key, pending)
    writeWorkoutFormDraft(key, { ...pending, composerText: undefined })
    expect(readWorkoutFormDraft(key)?.composerText).toBe('Планка три раза')
    writeWorkoutFormDraft(key, { ...pending, requestId: 'another-plan', composerText: undefined })
    expect(readWorkoutFormDraft(key)?.composerText).toBeUndefined()
  })
})
