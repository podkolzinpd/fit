import { describe, expect, it } from 'vitest'
import { savePlannedWorkout } from './workout-commands.js'
import type { PlannedWorkoutDraft } from './planned-workout-request.js'
import type { DatabaseClient } from './db/types.js'

describe('planned save diagnostics', () => {
  const draft: PlannedWorkoutDraft = { id: null, clientId: '00000000-0000-4000-8000-000000000001',
    workoutDate: '2026-10-22', startTime: null, endTime: null, notes: 'private transcript', exercises: [] }
  it.each(['save', 'stage', 'format', 'notification'] as const)('exports only a fixed diagnostic for %s failure', async (step) => {
    let calls = 0
    const client: DatabaseClient = { query<Row>() {
      if (calls++ === ['save', 'stage', 'format', 'notification'].indexOf(step)) return Promise.reject(new Error('workout_forbidden'))
      return Promise.resolve([{ workout_id: '00000000-0000-4000-8000-000000000002', version: '1' }] as unknown as Row[])
    } }
    const error = await savePlannedWorkout(client, draft, null).catch((error: unknown) => error)
    expect(error).toMatchObject({ failure: 'forbidden', planSaveDiagnostic: { step, reason: 'forbidden' } })
    expect(JSON.stringify(error)).not.toMatch(/private transcript|00000000/)
  })
})
