import { describe, expect, it, vi } from 'vitest'
import type { DatabaseClient } from './db/types.js'
import { readActiveWorkout, readWorkoutHome } from './workout-home-reader.js'

function fixture() {
  const query = vi.fn<DatabaseClient['query']>().mockResolvedValue([])
  // Vitest erases the generic Row signature; each test supplies its explicit SQL row fixture.
  const client: DatabaseClient = { query: query as DatabaseClient['query'] }
  return { client, query }
}

describe('compact workout reads', () => {
  it('filters active before limiting and does not read exercises, sets or personal records', async () => {
    const { client, query } = fixture()
    query.mockResolvedValueOnce([{ id: 'client' }]).mockResolvedValueOnce([
      { id: 'active', workout_date: '2025-01-01', status: 'in_progress' },
    ])
    expect(await readActiveWorkout(client, 'client')).toEqual({ id: 'active', workoutDate: '2025-01-01', status: 'in_progress' })
    expect(query.mock.calls[1]?.[0]).toMatch(/status = 'in_progress'[\s\S]*limit 1/)
    expect(query.mock.calls[1]?.[1]).toEqual(['client'])
    expect(query.mock.calls.map(([sql]) => sql).join('\n')).not.toMatch(/workout_(sets|exercises)|personal_record/)
  })

  it('distinguishes a visible client without active workout from an inaccessible client', async () => {
    const { client, query } = fixture()
    await expect(readActiveWorkout(client, 'foreign')).rejects.toMatchObject({ failure: 'not_found' })
    expect(query).toHaveBeenCalledTimes(1)
    query.mockResolvedValueOnce([{ id: 'client' }])
    expect(await readActiveWorkout(client, 'client')).toBeNull()
  })

  it('returns a home preview in one SQL read without sets, metadata or PR scans', async () => {
    const { client, query } = fixture()
    query.mockResolvedValueOnce([{ id: 'w', client_id: 'c', client_name: 'Synthetic client',
      workout_date: '2026-10-08', start_time: null, status: 'planned', exercise_count: '7',
      exercise_names: ['First', 'Second'] }])
    expect(await readWorkoutHome(client, '2026-10-08')).toEqual([{
      id: 'w', clientId: 'c', clientName: 'Synthetic client', workoutDate: '2026-10-08',
      startTime: null, status: 'planned', exerciseCount: 7, exerciseNames: ['First', 'Second'],
    }])
    expect(query).toHaveBeenCalledTimes(1)
    expect(query.mock.calls[0]?.[1]).toEqual(['2026-10-08'])
    expect(query.mock.calls[0]?.[0]).not.toMatch(/workout_sets|custom_exercises|personal_record|offset/i)
    expect(query.mock.calls[0]?.[0]).toContain('limit 2')
  })

  it('fails closed on a malformed aggregate instead of disguising it as zero', async () => {
    const { client, query } = fixture()
    query.mockResolvedValueOnce([{ exercise_count: 'NaN' }])
    await expect(readWorkoutHome(client, '2026-10-08')).rejects.toThrow('Invalid home exercise count')
  })
})
