import { expect, it } from 'vitest'
import type { Workout, WorkoutSlotDraft } from '../../shared/domain'
import { localDate } from '../../shared/local-date'
import { overlappingWorkoutSlots, shiftWorkoutSlot } from './workout-slot'

const slot: WorkoutSlotDraft = { workoutDate: localDate('2026-11-02'), startTime: '10:00', endTime: '11:00' }
const workout = { id: 'own', ...slot, createdBy: 'trainer', status: 'planned', trainingFormat: 'with_trainer' } as Workout
it('moves daytime and overnight intervals intact without inventing an unknown end', () => {
  expect(shiftWorkoutSlot(slot, '11:30')).toEqual({ ...slot, startTime: '11:30', endTime: '12:30' })
  expect(shiftWorkoutSlot({ ...slot, endTime: null }, '11:30').endTime).toBeNull()
  expect(shiftWorkoutSlot(slot, '23:30')).toEqual({ ...slot, startTime: '23:30', endTime: '00:30' })
  expect(shiftWorkoutSlot({ ...slot, startTime: '23:00', endTime: '01:00' }, '00:30').endTime).toBe('02:30')
})
it('treats unknown durations as points and excludes touching, self, cancelled and other-author slots', () => {
  const item = (id: string, startTime: string, endTime: string | null, extra: Partial<Workout> = {}): Workout => ({ ...workout, id, startTime, endTime, ...extra })
  const items = [item('touching', '11:00', '12:00'), item('inside', '10:30', null), item('enclosing', '09:00', '12:00'),
    item('cancelled', '10:00', '11:00', { status: 'cancelled' }), item('self', '10:00', '11:00', { trainingFormat: 'self' }),
    item('other', '10:00', '11:00', { createdBy: 'other-trainer' }), workout]
  expect(overlappingWorkoutSlots(workout, slot, items).map(i => i.id)).toEqual(['inside', 'enclosing'])
  expect(overlappingWorkoutSlots(workout, { ...slot, endTime: null }, items).map(i => i.id)).toEqual(['enclosing'])
})

it('finds overnight collisions on the previous and following local date', () => {
  const next = { ...workout, id: 'next', workoutDate: localDate('2026-11-03'), startTime: '00:30', endTime: '02:00' }
  const previous = { ...workout, id: 'previous', workoutDate: localDate('2026-11-01'), startTime: '23:30', endTime: '01:30' }
  expect(overlappingWorkoutSlots(workout, { ...slot, startTime: '23:00', endTime: '01:00' }, [next, previous]).map(i => i.id)).toEqual(['next'])
  expect(overlappingWorkoutSlots(workout, { ...slot, startTime: '00:30', endTime: '01:30' }, [next, previous]).map(i => i.id)).toEqual(['previous'])
})
