import { hashPilotSessionToken } from './auth/pilot-session-token.js'
import {
  PilotSessionInvalidError,
  withYandexPilotSessionTransaction,
} from './db/yandex-pilot-transaction.js'
import type { DatabasePool } from './db/types.js'
import type { LiveSetDraft } from './live-workout-request.js'
import type { PlannedWorkoutDraft } from './planned-workout-request.js'
import {
  confirmLiveSet,
  finishLiveWorkout,
  savePlannedWorkout,
  saveLiveSetDraft,
  softDeletePlannedWorkout,
  startLiveWorkout,
  type PilotLiveCommandResult,
  type SavedPilotWorkout,
} from './workout-commands.js'

export interface PilotWorkoutsWriter {
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
  startLive(
    sessionToken: string,
    workoutId: string,
    expectedVersion: number,
    operationId: string,
  ): Promise<PilotLiveCommandResult>
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

  startLive(
    sessionToken: string,
    workoutId: string,
    expectedVersion: number,
    operationId: string,
  ): Promise<PilotLiveCommandResult> {
    return this.withSession(sessionToken, (client) =>
      startLiveWorkout(client, workoutId, expectedVersion, operationId))
  }
}
