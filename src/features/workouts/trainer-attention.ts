import type { Client, ClientAttentionPreference, TrainerAttentionWorkout, Workout } from '../../shared/domain'
import { daysBetween, type LocalDate } from '../../shared/local-date'

export type TrainerActionReason = 'question' | 'discomfort' | 'past_plan'

export interface TrainerActionItem {
  clientId: string
  clientName: string
  workoutId: string
  reason: TrainerActionReason
  title: string
  detail: string
  actionLabel: string
}

export interface TrainerPlanningItem {
  clientId: string
  clientName: string
  title: string
  detail: string
}

function newestAttention(rows: TrainerAttentionWorkout[], reason: 'question' | 'discomfort') {
  return [...rows]
    .filter((row) => reason === 'question' ? Boolean(row.clientQuestion) : row.discomfort)
    .sort((a, b) => {
      const left = reason === 'question' ? a.clientQuestionAskedAt : a.feedbackSubmittedAt
      const right = reason === 'question' ? b.clientQuestionAskedAt : b.feedbackSubmittedAt
      return (right ?? b.workoutDate).localeCompare(left ?? a.workoutDate)
    })[0]
}

export function trainerActionItems(
  clients: Client[],
  workouts: Workout[],
  attention: TrainerAttentionWorkout[],
  today: LocalDate,
): TrainerActionItem[] {
  return clients.flatMap((client): TrainerActionItem[] => {
    const clientAttention = attention.filter((row) => row.clientId === client.id)
    const question = newestAttention(clientAttention, 'question')
    if (question?.clientQuestion) return [{
      clientId: client.id,
      clientName: client.fullName,
      workoutId: question.workoutId,
      reason: 'question',
      title: 'Вопрос тренеру',
      detail: question.clientQuestion,
      actionLabel: 'Ответить',
    }]

    const discomfort = newestAttention(clientAttention, 'discomfort')
    if (discomfort) return [{
      clientId: client.id,
      clientName: client.fullName,
      workoutId: discomfort.workoutId,
      reason: 'discomfort',
      title: 'Отмечен дискомфорт',
      detail: discomfort.clientComment || 'Откройте итог тренировки',
      actionLabel: 'Посмотреть',
    }]

    const pastPlan = workouts
      .filter((workout) => workout.clientId === client.id && workout.status === 'planned' && workout.workoutDate < today)
      .sort((a, b) => b.workoutDate.localeCompare(a.workoutDate))[0]
    if (!pastPlan) return []
    return [{
      clientId: client.id,
      clientName: client.fullName,
      workoutId: pastPlan.id,
      reason: 'past_plan',
      title: 'Прошлый план ждёт решения',
      detail: pastPlan.workoutDate,
      actionLabel: 'Выбрать действие',
    }]
  })
}

export function trainerPlanningItems(
  clients: Client[],
  workouts: Workout[],
  preferences: ClientAttentionPreference[],
  actionClientIds: ReadonlySet<string>,
  today: LocalDate,
  now = new Date(),
): TrainerPlanningItem[] {
  const snoozed = new Map(preferences.map((item) => [item.clientId, item.snoozedUntil]))
  return clients.flatMap((client) => {
    if (actionClientIds.has(client.id)) return []
    const until = snoozed.get(client.id)
    if (until && new Date(until) > now) return []
    const clientWorkouts = workouts.filter((workout) => workout.clientId === client.id)
    const hasNext = clientWorkouts.some((workout) => workout.status === 'in_progress'
      || (workout.status === 'planned' && workout.workoutDate >= today))
    if (hasNext) return []

    const latestDone = clientWorkouts
      .filter((workout) => workout.status === 'done')
      .sort((a, b) => b.workoutDate.localeCompare(a.workoutDate))[0]
    if (!clientWorkouts.length) return [{
      clientId: client.id,
      clientName: client.fullName,
      title: 'Тренировки ещё не добавлены',
      detail: 'Можно запланировать первую тренировку',
    }]
    if (!latestDone || daysBetween(latestDone.workoutDate, today) < 30) return [{
      clientId: client.id,
      clientName: client.fullName,
      title: 'Следующая тренировка не запланирована',
      detail: latestDone ? `Последняя тренировка: ${latestDone.workoutDate}` : 'В истории пока нет завершённых тренировок',
    }]
    return [{
      clientId: client.id,
      clientName: client.fullName,
      title: 'Следующая тренировка не запланирована',
      detail: `Последняя тренировка: ${latestDone.workoutDate}`,
    }]
  })
}
