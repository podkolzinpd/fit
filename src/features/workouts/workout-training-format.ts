import type { TrainerFinancePackage } from '../../data/repositories/trainer-finance.repository'
import type { WorkoutTrainingFormat } from '../../shared/domain'

export function defaultWorkoutTrainingFormat(
  packages: readonly TrainerFinancePackage[],
  workoutDate: string,
): WorkoutTrainingFormat {
  const active = packages.filter((item) => item.closedAt === null
    && item.startsOn <= workoutDate
    && (item.endsOn === null || item.endsOn >= workoutDate))
  if (active.some((item) => item.kind === 'online_coaching')) return 'self'
  if (active.some((item) => item.kind === 'session_pack' && item.sessionsRemaining > 0)) return 'with_trainer'
  return 'self'
}

export function workoutTrainingFormatLabel(format: WorkoutTrainingFormat): string {
  return format === 'with_trainer' ? 'С тренером' : 'Самостоятельно'
}
