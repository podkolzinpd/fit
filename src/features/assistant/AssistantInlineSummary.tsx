import type { AssistantInlineSummary } from './assistant-inline-summary'

export function AssistantInlineSummaryCard({ summary, onSave, saving, saved }: {
  summary: AssistantInlineSummary
  onSave: () => void
  saving: boolean
  saved: boolean
}) {
  return <section className="assistant-inline-summary" aria-label={`Сводка прогресса ${summary.clientName}`}>
    <header>
      <div><small>Сводка прогресса</small><strong>{summary.clientName}</strong><span>{summary.periodLabel} · {summary.periodStart} — {summary.periodEnd}</span></div>
      <span className={saved ? 'assistant-inline-summary-status saved' : 'assistant-inline-summary-status'}>{saved ? 'Сохранено' : 'Готово'}</span>
    </header>
    <div className="assistant-inline-summary-headline"><small>Главное</small><strong>{summary.trainer.headline}</strong></div>
    <div className="assistant-inline-summary-metrics">
      <div><strong>{summary.metrics.completedWorkouts}</strong><span>тренировок</span></div>
      <div><strong>{summary.metrics.workoutsPerWeek}</strong><span>в неделю</span></div>
      <div><strong>{summary.metrics.activeWeeks}</strong><span>активных недель</span></div>
    </div>
    {summary.trainer.progress.length > 0 && <div className="assistant-inline-summary-section"><small>Динамика</small><ul>{summary.trainer.progress.map((point) => <li key={point}>{point}</li>)}</ul></div>}
    {summary.trainer.consistency && <div className="assistant-inline-summary-section"><small>Регулярность</small><p>{summary.trainer.consistency}</p></div>}
    {summary.trainer.attention.length > 0 && <div className="assistant-inline-summary-section"><small>Внимание</small><ul>{summary.trainer.attention.map((point) => <li key={point}>{point}</li>)}</ul></div>}
    <button type="button" className="primary" onClick={onSave} disabled={saving || saved}>{saved ? 'Сохранено в прогресс' : saving ? 'Сохраняю…' : 'Сохранить в прогресс'}</button>
  </section>
}
