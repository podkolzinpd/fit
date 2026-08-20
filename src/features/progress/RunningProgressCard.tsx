import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../app/auth-context'
import { progressRepository } from '../../data/repositories/progress.repository'
import { ChevronRightIcon } from '../../shared/icons'
import { addDays, addMonths, todayInTimeZone } from '../../shared/local-date'
import {
  RUNNING_FORMAT_LABELS,
  formatRunningDistance,
  formatRunningDuration,
  formatRunningPace,
  runningProgressView,
} from './running-progress'

const PERIODS = [
  { months: 1, label: '1 мес.' },
  { months: 3, label: '3 мес.' },
  { months: 6, label: '6 мес.' },
] as const

function paceInsightText(changePercent: number, format: keyof typeof RUNNING_FORMAT_LABELS): string {
  const label = RUNNING_FORMAT_LABELS[format]
  if (Math.abs(changePercent) < 2) return `Темп в ${label} остаётся стабильным при сопоставимой дистанции.`
  return `Темп в ${label} стал ${changePercent > 0 ? 'быстрее' : 'медленнее'} на ${Math.abs(changePercent)}% при сопоставимой дистанции.`
}

function runCountLabel(count: number): string {
  const lastTwoDigits = count % 100
  if (lastTwoDigits >= 11 && lastTwoDigits <= 14) return 'пробежек'
  const lastDigit = count % 10
  if (lastDigit === 1) return 'пробежка'
  if (lastDigit >= 2 && lastDigit <= 4) return 'пробежки'
  return 'пробежек'
}

export function RunningProgressCard({ clientId, compact = false, detailsPath }: {
  clientId: string
  compact?: boolean
  detailsPath?: string
}) {
  const { actor } = useAuth()
  const [months, setMonths] = useState<1 | 3 | 6>(1)
  const today = todayInTimeZone(actor?.timezone)
  const periodStart = addDays(addMonths(today, -months), 1)
  const query = useQuery({
    queryKey: ['running-progress', clientId, periodStart, today],
    queryFn: () => progressRepository.running(clientId, periodStart, today),
  })
  const view = useMemo(() => runningProgressView(query.data ?? []), [query.data])

  if (query.isLoading) return null
  if (query.error) return <section className={`running-progress-card error-state${compact ? ' compact' : ''}`} aria-label="Беговой прогресс">
    <div><p className="eyebrow">БЕГ</p><h2>Прогресс временно недоступен</h2></div>
    <button type="button" className="link" onClick={() => void query.refetch()}>Повторить</button>
  </section>
  if (!view.runCount) return null

  if (compact && detailsPath) {
    return <Link className="trainer-progress-route-card running" to={detailsPath} aria-label="Открыть беговой прогресс">
      <div>
        <p className="eyebrow">БЕГ</p>
        <strong>{view.runCount} {runCountLabel(view.runCount)}</strong>
        <span>{formatRunningDistance(view.totalDistanceKm)} км · средний темп {formatRunningPace(view.averagePaceSecPerKm)} мин/км</span>
      </div>
      <ChevronRightIcon aria-hidden="true" />
    </Link>
  }

  return <section className="running-progress-card" aria-label="Беговой прогресс">
    <header className="running-progress-header">
      <div><p className="eyebrow">БЕГ</p><h2>Беговой прогресс</h2></div>
      <div className="running-progress-periods" role="tablist" aria-label="Период бегового прогресса">
        {PERIODS.map((period) => <button
          type="button"
          role="tab"
          aria-selected={months === period.months}
          className={months === period.months ? 'active' : ''}
          key={period.months}
          onClick={() => setMonths(period.months)}
        >{period.label}</button>)}
      </div>
    </header>
    <div className="running-progress-total">
      <strong>{view.runCount} {runCountLabel(view.runCount)}</strong>
      <span>{formatRunningDistance(view.totalDistanceKm)} км · {formatRunningDuration(view.totalDurationSec)}</span>
    </div>
    <div className="running-progress-metrics">
      <div><strong>{formatRunningPace(view.averagePaceSecPerKm)}</strong><span>средний темп, мин/км</span></div>
      <div><strong>{view.averageRpe?.toLocaleString('ru-RU', { maximumFractionDigits: 1 }) ?? '—'}</strong><span>средний RPE</span></div>
    </div>
    {(view.paceInsight || view.latestRpe !== undefined) && <div className="running-progress-insight">
      {view.paceInsight && <p>{paceInsightText(view.paceInsight.changePercent, view.paceInsight.format)}</p>}
      {view.latestRpe !== undefined && <span>Последняя нагрузка: RPE {view.latestRpe.toLocaleString('ru-RU', { maximumFractionDigits: 1 })}</span>}
    </div>}
  </section>
}
