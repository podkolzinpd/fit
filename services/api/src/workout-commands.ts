import type { QueryResultRow } from 'pg'

import type { DatabaseClient } from './db/types.js'
import type {
  LiveExerciseSnapshot,
  LiveSetDraft,
} from './live-workout-request.js'
import type { PlannedWorkoutDraft } from './planned-workout-request.js'

interface SavedWorkoutRow extends QueryResultRow {
  workout_id: string
  version: string
}

interface DeletedWorkoutRow extends QueryResultRow {
  version: string
}

interface LiveCommandRow extends QueryResultRow {
  replayed: boolean
  version: string
}

interface LiveStructureRow extends LiveCommandRow {
  resource_id: string | null
}

export type PilotWorkoutCommandFailure =
  | 'active'
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

export interface PilotLiveCommandResult {
  replayed: boolean
  version: number
}

export interface PilotLiveStructureResult extends PilotLiveCommandResult {
  resourceId: string
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
  if (message === 'live_set_conflict') {
    return new PilotWorkoutCommandError('conflict')
  }
  if (message === 'exercise_already_started') {
    return new PilotWorkoutCommandError('conflict')
  }
  if (message === 'active_workout_exists') {
    return new PilotWorkoutCommandError('active')
  }
  if (message === 'workout_invalid') {
    return new PilotWorkoutCommandError('invalid')
  }
  if (
    message === 'exercise_not_found'
    || message === 'block_not_found'
    || message === 'set_not_found'
  ) {
    return new PilotWorkoutCommandError('not_found')
  }
  if (
    message === 'live_set_empty'
    || message === 'last_set_cannot_be_removed'
    || message === 'operation_reused'
  ) {
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

function runLiveCommand(
  client: DatabaseClient,
  query: string,
  values: readonly unknown[],
): Promise<PilotLiveCommandResult> {
  return runCommand(async () => {
    const rows = await client.query<LiveCommandRow>(query, values)
    const result = rows[0]
    if (result === undefined) throw new Error('Live command returned no result')
    return {
      replayed: result.replayed,
      version: safeVersion(result.version),
    }
  })
}

function runLiveStructureCommand(
  client: DatabaseClient,
  query: string,
  values: readonly unknown[],
): Promise<PilotLiveStructureResult> {
  return runCommand(async () => {
    const rows = await client.query<LiveStructureRow>(query, values)
    const result = rows[0]
    if (result === undefined) {
      throw new Error('Live structure command returned no result')
    }
    if (result.resource_id === null) {
      throw new Error('Live structure command returned no resource')
    }
    return {
      replayed: result.replayed,
      resourceId: result.resource_id,
      version: safeVersion(result.version),
    }
  })
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

export function startLiveWorkout(
  client: DatabaseClient,
  workoutId: string,
  expectedVersion: number,
  operationId: string,
): Promise<PilotLiveCommandResult> {
  return runLiveCommand(
    client,
    'select version, replayed from public.start_live_workout($1, $2, $3)',
    [workoutId, expectedVersion, operationId],
  )
}

export function saveLiveSetDraft(
  client: DatabaseClient,
  setId: string,
  draft: LiveSetDraft,
  expectedVersion: number,
  operationId: string,
): Promise<PilotLiveCommandResult> {
  return runLiveCommand(
    client,
    `
      select version, replayed
      from public.save_live_set_draft($1, $2::jsonb, $3, $4)
    `,
    [setId, JSON.stringify(draft), expectedVersion, operationId],
  )
}

export function confirmLiveSet(
  client: DatabaseClient,
  setId: string,
  expectedVersion: number,
  operationId: string,
): Promise<PilotLiveCommandResult> {
  return runLiveCommand(
    client,
    'select version, replayed from public.confirm_live_set($1, $2, $3)',
    [setId, expectedVersion, operationId],
  )
}

export function finishLiveWorkout(
  client: DatabaseClient,
  workoutId: string,
  expectedVersion: number,
  operationId: string,
): Promise<PilotLiveCommandResult> {
  return runLiveCommand(
    client,
    'select version, replayed from public.finish_live_workout($1, $2, $3)',
    [workoutId, expectedVersion, operationId],
  )
}

export function appendLiveExercise(
  client: DatabaseClient,
  workoutId: string,
  exercise: LiveExerciseSnapshot,
  expectedVersion: number,
  operationId: string,
): Promise<PilotLiveStructureResult> {
  return runLiveStructureCommand(
    client,
    `
      select resource_id, version, replayed
      from public.append_live_exercise($1, $2::jsonb, $3, $4)
    `,
    [workoutId, JSON.stringify(exercise), expectedVersion, operationId],
  )
}

export function appendLiveSet(
  client: DatabaseClient,
  exerciseId: string,
  expectedVersion: number,
  operationId: string,
): Promise<PilotLiveStructureResult> {
  return runLiveStructureCommand(
    client,
    `
      select resource_id, version, replayed
      from public.append_live_set($1, $2, $3)
    `,
    [exerciseId, expectedVersion, operationId],
  )
}

export function removeLiveSet(
  client: DatabaseClient,
  setId: string,
  expectedVersion: number,
  operationId: string,
): Promise<PilotLiveStructureResult> {
  return runLiveStructureCommand(
    client,
    `
      select resource_id, version, replayed
      from public.remove_live_set($1, $2, $3)
    `,
    [setId, expectedVersion, operationId],
  )
}

export function reorderLiveBlock(
  client: DatabaseClient,
  workoutId: string,
  blockId: string,
  direction: -1 | 1,
  expectedVersion: number,
  operationId: string,
): Promise<PilotLiveStructureResult> {
  return runLiveStructureCommand(
    client,
    `
      select resource_id, version, replayed
      from public.reorder_live_block($1, $2, $3, $4, $5)
    `,
    [workoutId, blockId, direction, expectedVersion, operationId],
  )
}

export function replaceLiveExercise(
  client: DatabaseClient,
  workoutId: string,
  exerciseId: string,
  exercise: LiveExerciseSnapshot,
  expectedVersion: number,
  operationId: string,
): Promise<PilotLiveStructureResult> {
  return runLiveStructureCommand(
    client,
    `
      select resource_id, version, replayed
      from public.replace_live_exercise($1, $2, $3::jsonb, $4, $5)
    `,
    [
      workoutId,
      exerciseId,
      JSON.stringify(exercise),
      expectedVersion,
      operationId,
    ],
  )
}

export function setLiveExerciseComment(
  client: DatabaseClient,
  exerciseId: string,
  comment: string,
  expectedVersion: number,
  operationId: string,
): Promise<PilotLiveStructureResult> {
  return runLiveStructureCommand(
    client,
    `
      select resource_id, version, replayed
      from public.set_live_exercise_comment($1, $2, $3, $4)
    `,
    [exerciseId, comment, expectedVersion, operationId],
  )
}
