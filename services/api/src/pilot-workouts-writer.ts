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
  cancelPlannedWorkout,
  confirmLiveSet,
  finishLiveWorkout,
  recordPlannedWorkoutResult,
  removeLiveSet,
  reorderLiveBlock,
  rescheduleWorkout,
  replaceLiveExercise,
  saveCompletedWorkout,
  savePlannedWorkout,
  saveLiveSetDraft,
  setClientWorkoutComment,
  setLiveExerciseComment,
  softDeleteWorkout,
  softDeletePlannedWorkout,
  startLiveWorkout,
  submitWorkoutFeedback,
  setWorkoutReview,
  askWorkoutQuestion,
  answerWorkoutQuestion,
  resolveWorkoutQuestion,
  snoozeClientAttention,
  type PilotLiveCommandResult,
  type PilotLiveStructureResult,
  type SavedPilotWorkout,
} from './workout-commands.js'
import type {
  WorkoutFeedbackRequest,
  WorkoutTrainerResponseRequest,
} from './post-workout-request.js'

export interface PilotWorkoutsWriter {
  submitFeedback(sessionToken: string, workoutId: string, feedback: WorkoutFeedbackRequest): Promise<number>
  setReview(sessionToken: string, workoutId: string, response: WorkoutTrainerResponseRequest): Promise<number>
  askQuestion(sessionToken: string, workoutId: string, question: string, expectedVersion: number): Promise<number>
  answerQuestion(sessionToken: string, workoutId: string, response: WorkoutTrainerResponseRequest): Promise<number>
  resolveQuestion(sessionToken: string, workoutId: string, expectedVersion: number): Promise<number>
  snoozeAttention(sessionToken: string, clientId: string): Promise<string>
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
  cancelPlanned(
    sessionToken: string,
    workoutId: string,
    expectedVersion: number,
  ): Promise<number>
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
  deleteWorkout(
    sessionToken: string,
    workoutId: string,
    expectedVersion: number,
  ): Promise<number>
  recordPlannedResult(
    sessionToken: string,
    draft: PlannedWorkoutDraft,
    expectedVersion: number,
  ): Promise<SavedPilotWorkout>
  reschedule(
    sessionToken: string,
    workoutId: string,
    workoutDate: string,
    startTime: string | null,
    expectedVersion: number,
  ): Promise<number>
  saveCompleted(
    sessionToken: string,
    draft: PlannedWorkoutDraft,
    expectedVersion: number | null,
  ): Promise<SavedPilotWorkout>
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
  setClientComment(
    sessionToken: string,
    workoutId: string,
    comment: string,
    expectedVersion: number,
  ): Promise<number>
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

  submitFeedback(sessionToken: string, workoutId: string, feedback: WorkoutFeedbackRequest) {
    return this.withSession(sessionToken, (client) =>
      submitWorkoutFeedback(client, workoutId, feedback))
  }

  setReview(sessionToken: string, workoutId: string, response: WorkoutTrainerResponseRequest) {
    return this.withSession(sessionToken, (client) =>
      setWorkoutReview(client, workoutId, response))
  }

  askQuestion(sessionToken: string, workoutId: string, question: string, expectedVersion: number) {
    return this.withSession(sessionToken, (client) =>
      askWorkoutQuestion(client, workoutId, question, expectedVersion))
  }

  answerQuestion(sessionToken: string, workoutId: string, response: WorkoutTrainerResponseRequest) {
    return this.withSession(sessionToken, (client) =>
      answerWorkoutQuestion(client, workoutId, response))
  }

  resolveQuestion(sessionToken: string, workoutId: string, expectedVersion: number) {
    return this.withSession(sessionToken, (client) =>
      resolveWorkoutQuestion(client, workoutId, expectedVersion))
  }

  snoozeAttention(sessionToken: string, clientId: string) {
    return this.withSession(sessionToken, (client) =>
      snoozeClientAttention(client, clientId))
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

  cancelPlanned(
    sessionToken: string,
    workoutId: string,
    expectedVersion: number,
  ): Promise<number> {
    return this.withSession(sessionToken, (client) =>
      cancelPlannedWorkout(client, workoutId, expectedVersion))
  }

  deletePlanned(
    sessionToken: string,
    workoutId: string,
    expectedVersion: number,
  ): Promise<number> {
    return this.withSession(sessionToken, (client) =>
      softDeletePlannedWorkout(client, workoutId, expectedVersion))
  }

  deleteWorkout(
    sessionToken: string,
    workoutId: string,
    expectedVersion: number,
  ): Promise<number> {
    return this.withSession(sessionToken, (client) =>
      softDeleteWorkout(client, workoutId, expectedVersion))
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

  saveCompleted(
    sessionToken: string,
    draft: PlannedWorkoutDraft,
    expectedVersion: number | null,
  ): Promise<SavedPilotWorkout> {
    return this.withSession(sessionToken, (client) =>
      saveCompletedWorkout(client, draft, expectedVersion))
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

  recordPlannedResult(
    sessionToken: string,
    draft: PlannedWorkoutDraft,
    expectedVersion: number,
  ): Promise<SavedPilotWorkout> {
    return this.withSession(sessionToken, (client) =>
      recordPlannedWorkoutResult(client, draft, expectedVersion))
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

  reschedule(
    sessionToken: string,
    workoutId: string,
    workoutDate: string,
    startTime: string | null,
    expectedVersion: number,
  ): Promise<number> {
    return this.withSession(sessionToken, (client) => rescheduleWorkout(
      client,
      workoutId,
      workoutDate,
      startTime,
      expectedVersion,
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

  setClientComment(
    sessionToken: string,
    workoutId: string,
    comment: string,
    expectedVersion: number,
  ): Promise<number> {
    return this.withSession(sessionToken, (client) => setClientWorkoutComment(
      client,
      workoutId,
      comment,
      expectedVersion,
    ))
  }
}
