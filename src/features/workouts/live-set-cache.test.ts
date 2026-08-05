import { describe, expect, it } from 'vitest'
import type { Workout } from '../../shared/domain'
import { applyLiveSetDraft, sameLiveSetDraft, setWithLocalDraft } from './live-set-cache'

const workout = {
  id: 'workout-1', clientId: 'client-1', clientName: 'Антон', workoutDate: '2026-08-05', status: 'in_progress', version: 1,
  exercises: [{
    id: 'exercise-1', name: 'Разводка', equipment: 'Гантели', inputKind: 'strength', position: 0, blockId: 'block-1', blockType: 'single', sets: [
      { id: 'set-1', position: 0, weightKg: 50, reps: 10, fact: {}, confirmedAt: null, version: 1 },
      { id: 'set-2', position: 1, weightKg: 50, reps: 10, fact: {}, confirmedAt: null, version: 1 },
    ],
  }],
} as unknown as Workout

describe('applyLiveSetDraft', () => {
  it('keeps an autosaved fact visible after moving to another set', () => {
    const result = applyLiveSetDraft(workout, 'set-2', { weightKg: 52.5, reps: 8 }, 2)

    expect(result.exercises[0]?.sets[0]?.fact).toEqual({})
    expect(result.exercises[0]?.sets[1]?.fact).toEqual({ weightKg: 52.5, reps: 8 })
    expect(result.exercises[0]?.sets[1]?.version).toBe(2)
  })

  it('keeps the local draft visible while a stale realtime response arrives', () => {
    const set = workout.exercises[0]!.sets[1]!
    const local = { weightKg: 52.5, reps: 8 }

    expect(setWithLocalDraft(set, local).fact).toEqual(local)
    expect(sameLiveSetDraft({ weightKg: 52.5, reps: 8 }, local)).toBe(true)
    expect(sameLiveSetDraft({}, local)).toBe(false)
  })
})
