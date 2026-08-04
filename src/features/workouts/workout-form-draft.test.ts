import { beforeEach, describe, expect, it, vi } from 'vitest'
import { localDate } from '../../shared/local-date'
import { readWorkoutFormDraft, removeWorkoutFormDraft, workoutFormDraftKey, writeWorkoutFormDraft, type WorkoutFormDraft } from './workout-form-draft'

describe('workout form draft storage', () => {
  const key = workoutFormDraftKey('trainer', 'workout-1')
  const draft: WorkoutFormDraft = {
    clientId: 'client-1', workoutDate: localDate('2026-08-04'), startTime: '09:00', endTime: '', notes: 'заметка', stageId: '', recordCompleted: false, exercises: [],
  }

  beforeEach(() => {
    const values = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (itemKey: string) => values.get(itemKey) ?? null,
      setItem: (itemKey: string, value: string) => values.set(itemKey, value),
      removeItem: (itemKey: string) => values.delete(itemKey),
    })
  })

  it('round-trips a draft per source workout', () => {
    writeWorkoutFormDraft(key, draft)
    expect(readWorkoutFormDraft(key)).toEqual(draft)
    expect(readWorkoutFormDraft(workoutFormDraftKey('trainer', 'other'))).toBeNull()
  })

  it('removes a saved draft', () => {
    writeWorkoutFormDraft(key, draft)
    removeWorkoutFormDraft(key)
    expect(readWorkoutFormDraft(key)).toBeNull()
  })
})
