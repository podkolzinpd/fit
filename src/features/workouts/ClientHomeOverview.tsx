import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { ClientGoal, TrainerReaction, Workout, WorkoutPersonalRecord, WorkoutRegularity } from '../../shared/domain'
import { currentStage } from '../../shared/goal-rules'
import { addDays, formatLocalDate, type LocalDate } from '../../shared/local-date'
import { RecordIcon } from '../../shared/icons'
import { exerciseProgressValueLabel } from './ExerciseProgressSummary'
import { ClientFirstRunIntro } from './FirstRunExperience'

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
    .filter((workout) => workout.status === 'planned' && workout.workoutDate >= today)
    .sort((a, b) => workoutOrder(a).localeCompare(workoutOrder(b)))[0]
  return assigned ? { kind: 'assigned', workout: assigned } : null
}

export function clientHomeLatestDoneWorkout(workouts: readonly Workout[]): Workout | undefined {
  return workouts
    .filter((workout) => workout.status === 'done')
    .sort((a, b) => workoutOrder(b).localeCompare(workoutOrder(a)))[0]
}

export function clientHomePastPlans(workouts: readonly Workout[], today: LocalDate): Workout[] {
  return workouts
    .filter((workout) => workout.status === 'planned' && workout.workoutDate < today)
    .sort((a, b) => workoutOrder(b).localeCompare(workoutOrder(a)))
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
  const count = `${names.length} ${exerciseCountLabel(names.length)}`
  return `${count} · ${names.slice(0, 2).join(', ')}${names.length > 2 ? ` и ещё ${names.length - 2}` : ''}`
}

function exerciseCountLabel(count: number): string {
  const mod100 = count % 100
  const mod10 = count % 10
  if (mod100 >= 11 && mod100 <= 14) return 'упражнений'
  if (mod10 === 1) return 'упражнение'
  if (mod10 >= 2 && mod10 <= 4) return 'упражнения'
  return 'упражнений'
}

function workoutTiming(workout: Workout, today: LocalDate): string {
  const day = workout.workoutDate === today
    ? 'Сегодня'
    : workout.workoutDate === addDays(today, 1)
      ? 'Завтра'
      : formatLocalDate(workout.workoutDate)
  return `${day}${workout.startTime ? `, ${workout.startTime.slice(0, 5)}` : ' · без времени'}`
}

function nextWorkoutLabel(next: NextWorkout, today: LocalDate): string {
  if (next.kind === 'active') return 'ИДЁТ ТРЕНИРОВКА'
  if (next.workout.workoutDate === today) return 'СЕГОДНЯ'
  if (next.workout.workoutDate === addDays(today, 1)) return 'ЗАВТРА'
  return 'БЛИЖАЙШАЯ'
}

function NextActionCard({ next, today }: { next: NextWorkout; today: LocalDate }) {
  const active = next.kind === 'active'
  const future = !active && next.workout.workoutDate > today
  if (future) {
    return <section className="client-home-next assigned compact" aria-labelledby="client-home-next-title">
      <p className="eyebrow">{nextWorkoutLabel(next, today)}</p>
      <Link className="client-home-next-link" to={`/workouts/${next.workout.id}`} state={{ returnTo: '/me' }}>
        <span>
          <h2 id="client-home-next-title">Следующая тренировка</h2>
          <small>{workoutTiming(next.workout, today)}</small>
          <strong>{exerciseSummary(next.workout)}</strong>
        </span>
        <b aria-hidden="true">›</b>
      </Link>
    </section>
  }
  return <section className={`client-home-next ${active ? 'active' : 'assigned'}`} aria-labelledby="client-home-next-title">
    <p className="eyebrow">{nextWorkoutLabel(next, today)}</p>
    <h2 id="client-home-next-title">{active ? 'Продолжите тренировку' : 'Тренировка по плану'}</h2>
    <p className="client-home-next-time">{workoutTiming(next.workout, today)}</p>
    <strong className="client-home-next-exercises">{exerciseSummary(next.workout)}</strong>
    <Link className={`button wide${active ? ' primary' : ' secondary'}`} to={active ? `/workouts/${next.workout.id}/live` : `/workouts/${next.workout.id}`} state={{ returnTo: '/me' }}>
      {active ? 'Продолжить' : 'Открыть план'}
    </Link>
  </section>
}

function PastPlanCard({ workouts }: { workouts: Workout[] }) {
  const workout = workouts[0]
  if (!workout) return null
  return <section className="client-home-past-plan" aria-labelledby="client-home-past-plan-title">
    <p className="eyebrow">ПЛАН НА {formatLocalDate(workout.workoutDate)}</p>
    <Link to={`/workouts/${workout.id}`} state={{ returnTo: '/me' }}>
      <span><h2 id="client-home-past-plan-title">{exerciseSummary(workout)}</h2>{workouts.length > 1 && <small>Ещё планов: {workouts.length - 1}</small>}</span>
      <b>Выбрать действие ›</b>
    </Link>
  </section>
}

function WeekCard({ week, loading }: { week: WorkoutRegularity | undefined; loading: boolean }) {
  if (loading) return <section className="client-home-week client-home-loading" role="status">Загружаем прогресс недели…</section>
  const completed = week?.completedCount ?? 0
  if (completed === 0) return null
  const planned = week?.plannedCount ?? 0
  const completedPlanned = week?.completedPlannedCount ?? 0
  const independent = Math.max(0, completed - completedPlanned)
  const title = planned > 0 ? `${completedPlanned} из ${planned} по плану` : `${completed} ${workoutCountLabel(completed)}`
  const description = planned > 0
    ? independent > 0
      ? `Всего состоялось ${completed} ${workoutCountLabel(completed)} · ${independent} самостоятельно`
      : completedPlanned === planned
        ? 'Все запланированные тренировки состоялись'
        : `Всего состоялось ${completed} ${workoutCountLabel(completed)}`
    : completed === 1 ? 'Самостоятельно' : completed === 2 ? 'Обе — самостоятельно' : 'Все — самостоятельно'
  return <section className="client-home-week" aria-labelledby="client-home-week-title">
    <div className="client-home-section-head"><div><p className="eyebrow">ЭТА НЕДЕЛЯ</p><h2 id="client-home-week-title">{title}</h2></div><Link to="/me/progress">Прогресс ›</Link></div>
    <p>{description}</p>
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
  const link = response
    ? `/workouts/${highlight.workout.id}`
    : `/workouts/${highlight.workout.id}/history/${encodeURIComponent(record!.exerciseRef)}`
  return <section className={`client-home-highlight${response ? '' : ' record'}`} aria-labelledby="client-home-highlight-title">
    <p className="eyebrow">{response ? 'ОТ ТРЕНЕРА' : <><RecordIcon /> НОВЫЙ ЛИЧНЫЙ РЕКОРД</>}</p>
    <Link to={link} state={{ returnTo: '/me' }}><span><h2 id="client-home-highlight-title">{response ? `${reaction} Новый ответ` : record!.exerciseName}</h2><small>{response ? highlight.workout.trainerReview?.trim() || 'Тренер отметил вашу тренировку' : recordValue}</small></span><b>›</b></Link>
  </section>
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
  showFirstRunConnection?: boolean
}

export function ClientHomeOverview({ today, workouts, regularity, goal, personalRecords = [], workoutsLoading, regularityLoading, error, onRetry, selfTraining, wearable, showFirstRunConnection = true }: ClientHomeOverviewProps) {
  const next = workouts ? clientHomeNextWorkout(workouts, today) : null
  const pastPlans = workouts ? clientHomePastPlans(workouts, today) : []
  const hasActiveOrTodayPlan = Boolean(next && (next.kind === 'active' || next.workout.workoutDate === today))
  const highlight = workouts ? clientHomeHighlight(workouts, goal, personalRecords) : goal ? { kind: 'goal' as const, goal } : null
  const week = regularity?.find((period) => period.period === 'week')
  const firstRun = !workoutsLoading && workouts?.length === 0
  return <div className="client-home-overview">
    {firstRun ? <ClientFirstRunIntro actions={selfTraining} showConnection={showFirstRunConnection} /> : selfTraining}
    {workoutsLoading && !workouts && <section className="client-home-next client-home-loading" role="status">Загружаем следующую тренировку…</section>}
    {!hasActiveOrTodayPlan && pastPlans.length > 0 && <PastPlanCard workouts={pastPlans} />}
    {next && <NextActionCard next={next} today={today} />}
    <WeekCard week={week} loading={regularityLoading} />
    {highlight && <HighlightCard highlight={highlight} today={today} />}
    {wearable}
    {error && <section className="client-home-error" role="alert"><p>{error.message}</p><button type="button" className="secondary" onClick={onRetry}>Повторить</button></section>}
  </div>
}
