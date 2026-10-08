import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readWorkoutTemplateDraft, removeWorkoutTemplateDraft, workoutTemplateDraftKey, writeWorkoutTemplateDraft } from './workout-template-draft'
import type { WorkoutTemplateDraft } from '../../shared/domain'

const draft: WorkoutTemplateDraft = { id: '10000000-0000-4000-8000-000000000001', name: 'Название', notes: 'Заметка', version: 2,
  exercises: [{ source: 'system', ref: 'plank', name: 'Планка', muscleGroup: 'core', inputKind: 'duration', position: 0,
    blockId: 'block', blockType: 'group', blockRounds: 3, restBetweenRoundsSec: 60,
    sets: [{ position: 0, durationSec: 45.5 }, { position: 1, durationSec: 30 }] }] }
beforeEach(() => {
  const values = new Map<string, string>()
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) })
})
describe('template draft storage', () => {
  it('preserves name, notes, exercises, grouping, fractional load, identity and original version', () => {
    const key = workoutTemplateDraftKey('trainer', draft.id)
    expect(writeWorkoutTemplateDraft(key, draft)).toBe(true)
    expect(readWorkoutTemplateDraft(key)).toEqual(draft)
  })
  it('isolates accounts, existing templates, new drafts and different source workouts', () => {
    const key = workoutTemplateDraftKey('trainer', draft.id)
    writeWorkoutTemplateDraft(key, draft)
    for (const other of [workoutTemplateDraftKey('other', draft.id), workoutTemplateDraftKey('trainer', 'other'), workoutTemplateDraftKey('trainer'), workoutTemplateDraftKey('trainer', undefined, draft.id)]) {
      expect(readWorkoutTemplateDraft(other)).toBeNull()
    }
    expect(workoutTemplateDraftKey('trainer', undefined, 'first')).not.toBe(workoutTemplateDraftKey('trainer', undefined, 'second'))
    expect(readWorkoutTemplateDraft(key)).toEqual(draft)
  })
  it('removes only the explicitly finished draft', () => {
    const key = workoutTemplateDraftKey('trainer')
    const other = workoutTemplateDraftKey('other')
    writeWorkoutTemplateDraft(key, draft)
    writeWorkoutTemplateDraft(other, draft)
    removeWorkoutTemplateDraft(key)
    expect(readWorkoutTemplateDraft(key)).toBeNull()
    expect(readWorkoutTemplateDraft(other)).toEqual(draft)
  })
  it('ignores malformed storage without crashing or deleting it', () => {
    const key = workoutTemplateDraftKey('trainer')
    for (const value of ['not JSON', '{}', JSON.stringify({ ...draft, id: 'bad' }), JSON.stringify({ ...draft, version: 0 }), JSON.stringify({ ...draft, exercises: [null] })]) {
      localStorage.setItem(key, value)
      expect(readWorkoutTemplateDraft(key)).toBeNull()
      expect(localStorage.getItem(key)).toBe(value)
    }
  })
  it('reports denied storage while leaving the editor data available in memory', () => {
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('quota') })
    expect(writeWorkoutTemplateDraft(workoutTemplateDraftKey('trainer'), draft)).toBe(false)
  })
})
