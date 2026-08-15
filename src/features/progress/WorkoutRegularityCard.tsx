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
      return <article className="workout-regularity-period" key={item.period}>
        <header><div><h3>{PERIOD_LABELS[item.period]}</h3><small>{formatLocalDateShort(item.periodStart)}–{formatLocalDateShort(item.periodEnd)}</small></div>
          <strong>{item.completionPercent === null ? '—' : `${item.completionPercent}%`}</strong></header>
        <div className="workout-regularity-track" role="progressbar" aria-label={`План закрыт за период: ${PERIOD_LABELS[item.period].toLowerCase()}`}
          aria-valuemin={0} aria-valuemax={100} aria-valuenow={item.completionPercent ?? undefined}>
          <span style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} />
        </div>
        <div className="workout-regularity-stats">
          <div><strong>{item.plannedCount}</strong><span>запланировано</span></div>
          <div><strong>{item.completedCount}</strong><span>выполнено</span></div>
          <div><strong>{item.completedPlannedCount}</strong><span>по плану</span></div>
        </div>
        <p>{details.length > 0 ? details.join(' · ') : item.plannedCount + item.completedCount === 0 ? 'Тренировок пока нет' : 'Без пропусков и частичных тренировок'}</p>
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
    <header className="workout-regularity-header"><div><p className="eyebrow">ПЛАН И ФАКТ</p><h2>Регулярность</h2></div><span>Без AI</span></header>
    <AsyncView loading={query.isLoading} error={query.error} onRetry={() => void query.refetch()}>
      {query.data && <WorkoutRegularityContent periods={query.data} />}
    </AsyncView>
  </section>
}
