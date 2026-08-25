import { describe, expect, it } from 'vitest'
import type { ExerciseSnapshot } from '../../shared/domain'
import { programWorkoutDrafts } from './program-draft'

const benchPress = {
  source: 'system', ref: 'barbell-bench-press', name: 'Жим штанги лёжа', muscleGroup: 'chest', inputKind: 'strength',
} as ExerciseSnapshot

describe('assistant program draft saving', () => {
  it('builds planned workout drafts with stable request ids for a retry', () => {
    const input = [{ title: 'Силовая A', day: 'Понедельник', exercises: [{ name: 'Жим штанги лёжа', sets: 3, reps: 8, weightKg: 40 }] }]
    const first = programWorkoutDrafts('6f0c4fb9-5f61-4d78-97aa-1f8b8d79c447', input, ['2026-08-31'], ['f05074d3-2f64-4fa6-a91f-6fe749afb30d'], [benchPress])
    const retry = programWorkoutDrafts('6f0c4fb9-5f61-4d78-97aa-1f8b8d79c447', input, ['2026-08-31'], ['f05074d3-2f64-4fa6-a91f-6fe749afb30d'], [benchPress])

    expect(first?.[0]).toMatchObject({ requestId: 'f05074d3-2f64-4fa6-a91f-6fe749afb30d', workoutDate: '2026-08-31', notes: 'Силовая A' })
    expect(first?.[0]?.exercises[0]).toMatchObject({ ref: 'barbell-bench-press', sets: [{ position: 0, reps: 8, weightKg: 40 }, { position: 1, reps: 8, weightKg: 40 }, { position: 2, reps: 8, weightKg: 40 }] })
    expect(retry?.[0]?.requestId).toBe(first?.[0]?.requestId)
  })

  it('blocks confirmation until every exercise maps unambiguously to the catalog', () => {
    expect(programWorkoutDrafts(
      '6f0c4fb9-5f61-4d78-97aa-1f8b8d79c447',
      [{ title: 'Силовая A', day: 'Понедельник', exercises: [{ name: 'Несуществующее упражнение', sets: 3, reps: 8 }] }],
      ['2026-08-31'], ['f05074d3-2f64-4fa6-a91f-6fe749afb30d'], [benchPress],
    )).toBeUndefined()
  })
})
