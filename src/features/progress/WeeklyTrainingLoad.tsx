import { ProgressDetailsSummary } from './ProgressDetailsSummary'
import { useMemo, useState } from 'react'
import type { Workout } from '../../shared/domain'
import { formatLocalDate, type LocalDate } from '../../shared/local-date'
import { setCountLabel } from './body-progress-map'
import { weeklySetDistribution } from './results-analytics'

export function WeeklyTrainingLoad({ workouts, periodStart, periodEnd, today, loading, error, onRetry }: {
  workouts?: readonly Workout[]; periodStart: LocalDate; periodEnd: LocalDate; today: LocalDate; loading: boolean; error: Error | null; onRetry: () => void
}) {
  const [open, setOpen] = useState(false)
  const [all, setAll] = useState(false)
  const weeks = useMemo(() => open ? weeklySetDistribution(workouts ?? [], periodStart, periodEnd, today).reverse() : [], [open, workouts, periodStart, periodEnd, today])
  const maximum = Math.max(1, ...weeks.map((week) => week.totalSets))
  const visible = all ? weeks : weeks.slice(0, 8)
  return <details className="weekly-training-load card" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}><ProgressDetailsSummary>Нагрузка по неделям</ProgressDetailsSummary>
    {open && <>
      {error ? <p role="alert">Не удалось загрузить недельную нагрузку. <button className="link" type="button" onClick={onRetry}>Повторить</button></p> : loading && !workouts ? <p role="status">Загружаем нагрузку…</p> : !weeks.length ? <p>За этот период пока нет данных.</p> : <>
        <ol className="weekly-load-list">{visible.map((week) => <li key={week.week}>
          <header><strong>{formatLocalDate(week.start)} — {formatLocalDate(week.end)}</strong><span>{setCountLabel(week.totalSets)}</span></header>
          {week.partial && <p className="muted">Часть недели</p>}
          <div className="weekly-load-bar" aria-hidden="true"><span style={{ width: `${week.totalSets / maximum * 100}%` }} /></div>
          {!week.totalSets ? <p>Нет подходов.</p> : <p>{week.cardioSets > 0 && `Кардио: ${week.cardioSets}`}{week.cardioSets > 0 && week.unknownSets > 0 && " · "}{week.unknownSets > 0 && `Без группы: ${week.unknownSets}`}</p>}
          {!!week.regions.length && <details><summary>Подходы по мышцам</summary><ul>{week.regions.map((region) => <li key={region.group}>{region.label}: {setCountLabel(region.setCount)}</li>)}</ul></details>}
        </li>)}</ol>
        {!all && weeks.length > visible.length && <button className="secondary" type="button" onClick={() => setAll(true)}>Все недели · {weeks.length}</button>}
      </>}
    </>}
  </details>
}
