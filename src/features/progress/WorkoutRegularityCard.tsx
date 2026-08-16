import { useQuery } from '@tanstack/react-query'
import { progressRepository } from '../../data/repositories/progress.repository'
import type { WorkoutRegularity } from '../../shared/domain'
import { formatLocalDateShort } from '../../shared/local-date'
import { AsyncView } from '../../shared/ui'

const PERIOD_LABELS = { week: 'Неделя', month: 'Месяц' } as const

function periodDetails(item: WorkoutRegularity): string[] {
  const independent = Math.max(0, item.completedCount - item.completedPlannedCount)
  return [
    item.partialCount > 0 ? `частично ${item.partialCount}` : null,
    item.skippedCount > 0 ? `пропущено ${item.skippedCount}` : null,
    independent > 0 ? `самостоятельно ${independent}` : null,
  ].filter((value): value is string => value !== null)
}

export function WorkoutRegularityContent({ periods }: { periods: WorkoutRegularity[] }) {
  return <div className="workout-regularity-periods">
    {periods.map((item) => {
      const details = periodDetails(item)
      const percent = item.completionPercent ?? 0
      const hasPlan = item.plannedCount > 0
      const hasWorkouts = item.completedCount > 0
      const summary = hasPlan
        ? { value: `${item.completionPercent ?? 0}%`, label: `${item.completedPlannedCount} из ${item.plannedCount} выполнено по плану` }
        : hasWorkouts
          ? { value: `${item.completedCount} выполнено`, label: 'Назначенного плана пока нет' }
          : { value: 'Пока пусто', label: 'План и тренировки ещё не добавлены' }
      const actionHint = !hasWorkouts && !hasPlan
        ? 'Добавьте тренировку — здесь появится прогресс.'
        : !hasPlan
          ? 'Добавьте план, чтобы видеть процент выполнения.'
          : null
      const hint = [details.join(' · '), actionHint].filter(Boolean).join(' · ')
        || 'Без пропусков и частичных тренировок'
      return <article className="workout-regularity-period" key={item.period}>
        <header><div><h3>{PERIOD_LABELS[item.period]}</h3><small>{formatLocalDateShort(item.periodStart)}–{formatLocalDateShort(item.periodEnd)}</small></div></header>
        <div className="workout-regularity-summary"><strong>{summary.value}</strong><span>{summary.label}</span></div>
        {hasPlan && <div className="workout-regularity-track" role="progressbar" aria-label={`Выполнено по плану за период: ${PERIOD_LABELS[item.period].toLowerCase()}`}
          aria-valuemin={0} aria-valuemax={100} aria-valuenow={item.completionPercent ?? undefined}>
          <span style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} />
        </div>}
        <div className="workout-regularity-stats">
          <div><span>План</span><strong>{item.plannedCount}</strong></div>
          <div><span>Выполнено</span><strong>{item.completedCount}</strong></div>
          <div><span>По плану</span><strong>{item.completedPlannedCount}</strong></div>
        </div>
        <p className={!hasWorkouts && !hasPlan ? 'workout-regularity-empty-hint' : undefined}>{hint}</p>
      </article>
    })}
  </div>
}

export function WorkoutRegularityCard({ clientId }: { clientId: string }) {
  const query = useQuery({
    queryKey: ['workout-regularity', clientId],
    queryFn: () => progressRepository.regularity(clientId),
  })
  return <section className="workout-regularity-card" aria-label="Регулярность тренировок">
    <header className="workout-regularity-header"><div><p className="eyebrow">ТРЕНИРОВОЧНЫЙ РИТМ</p><h2>Неделя и месяц</h2></div></header>
    <AsyncView loading={query.isLoading} error={query.error} onRetry={() => void query.refetch()}>
      {query.data && <WorkoutRegularityContent periods={query.data} />}
    </AsyncView>
  </section>
}
