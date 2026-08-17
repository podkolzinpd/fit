import { beforeEach, describe, expect, it, vi } from 'vitest'
import { localDate } from '../../shared/local-date'

const rpc = vi.hoisted(() => vi.fn())
const query = vi.hoisted(() => ({
  select: vi.fn(),
  eq: vi.fn(),
  is: vi.fn(),
  single: vi.fn(),
  in: vi.fn(),
  order: vi.fn(),
}))
const from = vi.hoisted(() => vi.fn())

vi.mock('./client', () => ({ supabase: { rpc, from } }))

import { workoutQueries } from './workouts.queries'

describe('workoutQueries lists', () => {
  beforeEach(() => {
    rpc.mockReset()
    from.mockReset()
    for (const method of Object.values(query)) method.mockReset().mockReturnValue(query)
    from.mockReturnValue(query)
  })

  it('loads the complete workout list with one aggregate RPC', () => {
    const response = Promise.resolve({ data: [], error: null })
    rpc.mockReturnValue(response)

    expect(workoutQueries.listPage('2026-07-01', '2026-07-31', 'client-id', 50, 100)).toBe(response)
    expect(rpc).toHaveBeenCalledOnce()
    expect(rpc).toHaveBeenCalledWith('list_workouts', {
      p_from: '2026-07-01',
      p_to: '2026-07-31',
      p_client_id: 'client-id',
      p_limit: 50,
      p_offset: 100,
    })
  })

  it('uses explicit nulls for optional filters', () => {
    workoutQueries.listPage(undefined, undefined, undefined, 50, 0)

    expect(rpc).toHaveBeenCalledWith('list_workouts', {
      p_from: null,
      p_to: null,
      p_client_id: null,
      p_limit: 50,
      p_offset: 0,
    })
  })

  it('loads summaries without the nested workout aggregate', () => {
    workoutQueries.listSummaries('client-id')

    expect(rpc).toHaveBeenCalledWith('list_workout_summaries', { p_client_id: 'client-id' })
  })

  it('loads only the latest completed values for selected exercises', () => {
    workoutQueries.latestExerciseResults('client-id', ['squat', 'plank'])

    expect(rpc).toHaveBeenCalledWith('list_latest_exercise_results', {
      p_client_id: 'client-id', p_exercise_refs: ['squat', 'plank'],
    })
  })

  it('loads all personal-record details for one workout in one request', () => {
    workoutQueries.personalRecords('workout-id')

    expect(rpc).toHaveBeenCalledWith('list_workout_personal_records', {
      p_workout_id: 'workout-id',
    })
  })

  it('builds detail reads through the explicit table contracts', () => {
    workoutQueries.getRoot('workout-id')
    workoutQueries.getExercises('workout-id')
    workoutQueries.getSets(['exercise-a', 'exercise-b'])

    expect(from).toHaveBeenNthCalledWith(1, 'workouts')
    expect(from).toHaveBeenNthCalledWith(2, 'workout_exercises')
    expect(from).toHaveBeenNthCalledWith(3, 'workout_sets')
    expect(query.eq).toHaveBeenCalledWith('id', 'workout-id')
    expect(query.eq).toHaveBeenCalledWith('workout_id', 'workout-id')
    expect(query.in).toHaveBeenCalledWith('workout_exercise_id', ['exercise-a', 'exercise-b'])
  })

  it('passes workout mutations through their RPC contracts', () => {
    const draft = {
      clientId: 'client-id',
      workoutDate: localDate('2026-07-23'),
      exercises: [],
      version: 3,
    }
    const exercise = {
      source: 'system' as const,
      ref: 'squat',
      name: 'Присед',
      muscleGroup: 'legs' as const,
      inputKind: 'strength' as const,
    }

    workoutQueries.save(draft)
    workoutQueries.saveCompleted(draft)
    workoutQueries.start('workout-id', 3)
    workoutQueries.saveLiveSet('set-id', { weightKg: 42.5, reps: 10 }, 4)
    workoutQueries.confirmLiveSet('set-id', 5)
    workoutQueries.appendLiveExercise('workout-id', exercise, 6)
    workoutQueries.appendLiveSet('exercise-id', 7)
    workoutQueries.reorderLiveBlock('workout-id', 'block-id', -1, 8)
    workoutQueries.replaceLiveExercise('workout-id', 'exercise-id', exercise, 9)
    workoutQueries.setExerciseComment('exercise-id', 'Держи спину', 10)
    workoutQueries.setWorkoutReview('workout-id', { reaction: 'fire', review: 'Отличная работа' }, 11)
    workoutQueries.setClientWorkoutComment('workout-id', 'Нужна корректировка веса', 12)
    workoutQueries.submitFeedback('workout-id', { sessionRpe: 8, wellbeing: 'normal', discomfort: true, comment: 'Тянет колено' }, 13)
    workoutQueries.finish('workout-id', 14)
    workoutQueries.remove('workout-id', 15)

    expect(rpc).toHaveBeenCalledTimes(15)
    expect(rpc).toHaveBeenNthCalledWith(1, 'save_workout', { p_workout: draft, p_expected_version: 3 })
    expect(rpc).toHaveBeenNthCalledWith(2, 'save_completed_workout', { p_workout: draft, p_expected_version: 3 })
    expect(rpc).toHaveBeenNthCalledWith(3, 'start_workout', { p_workout_id: 'workout-id', p_expected_version: 3 })
    expect(rpc).toHaveBeenNthCalledWith(4, 'save_live_set_draft', {
      p_set_id: 'set-id',
      p_draft: { weightKg: 42.5, reps: 10 },
      p_expected_version: 4,
    })
    expect(rpc).toHaveBeenNthCalledWith(5, 'confirm_live_set', { p_set_id: 'set-id', p_expected_version: 5 })
    expect(rpc).toHaveBeenNthCalledWith(6, 'append_live_exercise', {
      p_workout_id: 'workout-id',
      p_exercise: exercise,
      p_expected_version: 6,
    })
    expect(rpc).toHaveBeenNthCalledWith(7, 'append_live_set', { p_workout_exercise_id: 'exercise-id', p_expected_version: 7 })
    expect(rpc).toHaveBeenNthCalledWith(8, 'reorder_live_block', { p_workout_id: 'workout-id', p_block_id: 'block-id', p_direction: -1, p_expected_version: 8 })
    expect(rpc).toHaveBeenNthCalledWith(9, 'replace_live_exercise', { p_workout_id: 'workout-id', p_exercise_id: 'exercise-id', p_exercise: exercise, p_expected_version: 9 })
    expect(rpc).toHaveBeenNthCalledWith(10, 'set_exercise_comment', { p_exercise_id: 'exercise-id', p_comment: 'Держи спину', p_expected_version: 10 })
    expect(rpc).toHaveBeenNthCalledWith(11, 'set_workout_review', { p_workout_id: 'workout-id', p_reaction: 'fire', p_review: 'Отличная работа', p_expected_version: 11 })
    expect(rpc).toHaveBeenNthCalledWith(12, 'set_client_workout_comment', { p_workout_id: 'workout-id', p_comment: 'Нужна корректировка веса', p_expected_version: 12 })
    expect(rpc).toHaveBeenNthCalledWith(13, 'submit_workout_feedback', {
      p_workout_id: 'workout-id', p_session_rpe: 8, p_wellbeing: 'normal',
      p_discomfort: true, p_comment: 'Тянет колено', p_expected_version: 13,
    })
    expect(rpc).toHaveBeenNthCalledWith(14, 'finish_workout', { p_workout_id: 'workout-id', p_expected_version: 14 })
    expect(rpc).toHaveBeenNthCalledWith(15, 'soft_delete_workout', { p_workout_id: 'workout-id', p_expected_version: 15 })
  })
})
