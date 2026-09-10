import {
  withYandexActorSession,
  type YandexActorSessionInput,
} from './yandex-actor-session.js'
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
  removeLiveExercise,
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
  submitFeedback(sessionToken: YandexActorSessionInput, workoutId: string, feedback: WorkoutFeedbackRequest): Promise<number>
  setReview(sessionToken: YandexActorSessionInput, workoutId: string, response: WorkoutTrainerResponseRequest): Promise<number>
  askQuestion(sessionToken: YandexActorSessionInput, workoutId: string, question: string, expectedVersion: number): Promise<number>
  answerQuestion(sessionToken: YandexActorSessionInput, workoutId: string, response: WorkoutTrainerResponseRequest): Promise<number>
  resolveQuestion(sessionToken: YandexActorSessionInput, workoutId: string, expectedVersion: number): Promise<number>
  snoozeAttention(sessionToken: YandexActorSessionInput, clientId: string): Promise<string>
  appendLiveExercise(
    sessionToken: YandexActorSessionInput,
    workoutId: string,
    exercise: LiveExerciseSnapshot,
    expectedVersion: number,
    operationId: string,
  ): Promise<PilotLiveStructureResult>
  appendLiveSet(
    sessionToken: YandexActorSessionInput,
    exerciseId: string,
    expectedVersion: number,
    operationId: string,
  ): Promise<PilotLiveStructureResult>
  cancelPlanned(
    sessionToken: YandexActorSessionInput,
    workoutId: string,
    expectedVersion: number,
  ): Promise<number>
  confirmLiveSet(
    sessionToken: YandexActorSessionInput,
    setId: string,
    expectedVersion: number,
    operationId: string,
  ): Promise<PilotLiveCommandResult>
  deletePlanned(
    sessionToken: YandexActorSessionInput,
    workoutId: string,
    expectedVersion: number,
  ): Promise<number>
  deleteWorkout(
    sessionToken: YandexActorSessionInput,
    workoutId: string,
    expectedVersion: number,
  ): Promise<number>
  recordPlannedResult(
    sessionToken: YandexActorSessionInput,
    draft: PlannedWorkoutDraft,
    expectedVersion: number,
  ): Promise<SavedPilotWorkout>
  reschedule(
    sessionToken: YandexActorSessionInput,
    workoutId: string,
    workoutDate: string,
    startTime: string | null,
    expectedVersion: number,
  ): Promise<number>
  saveCompleted(
    sessionToken: YandexActorSessionInput,
    draft: PlannedWorkoutDraft,
    expectedVersion: number | null,
  ): Promise<SavedPilotWorkout>
  savePlanned(
    sessionToken: YandexActorSessionInput,
    draft: PlannedWorkoutDraft,
    expectedVersion: number | null,
  ): Promise<SavedPilotWorkout>
  saveLiveSet(
    sessionToken: YandexActorSessionInput,
    setId: string,
    draft: LiveSetDraft,
    expectedVersion: number,
    operationId: string,
  ): Promise<PilotLiveCommandResult>
  finishLive(
    sessionToken: YandexActorSessionInput,
    workoutId: string,
    expectedVersion: number,
    operationId: string,
  ): Promise<PilotLiveCommandResult>
  removeLiveSet(
    sessionToken: YandexActorSessionInput,
    setId: string,
    expectedVersion: number,
    operationId: string,
  ): Promise<PilotLiveStructureResult>
  removeLiveExercise(
    sessionToken: YandexActorSessionInput,
    workoutId: string,
    exerciseId: string,
    expectedVersion: number,
    operationId: string,
  ): Promise<PilotLiveStructureResult>
  reorderLiveBlock(
    sessionToken: YandexActorSessionInput,
    workoutId: string,
    blockId: string,
    direction: -1 | 1,
    expectedVersion: number,
    operationId: string,
  ): Promise<PilotLiveStructureResult>
  replaceLiveExercise(
    sessionToken: YandexActorSessionInput,
    workoutId: string,
    exerciseId: string,
    exercise: LiveExerciseSnapshot,
    expectedVersion: number,
    operationId: string,
  ): Promise<PilotLiveStructureResult>
  startLive(
    sessionToken: YandexActorSessionInput,
    workoutId: string,
    expectedVersion: number,
    operationId: string,
  ): Promise<PilotLiveCommandResult>
  setLiveExerciseComment(
    sessionToken: YandexActorSessionInput,
    exerciseId: string,
    comment: string,
    expectedVersion: number,
    operationId: string,
  ): Promise<PilotLiveStructureResult>
  setClientComment(
    sessionToken: YandexActorSessionInput,
    workoutId: string,
    comment: string,
    expectedVersion: number,
  ): Promise<number>
}

export class DatabasePilotWorkoutsWriter implements PilotWorkoutsWriter {
  constructor(private readonly pool: DatabasePool) {}

  private withSession<Result>(
    sessionToken: YandexActorSessionInput,
    work: Parameters<typeof withYandexActorSession<Result>>[2],
  ): Promise<Result> {
    return withYandexActorSession(this.pool, sessionToken, work)
  }

  submitFeedback(sessionToken: YandexActorSessionInput, workoutId: string, feedback: WorkoutFeedbackRequest) {
    return this.withSession(sessionToken, (client) =>
      submitWorkoutFeedback(client, workoutId, feedback))
  }

  setReview(sessionToken: YandexActorSessionInput, workoutId: string, response: WorkoutTrainerResponseRequest) {
    return this.withSession(sessionToken, (client) =>
      setWorkoutReview(client, workoutId, response))
  }

  askQuestion(sessionToken: YandexActorSessionInput, workoutId: string, question: string, expectedVersion: number) {
    return this.withSession(sessionToken, (client) =>
      askWorkoutQuestion(client, workoutId, question, expectedVersion))
  }

  answerQuestion(sessionToken: YandexActorSessionInput, workoutId: string, response: WorkoutTrainerResponseRequest) {
    return this.withSession(sessionToken, (client) =>
      answerWorkoutQuestion(client, workoutId, response))
  }

  resolveQuestion(sessionToken: YandexActorSessionInput, workoutId: string, expectedVersion: number) {
    return this.withSession(sessionToken, (client) =>
      resolveWorkoutQuestion(client, workoutId, expectedVersion))
  }

  snoozeAttention(sessionToken: YandexActorSessionInput, clientId: string) {
    return this.withSession(sessionToken, (client) =>
      snoozeClientAttention(client, clientId))
  }

  appendLiveExercise(
    sessionToken: YandexActorSessionInput,
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
    sessionToken: YandexActorSessionInput,
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
    sessionToken: YandexActorSessionInput,
    workoutId: string,
    expectedVersion: number,
  ): Promise<number> {
    return this.withSession(sessionToken, (client) =>
      cancelPlannedWorkout(client, workoutId, expectedVersion))
  }

  deletePlanned(
    sessionToken: YandexActorSessionInput,
    workoutId: string,
    expectedVersion: number,
  ): Promise<number> {
    return this.withSession(sessionToken, (client) =>
      softDeletePlannedWorkout(client, workoutId, expectedVersion))
  }

  deleteWorkout(
    sessionToken: YandexActorSessionInput,
    workoutId: string,
    expectedVersion: number,
  ): Promise<number> {
    return this.withSession(sessionToken, (client) =>
      softDeleteWorkout(client, workoutId, expectedVersion))
  }

  confirmLiveSet(
    sessionToken: YandexActorSessionInput,
    setId: string,
    expectedVersion: number,
    operationId: string,
  ): Promise<PilotLiveCommandResult> {
    return this.withSession(sessionToken, (client) =>
      confirmLiveSet(client, setId, expectedVersion, operationId))
  }

  savePlanned(
    sessionToken: YandexActorSessionInput,
    draft: PlannedWorkoutDraft,
    expectedVersion: number | null,
  ): Promise<SavedPilotWorkout> {
    return this.withSession(sessionToken, (client) =>
      savePlannedWorkout(client, draft, expectedVersion))
  }

  saveCompleted(
    sessionToken: YandexActorSessionInput,
    draft: PlannedWorkoutDraft,
    expectedVersion: number | null,
  ): Promise<SavedPilotWorkout> {
    return this.withSession(sessionToken, (client) =>
      saveCompletedWorkout(client, draft, expectedVersion))
  }

  saveLiveSet(
    sessionToken: YandexActorSessionInput,
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
    sessionToken: YandexActorSessionInput,
    workoutId: string,
    expectedVersion: number,
    operationId: string,
  ): Promise<PilotLiveCommandResult> {
    return this.withSession(sessionToken, (client) =>
      finishLiveWorkout(client, workoutId, expectedVersion, operationId))
  }

  recordPlannedResult(
    sessionToken: YandexActorSessionInput,
    draft: PlannedWorkoutDraft,
    expectedVersion: number,
  ): Promise<SavedPilotWorkout> {
    return this.withSession(sessionToken, (client) =>
      recordPlannedWorkoutResult(client, draft, expectedVersion))
  }

  removeLiveSet(
    sessionToken: YandexActorSessionInput,
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

  removeLiveExercise(
    sessionToken: YandexActorSessionInput,
    workoutId: string,
    exerciseId: string,
    expectedVersion: number,
    operationId: string,
  ): Promise<PilotLiveStructureResult> {
    return this.withSession(sessionToken, (client) => removeLiveExercise(
      client, workoutId, exerciseId, expectedVersion, operationId,
    ))
  }

  reorderLiveBlock(
    sessionToken: YandexActorSessionInput,
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
    sessionToken: YandexActorSessionInput,
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
    sessionToken: YandexActorSessionInput,
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
    sessionToken: YandexActorSessionInput,
    workoutId: string,
    expectedVersion: number,
    operationId: string,
  ): Promise<PilotLiveCommandResult> {
    return this.withSession(sessionToken, (client) =>
      startLiveWorkout(client, workoutId, expectedVersion, operationId))
  }

  setLiveExerciseComment(
    sessionToken: YandexActorSessionInput,
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
    sessionToken: YandexActorSessionInput,
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
