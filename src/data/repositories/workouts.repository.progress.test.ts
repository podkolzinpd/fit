import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionActor } from '../../shared/domain'
import { createYandexMainRepository } from './yandex-main.repository'

const clientId = '10000000-0000-4000-8000-000000000001'
const actor: SessionActor = {
  kind: 'trainer', role: 'trainer', userId: '10000000-0000-4000-8000-000000000002',
  email: null, firstName: 'Тренер', lastName: null, timezone: 'Europe/Moscow',
}

function item(index: number) {
  const day = String(31 - index).padStart(2, '0')
  return {
    workoutId: `20000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    workoutDate: `2026-01-${day}`,
    completedAt: `2026-01-${day}T10:00:00Z`,
    exerciseName: 'Присед', inputKind: 'strength', confirmedSetCount: 2,
    primaryValue: 60, previousPrimaryValue: 55, primaryChange: 5, allTimePrimaryValue: 65,
    bestWeightKg: 60, repsAtBestWeight: 8, bestWeightReps: 480,
    allTimeBestWeightKg: 65, allTimeBestWeightReps: 520,
    isPrimaryPr: true, isWeightPr: true, isWeightRepsPr: false,
    trainerComment: index === 0 ? 'Чистая техника' : null,
    sets: [{ weightKg: 60, reps: 8, durationSec: null, distanceKm: null, rpe: 8 }],
  }
}

describe('native exercise progress pages', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('preserves calculated facts and passes the server cursor to the next request', async () => {
    const cursor = { completedAt: item(19).completedAt, workoutId: item(19).workoutId }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ items: Array.from({ length: 20 }, (_, index) => item(index)), nextCursor: cursor, totalCount: 25 }))
      .mockResolvedValueOnce(Response.json({ items: [item(20)], nextCursor: null, totalCount: 25 }))
    vi.stubGlobal('fetch', fetchMock)
    const repository = createYandexMainRepository('https://stage.example.test', 'a'.repeat(43), actor)
    const page = await repository.workouts.exerciseProgressPage(clientId, 'squat', null)

    expect(page.items).toHaveLength(20)
    expect(page.totalCount).toBe(25)
    expect(page.nextCursor).toEqual(cursor)
    expect(page.items[0]).toEqual({
      ...item(0),
      sets: [{ weightKg: 60, reps: 8, durationSec: undefined, distanceKm: undefined, rpe: 8 }],
    })
    const next = await repository.workouts.exerciseProgressPage(clientId, 'squat', page.nextCursor!)
    const request = new URL(String(fetchMock.mock.calls[1]?.[0]))
    expect(request.pathname).toBe(`/v1/clients/${clientId}/progress/exercises/squat`)
    expect(request.searchParams.get('limit')).toBe('20')
    expect(request.searchParams.get('beforeCompletedAt')).toBe(cursor.completedAt)
    expect(request.searchParams.get('beforeWorkoutId')).toBe(cursor.workoutId)
    expect(next).toMatchObject({ items: [{ workoutId: item(20).workoutId }], nextCursor: null, totalCount: 25 })
  })

  it('does not invent a cursor when the server returns the final page', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ items: [item(0)], nextCursor: null, totalCount: 1 })))
    const repository = createYandexMainRepository('https://stage.example.test', 'a'.repeat(43), actor)
    await expect(repository.workouts.exerciseProgressPage(clientId, 'squat', null))
      .resolves.toMatchObject({ nextCursor: null, totalCount: 1 })
  })
})
