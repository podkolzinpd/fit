import { describe, expect, it, vi } from 'vitest'
import type { DatabaseClient } from './db/types.js'
import { readTrainerDisplayNames, readTrainerPublishedIdentities } from './trainer-display-name.js'

describe('trainer public identity', () => {
  it('prefers published names, falls back to account or role, and isolates trainer IDs', async () => {
    const query = vi.fn().mockResolvedValue([
      { trainer_id: 'published', display_name: 'Татьяна' },
      { trainer_id: 'blank', display_name: null },
      { trainer_id: 'outside', display_name: 'Not requested' },
    ])
    const client: DatabaseClient = { query }
    const names = await readTrainerDisplayNames(client, [
      { trainerId: 'published', accountName: 'Account name' },
      { trainerId: 'blank', accountName: '  Анна Иванова  ' },
      { trainerId: 'missing', accountName: null },
    ])
    expect([...names]).toEqual([['published', 'Татьяна'], ['blank', 'Анна Иванова'], ['missing', 'Тренер']])
    expect(query.mock.calls[0]?.[0]).toContain("published_data->>'displayName'")
    expect(query.mock.calls[0]?.[0]).not.toContain('draft_data')
    expect(query.mock.calls[0]?.[1]).toEqual([['published', 'blank', 'missing']])
  })

  it('returns a public link only from an accessible published profile', async () => {
    const query = vi.fn().mockResolvedValue([
      { trainer_id: 'published', display_name: 'Анна', public_id: 'public-id' },
      { trainer_id: 'outside', display_name: 'Other', public_id: 'outside-id' },
    ])
    const result = await readTrainerPublishedIdentities({ query }, [
      { trainerId: 'published', accountName: 'Account' }, { trainerId: 'unpublished', accountName: 'Тренер' },
    ])
    expect([...result]).toEqual([
      ['published', { displayName: 'Анна', publicId: 'public-id' }],
      ['unpublished', { displayName: 'Тренер', publicId: null }],
    ])
    expect(query.mock.calls[0]?.[0]).toContain('published_data is not null')
    expect(query.mock.calls[0]?.[0]).not.toContain('draft_data')
    expect(query.mock.calls[0]?.[1]).toEqual([['published', 'unpublished']])
  })

  it('does not read profiles for an empty list and does not swallow a read failure', async () => {
    const query = vi.fn().mockRejectedValue(new Error('database unavailable'))
    const client: DatabaseClient = { query }
    expect(await readTrainerDisplayNames(client, [])).toEqual(new Map())
    expect(query).not.toHaveBeenCalled()
    await expect(readTrainerDisplayNames(client, [{ trainerId: 'one', accountName: null }])).rejects.toThrow('database unavailable')
  })
})
