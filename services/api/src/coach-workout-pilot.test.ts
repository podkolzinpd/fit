import { describe, expect, it, vi } from 'vitest'
import { buildMigrationApp } from './migration-app.js'
import { inspectCoachWorkoutPilot } from './db/coach-workout-pilot.js'
import type { DatabasePool } from './db/types.js'
import { FIT_LIME_CALENDAR_LOGINS } from './db/fit-lime-calendar-plan.js'

const ids = ['10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002']
describe('private fixed coach workout cohort readback', () => {
  it('only reads the two bound trainer profiles; no caller targets or mutations', async () => {
    const query = vi.fn().mockResolvedValue(ids.map((profile_id) => ({ profile_id })))
    const release = vi.fn()
    const pool = { connect: () => Promise.resolve({ query, release }) } as unknown as DatabasePool
    expect(await inspectCoachWorkoutPilot(pool)).toEqual(ids)
    expect(query).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("p.account_role = 'trainer'"), [FIT_LIME_CALENDAR_LOGINS])
    for (const rows of [[], [{ profile_id: ids[0] }], ids.map(() => ({ profile_id: ids[0] })), [...ids, ids[0]].map((profile_id) => ({ profile_id }))]) {
      query.mockResolvedValueOnce(rows)
      await expect(inspectCoachWorkoutPilot(pool)).rejects.toThrow()
    }
    expect(release).toHaveBeenCalledTimes(5)
  })
  it('is absent without private configuration, rejects arbitrary targets and hides failures', async () => {
    const absent = buildMigrationApp({ runMigrations: () => Promise.resolve([]) })
    expect((await absent.inject('/stage/experiments/coach-workout-pilot')).statusCode).toBe(404)
    await absent.close()
    const inspect = vi.fn().mockResolvedValueOnce(ids).mockRejectedValueOnce(new Error('private detail'))
    const app = buildMigrationApp({ runMigrations: () => Promise.resolve([]), coachWorkoutPilot: inspect })
    expect((await app.inject('/stage/experiments/coach-workout-pilot?profileId=other')).statusCode).toBe(400)
    expect(inspect).not.toHaveBeenCalled()
    expect((await app.inject('/stage/experiments/coach-workout-pilot')).json()).toEqual({ status: 'coach_workout_pilot_ready', profileIds: ids })
    const failed = await app.inject('/stage/experiments/coach-workout-pilot')
    expect(failed.statusCode).toBe(409)
    expect(failed.body).not.toContain('private detail')
    await app.close()
  })
})
