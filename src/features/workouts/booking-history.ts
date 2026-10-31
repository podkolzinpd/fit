import { copyWorkout } from '../../data/repositories/workout-rules'
import type { Workout, WorkoutDraft } from '../../shared/domain'

/** Reuse historical plan conversion, but the appointment owns its identity. */
export function historyPlanForAppointment(target: Workout, source: Workout): WorkoutDraft {
  if (target.status !== 'planned') throw new Error('Эта тренировка уже начата или завершена. Обновите запись.')
  if (source.status !== 'done' || source.clientId !== target.clientId || source.id === target.id) throw new Error('Выберите завершённую тренировку этого клиента.')
  if (source.exercises.length === 0) throw new Error('В этой тренировке нет упражнений для повторения.')
  const copied = copyWorkout(source, target.workoutDate)
  return { ...copied, id: target.id, version: target.version,
    clientId: target.clientId, startTime: target.startTime ?? undefined, endTime: target.endTime ?? undefined,
    title: target.title?.trim() ? target.title : target.favoriteTitle?.trim() || copied.title, notes: target.notes ?? source.notes ?? undefined,
    stageId: target.stageId, trainingFormat: target.trainingFormat, prepSeconds: target.prepSeconds,
    executionMode: target.executionMode,
  }
}
