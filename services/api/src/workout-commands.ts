import type { QueryResultRow } from 'pg'

import type { DatabaseClient } from './db/types.js'
import type { PlannedWorkoutDraft } from './planned-workout-request.js'

interface SavedWorkoutRow extends QueryResultRow {
  workout_id: string
  version: string
}

interface DeletedWorkoutRow extends QueryResultRow {
  version: string
}

export type PilotWorkoutCommandFailure =
  | 'conflict'
  | 'forbidden'
  | 'invalid'
  | 'not_found'

export class PilotWorkoutCommandError extends Error {
  constructor(readonly failure: PilotWorkoutCommandFailure) {
    super(`Pilot workout command failed: ${failure}`)
    this.name = 'PilotWorkoutCommandError'
  }
}

export interface SavedPilotWorkout {
  id: string
  version: number
}

function commandError(error: unknown): PilotWorkoutCommandError | undefined {
  if (typeof error !== 'object' || error === null || !('message' in error)) {
    return undefined
  }
  const message = error.message
  if (message === 'workout_forbidden') {
    return new PilotWorkoutCommandError('forbidden')
  }
  if (message === 'workout_not_found') {
    return new PilotWorkoutCommandError('not_found')
  }
  if (message === 'workout_conflict') {
    return new PilotWorkoutCommandError('conflict')
  }
  if (message === 'workout_invalid') {
    return new PilotWorkoutCommandError('invalid')
  }
  return undefined
}

function safeVersion(value: string): number {
  const version = Number(value)
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new Error('Workout command returned an invalid version')
  }
  return version
}

async function runCommand<Result>(work: () => Promise<Result>): Promise<Result> {
  try {
    return await work()
  } catch (error) {
    throw commandError(error) ?? error
  }
}

export function savePlannedWorkout(
  client: DatabaseClient,
  draft: PlannedWorkoutDraft,
  expectedVersion: number | null,
): Promise<SavedPilotWorkout> {
  return runCommand(async () => {
    const rows = await client.query<SavedWorkoutRow>(
      `
        select workout_id, version
        from public.save_planned_workout($1::jsonb, $2)
      `,
      [JSON.stringify(draft), expectedVersion],
    )
    const saved = rows[0]
    if (saved === undefined) throw new Error('Workout was not saved')
    return { id: saved.workout_id, version: safeVersion(saved.version) }
  })
}

export function softDeletePlannedWorkout(
  client: DatabaseClient,
  workoutId: string,
  expectedVersion: number,
): Promise<number> {
  return runCommand(async () => {
    const rows = await client.query<DeletedWorkoutRow>(
      'select public.soft_delete_planned_workout($1, $2) as version',
      [workoutId, expectedVersion],
    )
    const version = rows[0]?.version
    if (version === undefined) throw new Error('Workout was not deleted')
    return safeVersion(version)
  })
}
