import type { ExerciseProgressResult, ExerciseProgressSet, InputKind } from '../../shared/domain'
import { formatLocalDate } from '../../shared/local-date'

function compactNumber(value: number): string {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 3 }).format(value)
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
  const prefix = value > 0 ? '+' : ''
  if (inputKind === 'duration') return `${prefix}${compactNumber(value)} сек`
  const unit = inputKind === 'strength' ? 'кг' : inputKind === 'reps' ? 'повт.' : 'км'
  return `${prefix}${compactNumber(value)} ${unit}`
}

function milestoneLabel(totalCount: number): string {
  const next = [10, 25, 50, 100].find((milestone) => milestone > totalCount)
  return next ? `${totalCount} из ${next} до следующей отметки` : `${totalCount} тренировок в истории`
}

export function exerciseProgressSetLabel(set: ExerciseProgressSet, showRpe: boolean): string {
  return [
    set.weightKg === undefined ? null : `${compactNumber(set.weightKg)} кг`,
    set.reps === undefined ? null : `${compactNumber(set.reps)} повт.`,
    set.distanceKm === undefined ? null : `${compactNumber(set.distanceKm)} км`,
    set.durationSec === undefined ? null : durationValue(set.durationSec),
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
  return <section className="exercise-progress-proof card" aria-label="Доказательство прогресса">
    <header><div><p className="eyebrow">ПОДТВЕРЖДЁННЫЙ ФАКТ</p><h2>Рост по упражнению</h2></div><span>{milestoneLabel(totalCount)}</span></header>
    <div className="exercise-progress-current">
      <div><span>Последний результат</span><strong>{currentWithReps}</strong></div>
      <div><span>К прошлой тренировке</span><strong>{exerciseProgressChangeLabel(latest.primaryChange, latest.inputKind)}</strong></div>
      <div><span>Подходов</span><strong>{latest.confirmedSetCount}</strong></div>
    </div>
    {strength
      ? <div className="exercise-progress-records">
          <div><span>Рекорд рабочего веса</span><strong>{exerciseProgressValueLabel(latest.allTimeBestWeightKg, 'strength')}</strong></div>
          <div><span>Рекорд вес × повторы</span><strong>{latest.allTimeBestWeightReps === null ? '—' : `${compactNumber(latest.allTimeBestWeightReps)} кг·повт.`}</strong></div>
        </div>
      : <div className="exercise-progress-records single">
          <div><span>Лучший результат</span><strong>{exerciseProgressValueLabel(latest.allTimePrimaryValue, latest.inputKind)}</strong></div>
        </div>}
    <p className="exercise-progress-method">Только подтверждённые подходы завершённых тренировок. План и черновой ввод не учитываются.{strength ? ' Estimated 1RM не используется.' : ''}</p>
  </section>
}

export function ExerciseProgressHistory({
  items,
  showRpe,
}: {
  items: ExerciseProgressResult[]
  showRpe: boolean
}) {
  if (!items.length) return <p className="muted empty-hint">Ещё нет выполненных подходов по этому упражнению.</p>
  return <div className="timeline exercise-progress-timeline">{items.map((item) => {
    const badges = item.inputKind === 'strength'
      ? [item.isWeightPr ? 'PR вес' : null, item.isWeightRepsPr ? 'PR вес × повторы' : null]
      : [item.isPrimaryPr ? 'PR' : null]
    const visibleBadges = badges.filter((value): value is string => value !== null)
    return <article key={item.workoutId} className="card">
      <div className="exercise-progress-row-head"><strong>{formatLocalDate(item.workoutDate)}</strong><span>{item.confirmedSetCount} подх.</span></div>
      {visibleBadges.length > 0 && <div className="exercise-progress-badges">{visibleBadges.map((badge) => <span key={badge}>{badge}</span>)}</div>}
      <p>{item.sets.map((set) => exerciseProgressSetLabel(set, showRpe)).join(' · ')}</p>
      {item.trainerComment && <p className="exercise-comment-note">💬 {item.trainerComment}</p>}
    </article>
  })}</div>
}
