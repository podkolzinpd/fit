import type { LocalDate } from '../../shared/local-date'
import type { WorkoutSetDraft } from '../../shared/domain'

export interface PreviousExerciseResult { workoutDate: LocalDate; sets: WorkoutSetDraft[] }
