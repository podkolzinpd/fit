import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { ClientGoal, TrainerReaction, Workout, WorkoutRegularity } from '../../shared/domain'
import { currentStage } from '../../shared/goal-rules'
import { formatLocalDate, type LocalDate } from '../../shared/local-date'

type NextWorkout = { kind: 'active' | 'assigned'; workout: Workout }
type HomeHighlight =
  | { kind: 'response'; workout: Workout }
  | { kind: 'record'; workout: Workout }
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

export function clientHomeHighlight(workouts: readonly Workout[], goal: ClientGoal | null | undefined): HomeHighlight | null {
  const latest = workouts
    .filter((workout) => workout.status === 'done')
    .sort((a, b) => workoutOrder(b).localeCompare(workoutOrder(a)))[0]
  if (latest?.trainerReview?.trim() || latest?.trainerReaction) return { kind: 'response', workout: latest }
  if (latest?.hasPr) return { kind: 'record', workout: latest }
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
  const hasPlan = Boolean(week && week.plannedCount > 0)
  const title = hasPlan ? `${week?.completionPercent ?? 0}%` : week?.completedCount ? `${week.completedCount} выполнено` : 'Пока без тренировок'
  const description = hasPlan
    ? `${week!.completedPlannedCount} из ${week!.plannedCount} выполнено по плану`
    : week?.completedCount
      ? 'Назначенного плана на неделю нет'
      : 'План и тренировки ещё не добавлены'
  return <section className="client-home-week" aria-labelledby="client-home-week-title">
    <div className="client-home-section-head"><div><p className="eyebrow">ЭТА НЕДЕЛЯ</p><h2 id="client-home-week-title">{title}</h2></div><Link to="/me/progress">Весь прогресс</Link></div>
    <p>{description}</p>
    {hasPlan && <div className="client-home-week-track" role="progressbar" aria-label="Выполнено по плану на этой неделе" aria-valuemin={0} aria-valuemax={100} aria-valuenow={week?.completionPercent ?? 0}><span style={{ width: `${Math.min(100, Math.max(0, week?.completionPercent ?? 0))}%` }} /></div>}
    <div className="client-home-week-stats"><span>План <strong>{week?.plannedCount ?? 0}</strong></span><span>Выполнено <strong>{week?.completedCount ?? 0}</strong></span></div>
  </section>
}

function HighlightCard({ highlight, today }: { highlight: HomeHighlight; today: LocalDate }) {
  if (highlight.kind === 'goal') {
    const stage = currentStage(highlight.goal, today)
    return <section className="client-home-highlight" aria-labelledby="client-home-highlight-title"><p className="eyebrow">ВАШ ФОКУС</p><Link to="/me/progress"><span><h2 id="client-home-highlight-title">{highlight.goal.title}</h2><small>{stage ? `Текущий этап: ${stage.title}` : 'Текущий этап ещё не задан'}</small></span><b>›</b></Link></section>
  }
  const response = highlight.kind === 'response'
  const reaction = highlight.workout.trainerReaction ? reactionLabels[highlight.workout.trainerReaction] : ''
  return <section className="client-home-highlight" aria-labelledby="client-home-highlight-title"><p className="eyebrow">{response ? 'ОТ ТРЕНЕРА' : 'ДОСТИЖЕНИЕ'}</p><Link to={`/workouts/${highlight.workout.id}`} state={{ returnTo: '/me' }}><span><h2 id="client-home-highlight-title">{response ? `${reaction} Новый ответ` : 'Новый личный рекорд'}</h2><small>{response ? highlight.workout.trainerReview?.trim() || 'Тренер отметил вашу тренировку' : `${workoutTiming(highlight.workout, today)} · ${exerciseSummary(highlight.workout)}`}</small></span><b>›</b></Link></section>
}

interface ClientHomeOverviewProps {
  today: LocalDate
  workouts: Workout[] | undefined
  regularity: WorkoutRegularity[] | undefined
  goal: ClientGoal | null | undefined
  workoutsLoading: boolean
  regularityLoading: boolean
  error: Error | null
  onRetry: () => void
  selfTraining: ReactNode
  wearable?: ReactNode
}

export function ClientHomeOverview({ today, workouts, regularity, goal, workoutsLoading, regularityLoading, error, onRetry, selfTraining, wearable }: ClientHomeOverviewProps) {
  const next = workouts ? clientHomeNextWorkout(workouts, today) : null
  const highlight = workouts ? clientHomeHighlight(workouts, goal) : goal ? { kind: 'goal' as const, goal } : null
  const week = regularity?.find((period) => period.period === 'week')
  return <div className="client-home-overview">
    {workoutsLoading && !workouts && <section className="client-home-next client-home-loading" role="status">Загружаем следующую тренировку…</section>}
    {next && <NextActionCard next={next} today={today} />}
    {!workoutsLoading && !next && selfTraining}
    <WeekCard week={week} loading={regularityLoading} />
    {highlight && <HighlightCard highlight={highlight} today={today} />}
    {(workoutsLoading || next) && selfTraining}
    {wearable}
    {error && <section className="client-home-error" role="alert"><p>{error.message}</p><button type="button" className="secondary" onClick={onRetry}>Повторить</button></section>}
  </div>
}
