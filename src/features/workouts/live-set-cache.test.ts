import { describe, expect, it } from 'vitest'
import type { Workout } from '../../shared/domain'
import { applyLiveSetConfirmation, applyLiveSetDraft, reconcileLiveWorkout, sameLiveSetDraft, setWithCarriedLiveWeight, setWithLocalDraft } from './live-set-cache'

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
  it('applies successful confirmation once and rejects an older refetch', () => {
    const confirmed = applyLiveSetConfirmation(workout, 'set-1', { weightKg: 55, reps: 8 }, 3, '2026-09-09T10:00:00Z')
    const stale = reconcileLiveWorkout(confirmed, workout)
    expect(stale.exercises[0]?.sets[0]).toMatchObject({ version: 3, confirmedAt: '2026-09-09T10:00:00Z', fact: { weightKg: 55, reps: 8 } })
    expect(stale.exercises[0]?.sets[1]?.confirmedAt).toBeNull()
    expect(workout.exercises[0]?.sets[0]?.confirmedAt).toBeNull()
    expect(reconcileLiveWorkout(undefined, workout)).toBe(workout)
    expect(reconcileLiveWorkout({ ...workout, version: 4 }, workout).version).toBe(4)
    expect(reconcileLiveWorkout(workout, { ...workout, exercises: [] }).exercises).toEqual([])
  })
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

  it('carries the latest confirmed fact through the same planned-weight group', () => {
    const exercise = {
      ...workout.exercises[0]!,
      sets: [
        { id: 'warmup', position: 0, weightKg: 10, reps: 10, fact: { weightKg: 12 }, confirmedAt: 'now', version: 2 },
        { id: 'work-1', position: 1, weightKg: 20, reps: 8, fact: { weightKg: 22 }, confirmedAt: 'now', version: 2 },
        { id: 'work-2', position: 2, weightKg: 20, reps: 8, fact: {}, confirmedAt: null, version: 1 },
        { id: 'top', position: 3, weightKg: 30, reps: 6, fact: {}, confirmedAt: null, version: 1 },
      ],
    }

    expect(setWithCarriedLiveWeight(exercise, exercise.sets[2]!).fact.weightKg).toBe(22)
    expect(setWithCarriedLiveWeight(exercise, exercise.sets[3]!).fact.weightKg).toBeUndefined()
  })

  it('uses the most recent confirmed fact and preserves a manually entered weight', () => {
    const exercise = {
      ...workout.exercises[0]!,
      sets: [
        { id: 'set-1', position: 0, weightKg: 20, reps: 8, fact: { weightKg: 25 }, confirmedAt: 'first', version: 2 },
        { id: 'set-2', position: 1, weightKg: 20, reps: 8, fact: { weightKg: 27 }, confirmedAt: 'second', version: 2 },
        { id: 'set-3', position: 2, weightKg: 20, reps: 8, fact: { weightKg: 30 }, confirmedAt: null, version: 2 },
        { id: 'set-4', position: 3, weightKg: 20, reps: 8, fact: {}, confirmedAt: null, version: 1 },
      ],
    }

    expect(setWithCarriedLiveWeight(exercise, exercise.sets[2]!).fact.weightKg).toBe(30)
    expect(setWithCarriedLiveWeight(exercise, exercise.sets[3]!).fact.weightKg).toBe(27)
  })

  it('lets a local draft override the carried weight', () => {
    const exercise = {
      ...workout.exercises[0]!,
      sets: [
        { id: 'set-1', position: 0, weightKg: 20, reps: 8, fact: { weightKg: 25 }, confirmedAt: 'now', version: 2 },
        { id: 'set-2', position: 1, weightKg: 20, reps: 8, fact: {}, confirmedAt: null, version: 1 },
      ],
    }

    expect(setWithCarriedLiveWeight(exercise, exercise.sets[1]!, { weightKg: 30 }).fact.weightKg).toBe(30)
  })
})
