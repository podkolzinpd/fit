import { describe, expect, it, vi } from 'vitest'
import { buildMigrationApp } from './migration-app.js'
import { FitLimeCalendarNotReadyError } from './db/fit-lime-calendar-fixtures.js'

describe('private Fit Lime calendar operation', () => {
  it('is absent by default and cannot be given arbitrary account targets', async () => {
    const app = buildMigrationApp({ runMigrations: () => Promise.resolve([]) })
    expect((await app.inject({ method: 'POST', url: '/stage/experiments/fit-lime-calendar', payload: { action: 'seed' } })).statusCode).toBe(404)
    await app.close()
    const apply = vi.fn()
    const enabled = buildMigrationApp({ runMigrations: () => Promise.resolve([]), fitLimeCalendar: { apply } })
    expect((await enabled.inject({ method: 'POST', url: '/stage/experiments/fit-lime-calendar', payload: { action: 'seed', profileId: 'somebody-else' } })).statusCode).toBe(400)
    expect(apply).not.toHaveBeenCalled()
    await enabled.close()
  })
  it('returns bounded counts without sessions or personal data and keeps failures generic', async () => {
    const apply = vi.fn().mockResolvedValueOnce({ batch: 'fit-lime-calendar-20261003', created: true, trainers: [], isolated: true })
      .mockRejectedValueOnce(new FitLimeCalendarNotReadyError('private detail')).mockRejectedValueOnce(new Error('private database detail'))
    const app = buildMigrationApp({ runMigrations: () => Promise.resolve([]), fitLimeCalendar: { apply } })
    const first = await app.inject({ method: 'POST', url: '/stage/experiments/fit-lime-calendar', payload: { action: 'seed' } })
    expect(first.statusCode).toBe(200)
    expect(first.json()).toMatchObject({ status: 'fit_lime_calendar_ready', created: true })
    expect(apply).toHaveBeenCalledWith('seed')
    const conflict = await app.inject({ method: 'POST', url: '/stage/experiments/fit-lime-calendar', payload: { action: 'seed' } })
    expect(conflict.statusCode).toBe(409)
    expect(conflict.body).not.toContain('private detail')
    const failed = await app.inject({ method: 'POST', url: '/stage/experiments/fit-lime-calendar', payload: { action: 'inspect' } })
    expect(failed.statusCode).toBe(500)
    expect(failed.body).not.toContain('private database detail')
    await app.close()
  })
})
