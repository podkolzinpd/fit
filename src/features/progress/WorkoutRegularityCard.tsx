import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { progressRepository } from '../../data/repositories/progress.repository'
import type { WorkoutRegularity } from '../../shared/domain'
import { formatLocalDateShort } from '../../shared/local-date'
import { AsyncView } from '../../shared/ui'

const PERIOD_LABELS = { week: 'Неделя', month: 'Месяц' } as const

function workoutCountLabel(count: number): string {
  const mod100 = count % 100
  const mod10 = count % 10
  if (mod100 >= 11 && mod100 <= 14) return 'тренировок'
  if (mod10 === 1) return 'тренировка'
  if (mod10 >= 2 && mod10 <= 4) return 'тренировки'
  return 'тренировок'
}

function periodAlerts(item: WorkoutRegularity): string[] {
  return [
    item.partialCount > 0 ? `Часть плана выполнена не полностью: ${item.partialCount}` : null,
    item.skippedCount > 0 ? `Пропущено: ${item.skippedCount}` : null,
  ].filter((value): value is string => value !== null)
}

export function WorkoutRegularityContent({ periods }: { periods: WorkoutRegularity[] }) {
  const [selected, setSelected] = useState<WorkoutRegularity['period']>(
    periods.some((item) => item.period === 'week') ? 'week' : periods[0]?.period ?? 'week',
  )
  const item = periods.find((period) => period.period === selected) ?? periods[0]
  if (!item) return <p className="workout-regularity-empty-hint">Данные о тренировках пока недоступны.</p>

  const independent = Math.max(0, item.completedCount - item.completedPlannedCount)
  const hasPlan = item.plannedCount > 0
  const hasWorkouts = item.completedCount > 0
  const alerts = periodAlerts(item)

  return <div className="workout-regularity-content">
    <div className="workout-regularity-tabs" role="tablist" aria-label="Период тренировочного ритма">
      {periods.map((period) => <button
        type="button"
        role="tab"
        id={`workout-regularity-tab-${period.period}`}
        aria-selected={period.period === item.period}
        aria-controls="workout-regularity-panel"
        key={period.period}
        onClick={() => setSelected(period.period)}
      >{PERIOD_LABELS[period.period]}</button>)}
    </div>
    <article className="workout-regularity-period" id="workout-regularity-panel" role="tabpanel" aria-labelledby={`workout-regularity-tab-${item.period}`}>
      <small>{formatLocalDateShort(item.periodStart)}–{formatLocalDateShort(item.periodEnd)}</small>
      <div className="workout-regularity-summary">
        <strong>{hasWorkouts ? `${item.completedCount} ${workoutCountLabel(item.completedCount)}` : 'Пока без тренировок'}</strong>
        <span>{hasWorkouts ? 'Тренировок состоялось' : 'Здесь появится первая завершённая тренировка'}</span>
      </div>
      {hasWorkouts && <div className="workout-regularity-breakdown" aria-label="Состав завершённых тренировок">
        {item.completedPlannedCount > 0 && <span><strong>{item.completedPlannedCount}</strong> по плану</span>}
        {independent > 0 && <span><strong>{independent}</strong> самостоятельно</span>}
      </div>}
      <p className="workout-regularity-plan">{hasPlan
        ? <>По плану тренера: <strong>{item.completedPlannedCount} из {item.plannedCount}</strong> тренировок состоялось</>
        : 'План тренера на этот период не назначен'}</p>
      {alerts.length > 0 && <p className="workout-regularity-alerts">{alerts.join(' · ')}</p>}
    </article>
  </div>
}

export function WorkoutRegularityCard({ clientId }: { clientId: string }) {
  const query = useQuery({
    queryKey: ['workout-regularity', clientId],
    queryFn: () => progressRepository.regularity(clientId),
  })
  return <section className="workout-regularity-card" aria-label="Регулярность тренировок">
    <header className="workout-regularity-header"><div><p className="eyebrow">ТРЕНИРОВОЧНЫЙ РИТМ</p><h2>Тренировки</h2></div></header>
    <AsyncView loading={query.isLoading} error={query.error} onRetry={() => void query.refetch()}>
      {query.data && <WorkoutRegularityContent periods={query.data} />}
    </AsyncView>
  </section>
}
