import { hashPilotSessionToken } from './auth/pilot-session-token.js'
import {
  PilotSessionInvalidError,
  withYandexPilotSessionTransaction,
} from './db/yandex-pilot-transaction.js'
import type { DatabasePool } from './db/types.js'
import type { PlannedWorkoutDraft } from './planned-workout-request.js'
import {
  savePlannedWorkout,
  softDeletePlannedWorkout,
  type SavedPilotWorkout,
} from './workout-commands.js'

export interface PilotWorkoutsWriter {
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

  savePlanned(
    sessionToken: string,
    draft: PlannedWorkoutDraft,
    expectedVersion: number | null,
  ): Promise<SavedPilotWorkout> {
    return this.withSession(sessionToken, (client) =>
      savePlannedWorkout(client, draft, expectedVersion))
  }
}
