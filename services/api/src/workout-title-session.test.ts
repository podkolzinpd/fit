import { describe, expect, it, vi } from 'vitest'
import type { DatabasePool } from './db/types.js'
import { DatabasePilotWorkoutsWriter } from './pilot-workouts-writer.js'

describe('native workout rename session boundary', () => {
  it.each(['legacy', 'read-only'])('rejects %s credentials before connecting to the database', async kind => {
    const connect = vi.fn()
    const writer = new DatabasePilotWorkoutsWriter({ connect } as unknown as DatabasePool)
    const token = 's'.repeat(43)
    await expect(writer.rename(kind === 'legacy' ? token : { accessMode: 'read_only', token }, '10000000-0000-4000-8000-000000000001', 'Ноги', 1)).rejects.toMatchObject({ failure: 'forbidden' })
    expect(connect).not.toHaveBeenCalled()
  })
})
