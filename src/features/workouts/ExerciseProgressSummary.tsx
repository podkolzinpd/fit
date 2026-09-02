import type { ExerciseProgressResult, ExerciseProgressSet, InputKind } from '../../shared/domain'
import { RecordIcon } from '../../shared/icons'
import { formatLocalDate } from '../../shared/local-date'
import { isRowingExerciseRef, rowingPaceLabel, runDistanceLabel } from '../../shared/run-metrics'

function compactNumber(value: number): string {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(value)
}

function durationValue(seconds: number): string {
  if (seconds < 60) return `${compactNumber(seconds)} сек`
  const minutes = Math.floor(seconds / 60)
  const rest = Math.round(seconds % 60)
  return rest === 0 ? `${minutes} мин` : `${minutes}:${String(rest).padStart(2, '0')}`
}

export function exerciseProgressValueLabel(value: number | null, inputKind: InputKind): string {
  if (value === null) return '—'
  if (inputKind === 'strength') return `${compactNumber(value)} кг`
  if (inputKind === 'reps') return `${compactNumber(value)} повт.`
  if (inputKind === 'duration') return durationValue(value)
  return `${compactNumber(value)} км`
}

function exerciseProgressChangeLabel(value: number | null, inputKind: InputKind): string {
  if (value === null) return 'Первый результат'
  if (value === 0) return 'Без изменений'
  const prefix = value > 0 ? '+' : ''
  if (inputKind === 'duration') return `${prefix}${compactNumber(value)} сек к прошлой тренировке`
  const unit = inputKind === 'strength' ? 'кг' : inputKind === 'reps' ? 'повт.' : 'км'
  return `${prefix}${compactNumber(value)} ${unit} к прошлой тренировке`
}

const EXERCISE_MILESTONES = [10, 25, 50, 100, 250, 500, 1000] as const

function executionCountLabel(totalCount: number): string {
  const mod10 = totalCount % 10
  const mod100 = totalCount % 100
  const noun = mod10 === 1 && mod100 !== 11
    ? 'выполнение'
    : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)
      ? 'выполнения'
      : 'выполнений'
  return `${totalCount} ${noun}`
}

function milestoneInfo(totalCount: number): { count: string; note: string } {
  const next = EXERCISE_MILESTONES.find((milestone) => milestone > totalCount)
  const achieved = [...EXERCISE_MILESTONES].reverse().find((milestone) => milestone <= totalCount)
  if (achieved && next) return { count: executionCountLabel(totalCount), note: `Отметка ${achieved} · далее ${next}` }
  if (next) return { count: executionCountLabel(totalCount), note: `Следующая отметка — ${next}` }
  return { count: executionCountLabel(totalCount), note: 'Отметка 1000 достигнута' }
}

export function exerciseProgressSetLabel(set: ExerciseProgressSet, inputKind: InputKind, showRpe: boolean, exerciseRef?: string): string {
  const rowing = inputKind === 'distance' && isRowingExerciseRef(exerciseRef)
  const rowingPace = rowing ? rowingPaceLabel(set.durationSec, set.distanceKm) : null
  const values = inputKind === 'strength'
    ? [set.weightKg === undefined ? null : `${compactNumber(set.weightKg)} кг`, set.reps === undefined ? null : `${compactNumber(set.reps)} повт.`]
    : inputKind === 'reps'
      ? [set.reps === undefined ? null : `${compactNumber(set.reps)} повт.`]
      : inputKind === 'duration'
        ? [set.durationSec === undefined ? null : durationValue(set.durationSec)]
        : [set.distanceKm === undefined ? null : runDistanceLabel(set.distanceKm), set.durationSec === undefined ? null : durationValue(set.durationSec), rowingPace, rowing && set.reps !== undefined ? `${compactNumber(set.reps)} гребков/мин` : null]
  return [
    ...values,
    showRpe && set.rpe !== undefined ? `RPE ${compactNumber(set.rpe)}` : null,
  ].filter((value): value is string => value !== null).join(' × ') || 'Без числового результата'
}

export function ExerciseProgressSummary({
  latest,
  totalCount,
}: {
  latest: ExerciseProgressResult | undefined
  totalCount: number
}) {
  if (!latest) return <p className="muted empty-hint">Пока нет подтверждённых результатов по этому упражнению.</p>
  const strength = latest.inputKind === 'strength'
  const current = exerciseProgressValueLabel(latest.primaryValue, latest.inputKind)
  const currentWithReps = strength && latest.repsAtBestWeight !== null
    ? `${current} × ${latest.repsAtBestWeight} повт.`
    : current
  const isLatestRecord = strength
    ? latest.isWeightPr || latest.isWeightRepsPr
    : latest.isPrimaryPr
  const milestone = milestoneInfo(totalCount)
  return <section className="exercise-progress-proof card" aria-label="Доказательство прогресса">
    <header>
      <p className="eyebrow">ПРОГРЕСС ПО УПРАЖНЕНИЮ</p>
      <div className="exercise-progress-result"><h2>{currentWithReps}</h2>{isLatestRecord && <span><RecordIcon />Личный рекорд</span>}</div>
    </header>
    <div className="exercise-progress-details">
      <strong>{exerciseProgressChangeLabel(latest.primaryChange, latest.inputKind)}</strong>
      <span>{latest.confirmedSetCount} {latest.confirmedSetCount === 1 ? 'подход' : latest.confirmedSetCount < 5 ? 'подхода' : 'подходов'}</span>
    </div>
    {strength
      ? <div className="exercise-progress-records">
          <span>Лучшие результаты</span>
          <strong>{exerciseProgressValueLabel(latest.allTimeBestWeightKg, 'strength')} · {latest.allTimeBestWeightReps === null ? '—' : `${compactNumber(latest.allTimeBestWeightReps)} кг·повт.`}</strong>
        </div>
      : !latest.isPrimaryPr && <div className="exercise-progress-records">
          <span>Лучший результат</span>
          <strong>{exerciseProgressValueLabel(latest.allTimePrimaryValue, latest.inputKind)}</strong>
        </div>}
    <div className="exercise-progress-milestone"><strong>{milestone.count}</strong><span>{milestone.note}</span></div>
    <p className="exercise-progress-method">Учитываем только выполненные подходы.</p>
  </section>
}

export function ExerciseProgressHistory({
  items,
  showRpe,
  exerciseRef,
}: {
  items: ExerciseProgressResult[]
  showRpe: boolean
  exerciseRef?: string
}) {
  if (!items.length) return <p className="muted empty-hint">Ещё нет выполненных подходов по этому упражнению.</p>
  return <div className="timeline exercise-progress-timeline">{items.map((item) => {
    const badges = item.inputKind === 'strength'
      ? [item.isWeightPr ? 'Личный рекорд · вес' : null, item.isWeightRepsPr ? 'Личный рекорд · вес × повторы' : null]
      : [item.isPrimaryPr ? 'Личный рекорд' : null]
    const visibleBadges = badges.filter((value): value is string => value !== null)
    return <article key={item.workoutId} className="card">
      <div className="exercise-progress-row-head"><strong>{formatLocalDate(item.workoutDate)}</strong><span>{item.confirmedSetCount} подх.</span></div>
      {visibleBadges.length > 0 && <div className="exercise-progress-badges">{visibleBadges.map((badge) => <span key={badge}>{badge}</span>)}</div>}
      <p>{item.sets.map((set) => exerciseProgressSetLabel(set, item.inputKind, showRpe, exerciseRef)).join(' · ')}</p>
      {item.trainerComment && <p className="exercise-comment-note">💬 {item.trainerComment}</p>}
    </article>
  })}</div>
}
