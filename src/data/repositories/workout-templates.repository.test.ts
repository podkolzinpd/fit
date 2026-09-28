import { describe, expect, it, vi } from 'vitest'
import type { Workout } from '../../shared/domain'
import { localDate } from '../../shared/local-date'
import { cloneWorkoutTemplate, workoutTemplateFromWorkout } from './workout-templates.repository'

describe('workout templates', () => {
  it('keeps only the planned workout snapshot', () => {
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('10000000-0000-4000-8000-000000000001')
    const workout: Workout = {
      id: '20000000-0000-4000-8000-000000000001', clientId: '30000000-0000-4000-8000-000000000001', trainerId: '40000000-0000-4000-8000-000000000001', clientName: 'Анна',
      createdBy: '40000000-0000-4000-8000-000000000001', workoutDate: localDate('2026-09-20'), startTime: '10:00', endTime: null,
      startedAt: '2026-09-20T10:00:00Z', completedAt: '2026-09-20T11:00:00Z', status: 'done', notes: 'Спокойный темп', clientComment: 'Было тяжело', sessionRpe: 9,
      wellbeing: 'hard', discomfort: true, stageId: null, stageTitle: null, version: 4,
      exercises: [{ id: '50000000-0000-4000-8000-000000000001', source: 'system', ref: 'squat', name: 'Присед', muscleGroup: 'legs', inputKind: 'strength', position: 0,
        blockId: '60000000-0000-4000-8000-000000000001', blockType: 'single', blockPreset: 'set', blockRounds: 1,
        restBetweenExercisesSec: 0, restBetweenRoundsSec: 0, restBetweenSetsSec: 90, trainerComment: 'Колени наружу',
        sets: [{ id: '70000000-0000-4000-8000-000000000001', position: 0, weightKg: 50, reps: 8, rpe: 7,
          fact: { weightKg: 70, reps: 10, rpe: 9 }, confirmedAt: '2026-09-20T10:15:00Z', version: 2 }] }],
    }
    const draft = workoutTemplateFromWorkout(workout, 'Ноги')
    expect(draft).toMatchObject({ id: '10000000-0000-4000-8000-000000000001', name: 'Ноги', notes: 'Спокойный темп' })
    expect(draft.exercises[0]?.sets[0]).toEqual({ position: 0, weightKg: 50, reps: 8, durationSec: undefined, durationMin: undefined, distanceKm: undefined, rpe: 7 })
    expect(JSON.stringify(draft)).not.toContain('fact')
    expect(JSON.stringify(draft)).not.toContain('confirmedAt')
    expect(JSON.stringify(draft)).not.toContain(workout.clientId)
    expect(workoutTemplateFromWorkout(workout).name).toBe('Новый шаблон')
  })

  it('duplicates as an independent snapshot', () => {
    const source = { name: 'Всё тело', notes: 'Держать темп', exercises: [{ source: 'system' as const, ref: 'plank', name: 'Планка', muscleGroup: 'core' as const, inputKind: 'duration' as const, position: 0, blockId: '80000000-0000-4000-8000-000000000001', sets: [{ position: 0, durationSec: 45 }] }] }
    const copy = cloneWorkoutTemplate(source)
    expect(copy.name).toBe('Всё тело — копия')
    expect(copy.id).not.toBeUndefined()
    expect(copy.exercises[0]?.blockId).not.toBe(source.exercises[0]?.blockId)
  })
})
