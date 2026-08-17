import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { ClientGoal, TrainerReaction, Workout, WorkoutPersonalRecord, WorkoutRegularity } from '../../shared/domain'
import { currentStage } from '../../shared/goal-rules'
import { formatLocalDate, type LocalDate } from '../../shared/local-date'
import { exerciseProgressValueLabel } from './ExerciseProgressSummary'

type NextWorkout = { kind: 'active' | 'assigned'; workout: Workout }
type HomeHighlight =
  | { kind: 'response'; workout: Workout }
  | { kind: 'record'; workout: Workout; record: WorkoutPersonalRecord }
  | { kind: 'goal'; goal: ClientGoal }

const reactionLabels: Record<TrainerReaction, string> = {
  thumbs_up: '👍',
  fire: '🔥',
  strong: '💪',
}

function workoutOrder(workout: Workout): string {
  return `${workout.workoutDate}${workout.startTime ?? ''}${workout.startedAt ?? ''}`
}

export function clientHomeNextWorkout(workouts: readonly Workout[], today: LocalDate): NextWorkout | null {
  const active = workouts
    .filter((workout) => workout.status === 'in_progress')
    .sort((a, b) => workoutOrder(b).localeCompare(workoutOrder(a)))[0]
  if (active) return { kind: 'active', workout: active }

  const assigned = workouts
    .filter((workout) => workout.status === 'planned' && Boolean(workout.trainerId) && workout.workoutDate >= today)
    .sort((a, b) => workoutOrder(a).localeCompare(workoutOrder(b)))[0]
  return assigned ? { kind: 'assigned', workout: assigned } : null
}

export function clientHomeLatestDoneWorkout(workouts: readonly Workout[]): Workout | undefined {
  return workouts
    .filter((workout) => workout.status === 'done')
    .sort((a, b) => workoutOrder(b).localeCompare(workoutOrder(a)))[0]
}

export function clientHomeHighlight(
  workouts: readonly Workout[],
  goal: ClientGoal | null | undefined,
  personalRecords: readonly WorkoutPersonalRecord[] = [],
): HomeHighlight | null {
  const latest = clientHomeLatestDoneWorkout(workouts)
  if (latest?.trainerReview?.trim() || latest?.trainerReaction) return { kind: 'response', workout: latest }
  if (latest?.hasPr && personalRecords[0]) return { kind: 'record', workout: latest, record: personalRecords[0] }
  return goal ? { kind: 'goal', goal } : null
}

function exerciseSummary(workout: Workout): string {
  const names = workout.exercises.map((exercise) => exercise.name)
  if (!names.length) return 'План тренировки'
  return `${names.slice(0, 2).join(', ')}${names.length > 2 ? ` и ещё ${names.length - 2}` : ''}`
}

function workoutTiming(workout: Workout, today: LocalDate): string {
  const day = workout.workoutDate === today ? 'Сегодня' : formatLocalDate(workout.workoutDate)
  return `${day}${workout.startTime ? `, ${workout.startTime.slice(0, 5)}` : ' · без времени'}`
}

function NextActionCard({ next, today }: { next: NextWorkout; today: LocalDate }) {
  const active = next.kind === 'active'
  return <section className={`client-home-next ${active ? 'active' : 'assigned'}`} aria-labelledby="client-home-next-title">
    <p className="eyebrow">СЕЙЧАС</p>
    <h2 id="client-home-next-title">{active ? 'Продолжите тренировку' : next.workout.workoutDate === today ? 'Тренировка на сегодня' : 'Следующая тренировка'}</h2>
    <p className="client-home-next-time">{workoutTiming(next.workout, today)}</p>
    <strong className="client-home-next-exercises">{exerciseSummary(next.workout)}</strong>
    <Link className="button wide" to={active ? `/workouts/${next.workout.id}/live` : `/workouts/${next.workout.id}`} state={{ returnTo: '/me' }}>
      {active ? 'Продолжить' : 'Открыть план'}
    </Link>
  </section>
}

function WeekCard({ week, loading }: { week: WorkoutRegularity | undefined; loading: boolean }) {
  if (loading) return <section className="client-home-week client-home-loading" role="status">Загружаем прогресс недели…</section>
  const completed = week?.completedCount ?? 0
  const completedPlanned = week?.completedPlannedCount ?? 0
  const independent = Math.max(0, completed - completedPlanned)
  const title = completed > 0 ? `${completed} ${workoutCountLabel(completed)}` : 'Пока без тренировок'
  const description = completed > 0
    ? [completedPlanned > 0 ? `${completedPlanned} по плану` : null, independent > 0 ? `${independent} самостоятельно` : null]
      .filter(Boolean).join(' · ') || 'Все тренировки завершены'
    : week?.plannedCount
      ? `План тренера: 0 из ${week.plannedCount} выполнено`
      : 'Здесь появится первая завершённая тренировка'
  const alerts = [
    week?.partialCount ? partialWorkoutLabel(week.partialCount) : null,
    week?.skippedCount ? `Пропущено: ${week.skippedCount}` : null,
  ].filter(Boolean).join(' · ')
  return <section className="client-home-week" aria-labelledby="client-home-week-title">
    <div className="client-home-section-head"><div><p className="eyebrow">ЭТА НЕДЕЛЯ</p><h2 id="client-home-week-title">{title}</h2></div><Link to="/me/progress">Подробнее</Link></div>
    <p>{description}</p>
    {alerts && <small className="client-home-week-alerts">{alerts}</small>}
  </section>
}

function workoutCountLabel(count: number): string {
  const mod100 = count % 100
  const mod10 = count % 10
  if (mod100 >= 11 && mod100 <= 14) return 'тренировок'
  if (mod10 === 1) return 'тренировка'
  if (mod10 >= 2 && mod10 <= 4) return 'тренировки'
  return 'тренировок'
}

function partialWorkoutLabel(count: number): string {
  return `В ${count} ${count === 1 ? 'тренировке' : 'тренировках'} часть упражнений не выполнена`
}

function HighlightCard({ highlight, today }: { highlight: HomeHighlight; today: LocalDate }) {
  if (highlight.kind === 'goal') {
    const stage = currentStage(highlight.goal, today)
    return <section className="client-home-highlight" aria-labelledby="client-home-highlight-title"><p className="eyebrow">ВАШ ФОКУС</p><Link to="/me/progress"><span><h2 id="client-home-highlight-title">{highlight.goal.title}</h2><small>{stage ? `Текущий этап: ${stage.title}` : 'Текущий этап ещё не задан'}</small></span><b>›</b></Link></section>
  }
  const response = highlight.kind === 'response'
  const reaction = highlight.workout.trainerReaction ? reactionLabels[highlight.workout.trainerReaction] : ''
  const record = highlight.kind === 'record' ? highlight.record : null
  const recordValue = record
    ? record.inputKind === 'strength' && record.weightKg !== null
      ? `${exerciseProgressValueLabel(record.weightKg, 'strength')}${record.reps === null ? '' : ` × ${record.reps} повт.`}`
      : exerciseProgressValueLabel(record.primaryValue, record.inputKind)
    : ''
  const recordType = record?.metric === 'weight' ? 'рекорд рабочего веса' : record?.metric === 'weight_reps' ? 'лучший подход' : 'лучший результат'
  const link = response
    ? `/workouts/${highlight.workout.id}`
    : `/workouts/${highlight.workout.id}/history/${encodeURIComponent(record!.exerciseRef)}`
  return <section className="client-home-highlight" aria-labelledby="client-home-highlight-title"><p className="eyebrow">{response ? 'ОТ ТРЕНЕРА' : 'ДОСТИЖЕНИЕ'}</p><Link to={link} state={{ returnTo: '/me' }}><span><h2 id="client-home-highlight-title">{response ? `${reaction} Новый ответ` : `${record!.exerciseName}: новый рекорд`}</h2><small>{response ? highlight.workout.trainerReview?.trim() || 'Тренер отметил вашу тренировку' : `${recordValue} · ${recordType}`}</small></span><b>›</b></Link></section>
}

interface ClientHomeOverviewProps {
  today: LocalDate
  workouts: Workout[] | undefined
  regularity: WorkoutRegularity[] | undefined
  goal: ClientGoal | null | undefined
  personalRecords?: WorkoutPersonalRecord[]
  workoutsLoading: boolean
  regularityLoading: boolean
  error: Error | null
  onRetry: () => void
  selfTraining: ReactNode
  wearable?: ReactNode
}

export function ClientHomeOverview({ today, workouts, regularity, goal, personalRecords = [], workoutsLoading, regularityLoading, error, onRetry, selfTraining, wearable }: ClientHomeOverviewProps) {
  const next = workouts ? clientHomeNextWorkout(workouts, today) : null
  const highlight = workouts ? clientHomeHighlight(workouts, goal, personalRecords) : goal ? { kind: 'goal' as const, goal } : null
  const week = regularity?.find((period) => period.period === 'week')
  return <div className="client-home-overview">
    {selfTraining}
    {workoutsLoading && !workouts && <section className="client-home-next client-home-loading" role="status">Загружаем следующую тренировку…</section>}
    {next && <NextActionCard next={next} today={today} />}
    <WeekCard week={week} loading={regularityLoading} />
    {highlight && <HighlightCard highlight={highlight} today={today} />}
    {wearable}
    {error && <section className="client-home-error" role="alert"><p>{error.message}</p><button type="button" className="secondary" onClick={onRetry}>Повторить</button></section>}
  </div>
}
