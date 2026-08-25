import type { WorkoutDraft } from '../../shared/domain'

export function assistantWorkoutSaveInput(
  requestId: string,
  clientId: string,
  workoutDate: string,
  startTime: string,
  exercises: WorkoutDraft['exercises'],
) {
  return { workout: { requestId, clientId, workoutDate, startTime, exercises } }
}
