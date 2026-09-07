import type { Workout } from '../../shared/domain'
import { formatLocalDate, type LocalDate } from '../../shared/local-date'
import type { ClientProgressPresentation } from './client-progress-presentation'
import type { WorkoutRegularityProgress } from './workout-regularity-progress'

export const TRAINER_PROGRESS_SIGNALS_POLICY = {
  maximumSignals: 3,
  minimumWorkoutsForAssessment: 2,
  longBreakDays: 14,
} as const

export type TrainerProgressSignalKind =
  | 'insufficient_data'
  | 'contradiction'
  | 'break'
  | 'criterion_without_data'
  | 'plan_deviation'
  | 'discussion_question'

export type TrainerProgressSignal = {
  id: string
  kind: TrainerProgressSignalKind
  label: string
  fact: string
  question: string
  factIds: string[]
  priority: number
}

export type TrainerProgressSignalsInput = {
  goal?: ClientProgressPresentation['goal']
  regularity: WorkoutRegularityProgress
  currentWorkouts?: readonly Workout[]
  summaryCompletedWorkouts: number
  today: LocalDate
}

function workoutNoun(count: number): string {
  const mod100 = count % 100
  const mod10 = count % 10
  if (mod100 >= 11 && mod100 <= 14) return 'тренировок'
  if (mod10 === 1) return 'тренировка'
  if (mod10 >= 2 && mod10 <= 4) return 'тренировки'
  return 'тренировок'
}

function unresolvedQuestion(workouts: readonly Workout[]): Workout | undefined {
  return [...workouts]
    .filter((workout) => Boolean(workout.clientQuestion?.trim()) && !workout.clientQuestionResolvedAt)
    .sort((left, right) => right.workoutDate.localeCompare(left.workoutDate))[0]
}

export function buildTrainerProgressSignals(input: TrainerProgressSignalsInput): TrainerProgressSignal[] {
  const signals: TrainerProgressSignal[] = []
  const workouts = input.currentWorkouts
  const questionWorkout = workouts ? unresolvedQuestion(workouts) : undefined
  if (questionWorkout?.clientQuestion) signals.push({
    id: `discussion:${questionWorkout.id}`,
    kind: 'discussion_question',
    label: 'Вопрос для обсуждения',
    fact: `Клиент оставил вопрос после тренировки ${formatLocalDate(questionWorkout.workoutDate)}`,
    question: questionWorkout.clientQuestion.trim(),
    factIds: [`workout-question:${questionWorkout.id}`],
    priority: 130,
  })

  if (workouts) {
    const completed = workouts.filter((workout) => workout.status === 'done').length
    if (completed !== input.summaryCompletedWorkouts) signals.push({
      id: `contradiction:completed:${input.summaryCompletedWorkouts}:${completed}`,
      kind: 'contradiction',
      label: 'Нужно сверить данные',
      fact: `В анализе учтено ${input.summaryCompletedWorkouts} ${workoutNoun(input.summaryCompletedWorkouts)}, а в загруженной истории периода — ${completed}.`,
      question: 'Нужно ли обновить анализ перед обсуждением результатов?',
      factIds: ['summary:completed-workouts', input.regularity.factId],
      priority: 125,
    })
  }

  const criterionWithoutData = input.goal?.criteria?.find((criterion) =>
    criterion.current === 'Нет данных' || criterion.sufficiency === 'Нет замеров')
  if (criterionWithoutData) signals.push({
    id: `criterion-without-data:${criterionWithoutData.id}`,
    kind: 'criterion_without_data',
    label: 'Критерий без данных',
    fact: `${criterionWithoutData.label}: ориентир задан, подтверждённого результата пока нет.`,
    question: 'Какой результат нужно зафиксировать первым, чтобы начать оценку цели?',
    factIds: [`goal-criterion:${criterionWithoutData.id}`],
    priority: 120,
  })

  if (workouts) {
    const deviations = workouts.filter((workout) => workout.status === 'cancelled'
      || (workout.workoutDate < input.today && (workout.status === 'planned' || workout.status === 'in_progress')))
    if (deviations.length > 0) signals.push({
      id: `plan-deviation:${deviations.map((workout) => workout.id).sort().join(':')}`,
      kind: 'plan_deviation',
      label: 'Отклонение от плана',
      fact: `${deviations.length} ${workoutNoun(deviations.length)} из периода ${deviations.length === 1 ? 'не завершена' : 'не завершены'} по плану.`,
      question: 'Стоит ли уточнить, что помешало выполнить план и остаётся ли он актуальным?',
      factIds: deviations.map((workout) => `workout:${workout.id}`),
      priority: 115,
    })
  }

  if (input.regularity.longestGapDays !== null
    && input.regularity.longestGapDays >= TRAINER_PROGRESS_SIGNALS_POLICY.longBreakDays) signals.push({
    id: `break:${input.regularity.longestGapDays}`,
    kind: 'break',
    label: 'Перерыв в тренировках',
    fact: `Самый длинный интервал между завершёнными тренировками — ${input.regularity.longestGapDays} дн.`,
    question: 'Нужно ли обсудить, как этот перерыв повлиял на текущий ритм?',
    factIds: [input.regularity.factId],
    priority: 110,
  })

  if (input.regularity.completedWorkouts < TRAINER_PROGRESS_SIGNALS_POLICY.minimumWorkoutsForAssessment) signals.push({
    id: `insufficient-data:${input.regularity.completedWorkouts}`,
    kind: 'insufficient_data',
    label: 'Недостаточно данных',
    fact: `За период подтверждено ${input.regularity.completedWorkouts} ${workoutNoun(input.regularity.completedWorkouts)} — устойчивую динамику пока нельзя оценить.`,
    question: 'Какой следующий результат будет достаточно сопоставимым для оценки?',
    factIds: [input.regularity.factId],
    priority: 100,
  })

  return signals
    .sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id))
    .slice(0, TRAINER_PROGRESS_SIGNALS_POLICY.maximumSignals)
}
