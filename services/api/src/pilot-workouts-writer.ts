import { hashPilotSessionToken } from './auth/pilot-session-token.js'
import {
  PilotSessionInvalidError,
  withYandexPilotSessionTransaction,
} from './db/yandex-pilot-transaction.js'
import type { DatabasePool } from './db/types.js'
import type {
  LiveExerciseSnapshot,
  LiveSetDraft,
} from './live-workout-request.js'
import type { PlannedWorkoutDraft } from './planned-workout-request.js'
import {
  appendLiveExercise,
  appendLiveSet,
  confirmLiveSet,
  finishLiveWorkout,
  removeLiveSet,
  reorderLiveBlock,
  replaceLiveExercise,
  savePlannedWorkout,
  saveLiveSetDraft,
  setLiveExerciseComment,
  softDeletePlannedWorkout,
  startLiveWorkout,
  type PilotLiveCommandResult,
  type PilotLiveStructureResult,
  type SavedPilotWorkout,
} from './workout-commands.js'

export interface PilotWorkoutsWriter {
  appendLiveExercise(
    sessionToken: string,
    workoutId: string,
    exercise: LiveExerciseSnapshot,
    expectedVersion: number,
    operationId: string,
  ): Promise<PilotLiveStructureResult>
  appendLiveSet(
    sessionToken: string,
    exerciseId: string,
    expectedVersion: number,
    operationId: string,
  ): Promise<PilotLiveStructureResult>
  confirmLiveSet(
    sessionToken: string,
    setId: string,
    expectedVersion: number,
    operationId: string,
  ): Promise<PilotLiveCommandResult>
  deletePlanned(
    sessionToken: string,
    workoutId: string,
    expectedVersion: number,
  ): Promise<number>
  savePlanned(
    sessionToken: string,
    draft: PlannedWorkoutDraft,
    expectedVersion: number | null,
  ): Promise<SavedPilotWorkout>
  saveLiveSet(
    sessionToken: string,
    setId: string,
    draft: LiveSetDraft,
    expectedVersion: number,
    operationId: string,
  ): Promise<PilotLiveCommandResult>
  finishLive(
    sessionToken: string,
    workoutId: string,
    expectedVersion: number,
    operationId: string,
  ): Promise<PilotLiveCommandResult>
  removeLiveSet(
    sessionToken: string,
    setId: string,
    expectedVersion: number,
    operationId: string,
  ): Promise<PilotLiveStructureResult>
  reorderLiveBlock(
    sessionToken: string,
    workoutId: string,
    blockId: string,
    direction: -1 | 1,
    expectedVersion: number,
    operationId: string,
  ): Promise<PilotLiveStructureResult>
  replaceLiveExercise(
    sessionToken: string,
    workoutId: string,
    exerciseId: string,
    exercise: LiveExerciseSnapshot,
    expectedVersion: number,
    operationId: string,
  ): Promise<PilotLiveStructureResult>
  startLive(
    sessionToken: string,
    workoutId: string,
    expectedVersion: number,
    operationId: string,
  ): Promise<PilotLiveCommandResult>
  setLiveExerciseComment(
    sessionToken: string,
    exerciseId: string,
    comment: string,
    expectedVersion: number,
    operationId: string,
  ): Promise<PilotLiveStructureResult>
}

export class DatabasePilotWorkoutsWriter implements PilotWorkoutsWriter {
  constructor(private readonly pool: DatabasePool) {}

  private withSession<Result>(
    sessionToken: string,
    work: Parameters<typeof withYandexPilotSessionTransaction<Result>>[2],
  ): Promise<Result> {
    const tokenHash = hashPilotSessionToken(sessionToken)
    if (tokenHash === undefined) throw new PilotSessionInvalidError()
    return withYandexPilotSessionTransaction(this.pool, tokenHash, work)
  }

  appendLiveExercise(
    sessionToken: string,
    workoutId: string,
    exercise: LiveExerciseSnapshot,
    expectedVersion: number,
    operationId: string,
  ): Promise<PilotLiveStructureResult> {
    return this.withSession(sessionToken, (client) => appendLiveExercise(
      client,
      workoutId,
      exercise,
      expectedVersion,
      operationId,
    ))
  }

  appendLiveSet(
    sessionToken: string,
    exerciseId: string,
    expectedVersion: number,
    operationId: string,
  ): Promise<PilotLiveStructureResult> {
    return this.withSession(sessionToken, (client) => appendLiveSet(
      client,
      exerciseId,
      expectedVersion,
      operationId,
    ))
  }

  deletePlanned(
    sessionToken: string,
    workoutId: string,
    expectedVersion: number,
  ): Promise<number> {
    return this.withSession(sessionToken, (client) =>
      softDeletePlannedWorkout(client, workoutId, expectedVersion))
  }

  confirmLiveSet(
    sessionToken: string,
    setId: string,
    expectedVersion: number,
    operationId: string,
  ): Promise<PilotLiveCommandResult> {
    return this.withSession(sessionToken, (client) =>
      confirmLiveSet(client, setId, expectedVersion, operationId))
  }

  savePlanned(
    sessionToken: string,
    draft: PlannedWorkoutDraft,
    expectedVersion: number | null,
  ): Promise<SavedPilotWorkout> {
    return this.withSession(sessionToken, (client) =>
      savePlannedWorkout(client, draft, expectedVersion))
  }

  saveLiveSet(
    sessionToken: string,
    setId: string,
    draft: LiveSetDraft,
    expectedVersion: number,
    operationId: string,
  ): Promise<PilotLiveCommandResult> {
    return this.withSession(sessionToken, (client) =>
      saveLiveSetDraft(
        client,
        setId,
        draft,
        expectedVersion,
        operationId,
      ))
  }

  finishLive(
    sessionToken: string,
    workoutId: string,
    expectedVersion: number,
    operationId: string,
  ): Promise<PilotLiveCommandResult> {
    return this.withSession(sessionToken, (client) =>
      finishLiveWorkout(client, workoutId, expectedVersion, operationId))
  }

  removeLiveSet(
    sessionToken: string,
    setId: string,
    expectedVersion: number,
    operationId: string,
  ): Promise<PilotLiveStructureResult> {
    return this.withSession(sessionToken, (client) => removeLiveSet(
      client,
      setId,
      expectedVersion,
      operationId,
    ))
  }

  reorderLiveBlock(
    sessionToken: string,
    workoutId: string,
    blockId: string,
    direction: -1 | 1,
    expectedVersion: number,
    operationId: string,
  ): Promise<PilotLiveStructureResult> {
    return this.withSession(sessionToken, (client) => reorderLiveBlock(
      client,
      workoutId,
      blockId,
      direction,
      expectedVersion,
      operationId,
    ))
  }

  replaceLiveExercise(
    sessionToken: string,
    workoutId: string,
    exerciseId: string,
    exercise: LiveExerciseSnapshot,
    expectedVersion: number,
    operationId: string,
  ): Promise<PilotLiveStructureResult> {
    return this.withSession(sessionToken, (client) => replaceLiveExercise(
      client,
      workoutId,
      exerciseId,
      exercise,
      expectedVersion,
      operationId,
    ))
  }

  startLive(
    sessionToken: string,
    workoutId: string,
    expectedVersion: number,
    operationId: string,
  ): Promise<PilotLiveCommandResult> {
    return this.withSession(sessionToken, (client) =>
      startLiveWorkout(client, workoutId, expectedVersion, operationId))
  }

  setLiveExerciseComment(
    sessionToken: string,
    exerciseId: string,
    comment: string,
    expectedVersion: number,
    operationId: string,
  ): Promise<PilotLiveStructureResult> {
    return this.withSession(sessionToken, (client) => setLiveExerciseComment(
      client,
      exerciseId,
      comment,
      expectedVersion,
      operationId,
    ))
  }
}
