import { describe, expect, it } from 'vitest'
import type { Workout } from '../../shared/domain'
import { localDate } from '../../shared/local-date'
import { filterScheduleWorkouts, isIndependentScheduleWorkout, trainerScheduleWorkouts } from './schedule-filters'

function workout(patch: Partial<Workout> = {}): Workout {
  return { id: 'meeting', clientId: 'athlete', clientName: 'Спортсмен', trainerId: 'coach', createdBy: 'coach', trainingFormat: 'with_trainer', workoutDate: localDate('2026-10-07'), status: 'planned', startTime: null, endTime: null, startedAt: null, completedAt: null, stageId: null, stageTitle: null, notes: null, version: 1, exercises: [], ...patch }
}

describe('Lime trainer schedule visibility', () => {
  it.each(['planned', 'in_progress', 'done', 'cancelled'] as const)('filters authors and formats for %s', (status) => {
    const rows = [workout({ status }), workout({ id: 'assigned-self', status, trainingFormat: 'self' }), workout({ id: 'athlete-self', status, createdBy: 'athlete', trainingFormat: 'self' }), workout({ id: 'athlete-with-trainer', status, createdBy: 'athlete' })]
    expect(trainerScheduleWorkouts(rows, 'coach', false).map((row) => row.id)).toEqual(['meeting'])
    expect(trainerScheduleWorkouts(rows, 'coach', true).map((row) => row.id)).toEqual(['meeting', 'assigned-self'])
    expect(rows).toHaveLength(4)
  })

  it('uses creation actor, not partition, origin or execution actors', () => {
    const rows = [workout({ trainerId: 'athlete', origin: 'ai', startedBy: 'athlete', completedBy: 'athlete' }), workout({ id: 'another-coach', createdBy: 'another-coach' }), workout({ id: 'athlete', createdBy: 'athlete', startedBy: 'coach', completedBy: 'coach' })]
    expect(trainerScheduleWorkouts(rows, 'coach', true).map((row) => row.id)).toEqual(['meeting'])
    expect(trainerScheduleWorkouts(rows, undefined, true)).toEqual([])
  })

  it('preserves only own legacy null/empty author and treats missing format as self', () => {
    const rows = [workout({ id: 'null-own', createdBy: null }), workout({ id: 'empty-own', createdBy: '' }), workout({ id: 'foreign', createdBy: null, trainerId: 'another-coach' }), workout({ id: 'unknown', createdBy: undefined, trainerId: undefined }), workout({ id: 'missing-format', trainingFormat: undefined })]
    expect(trainerScheduleWorkouts(rows, 'coach', false).map((row) => row.id)).toEqual(['null-own', 'empty-own'])
    expect(trainerScheduleWorkouts(rows, 'coach', true).map((row) => row.id)).toEqual(['null-own', 'empty-own', 'missing-format'])
    expect(isIndependentScheduleWorkout(workout({ trainingFormat: undefined }))).toBe(true)
  })

  it('composes client/status filters without filtering shared source data', () => {
    const rows = [workout(), workout({ id: 'other-client', clientId: 'other-client' }), workout({ id: 'done-self', status: 'done', trainingFormat: 'self' }), workout({ id: 'athlete-done', createdBy: 'athlete', status: 'done' })]
    const visible = trainerScheduleWorkouts(rows, 'coach', true)
    expect(filterScheduleWorkouts(visible, 'athlete', 'done').map((row) => row.id)).toEqual(['done-self'])
    expect(filterScheduleWorkouts(rows, 'athlete', 'done').map((row) => row.id)).toEqual(['done-self', 'athlete-done'])
  })
})
