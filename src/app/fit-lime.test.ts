import { describe, expect, it } from 'vitest'

import type { SessionActor } from '../shared/domain'
import { isFitLimeApprovedTrainerRoute, isFitLimeEnabled, isFitLimeShellRoute } from './fit-lime'

const trainer: SessionActor = {
  kind: 'trainer', role: 'trainer', userId: 'trainer-1', email: null,
  firstName: null, lastName: null, timezone: 'Europe/Moscow',
}

describe('isFitLimeEnabled', () => {
  it('requires the distinct server flag even when Schedule V2 is enabled', () => {
    expect(isFitLimeEnabled({ ...trainer, experiments: { trainerScheduleV2: true } })).toBe(false)
    expect(isFitLimeEnabled({ ...trainer, experiments: { trainerScheduleV2: false, fitLime: true } })).toBe(true)
    expect(isFitLimeEnabled({ ...trainer, experiments: { trainerScheduleV2: true, fitLime: false } })).toBe(false)
  })

  it('never enables Fit Lime for a client or unauthenticated visitor', () => {
    expect(isFitLimeEnabled({ ...trainer, kind: 'client', role: 'client', clientId: 'client-1', trainerId: 'trainer-1', fullName: 'Клиент', experiments: { trainerScheduleV2: true, fitLime: true } })).toBe(false)
    expect(isFitLimeEnabled(null)).toBe(false)
  })
})

describe('Fit Lime route boundary', () => {
  const pilot = { ...trainer, experiments: { trainerScheduleV2: true, fitLime: true } }

  it.each([
    ['/today', '?date=2026-09-25', true],
    ['/schedule', '?week=2026-09-21&range=2w', true],
    ['/clients', '', true],
    ['/clients/client-1/goal', '', true],
    ['/clients/client-1/workouts', '', true],
    ['/progress/client-1', '', true],
    ['/chat/thread-1', '', true],
    ['/join', '', true],
    ['/today', '?view=compose', false],
    ['/today', '?view=review', false],
    ['/workouts/new', '', false],
    ['/workouts/workout-1/live', '', false],
    ['/assistant', '', false],
    ['/me', '', false],
    ['/auth', '', false],
  ] as const)('%s%s has the approved stage-3 boundary', (pathname, search, approved) => {
    expect(isFitLimeApprovedTrainerRoute(pathname, search)).toBe(approved)
  })

  it('activates released calendar, chat, clients and connection routes only', () => {
    expect(isFitLimeShellRoute(pilot, '/today', '?date=2026-09-25')).toBe(true)
    expect(isFitLimeShellRoute(pilot, '/schedule', '?range=2w')).toBe(true)
    expect(isFitLimeShellRoute(pilot, '/chat', '')).toBe(true)
    expect(isFitLimeShellRoute(pilot, '/chat/thread-1', '')).toBe(true)
    expect(isFitLimeShellRoute(pilot, '/chat/thread-1/extra', '')).toBe(false)
    expect(isFitLimeShellRoute(pilot, '/clients', '')).toBe(true)
    expect(isFitLimeShellRoute(pilot, '/clients/archive', '')).toBe(true)
    expect(isFitLimeShellRoute(pilot, '/clients/client-1', '')).toBe(true)
    expect(isFitLimeShellRoute(pilot, '/clients/new', '')).toBe(true)
    expect(isFitLimeShellRoute(pilot, '/clients/client-1/edit', '')).toBe(true)
    expect(isFitLimeShellRoute(pilot, '/join', '')).toBe(true)
    expect(isFitLimeShellRoute(pilot, '/clients/client-1/goal', '')).toBe(true)
    expect(isFitLimeShellRoute(pilot, '/clients/client-1/workouts', '')).toBe(false)
    expect(isFitLimeShellRoute(pilot, '/today', '?view=compose')).toBe(false)
    expect(isFitLimeShellRoute({ ...pilot, experiments: { trainerScheduleV2: true, fitLime: false } }, '/today', '')).toBe(false)
    expect(isFitLimeShellRoute({ ...pilot, experiments: { trainerScheduleV2: true, fitLime: false } }, '/chat', '')).toBe(false)
    expect(isFitLimeShellRoute({ ...pilot, experiments: { trainerScheduleV2: true, fitLime: false } }, '/chat/thread-1', '')).toBe(false)
    expect(isFitLimeShellRoute({ ...pilot, experiments: { trainerScheduleV2: true, fitLime: false } }, '/clients', '')).toBe(false)
    expect(isFitLimeShellRoute({ ...pilot, experiments: { trainerScheduleV2: false, fitLime: true } }, '/today', '')).toBe(false)
    expect(isFitLimeShellRoute({ ...pilot, kind: 'client', role: 'client', clientId: 'client-1', trainerId: 'trainer-1', fullName: 'Клиент' }, '/schedule', '')).toBe(false)
  })
})
