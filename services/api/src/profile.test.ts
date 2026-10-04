import { describe, expect, it, vi } from 'vitest'

import type { DatabaseClient } from './db/types.js'
import { readOwnProfile } from './profile.js'

const trainerRow = {
  id: '10000000-0000-4000-8000-000000000001',
  first_name: 'Антон',
  last_name: null,
  timezone: 'Europe/Moscow',
  account_role: 'trainer',
  client_id: null,
  client_trainer_id: null,
  client_full_name: null,
  trainer_schedule_v2: true,
  fit_lime: true,
  schedule_density: 'compact',
}

describe('readOwnProfile Fit Lime flag', () => {
  it('returns the independent server decision for a trainer session', async () => {
    const query = vi.fn().mockResolvedValue([trainerRow])
    const client: DatabaseClient = { query: query as DatabaseClient['query'] }

    await expect(readOwnProfile(client, 'read_write')).resolves.toMatchObject({
      accessMode: 'read_write',
      profile: { experiments: { trainerScheduleV2: true, fitLime: true } },
    })
    await expect(readOwnProfile(client, 'read_write')).resolves.toMatchObject({
      profile: { preferences: { scheduleDensity: 'compact' } },
    })
    expect(query.mock.calls[0]?.[0]).toContain('app_private.fit_lime_enabled()')
  })

  it('does not infer Lime from Schedule V2 when the server disables it', async () => {
    const query = vi.fn().mockResolvedValue([{ ...trainerRow, fit_lime: false }])
    const client: DatabaseClient = { query: query as DatabaseClient['query'] }

    await expect(readOwnProfile(client)).resolves.toMatchObject({
      profile: { experiments: { trainerScheduleV2: true, fitLime: false } },
    })
  })
  it('returns only the independent client assignment and defaults missing decisions off', async () => {
    const query = vi.fn().mockResolvedValue([{ ...trainerRow, account_role: 'client', fit_lime: false, client_lime: true }])
    const client: DatabaseClient = { query: query as DatabaseClient['query'] }
    await expect(readOwnProfile(client)).resolves.toMatchObject({ profile: { experiments: { clientLime: true, fitLime: false } } })
    query.mockResolvedValue([{ ...trainerRow, client_lime: undefined }])
    await expect(readOwnProfile(client)).resolves.toMatchObject({ profile: { experiments: { clientLime: false } } })
  })

})
