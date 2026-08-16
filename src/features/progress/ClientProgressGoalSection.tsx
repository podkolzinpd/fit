import { Link } from 'react-router-dom'
import type { ClientGoal } from '../../shared/domain'
import { currentStage } from '../../shared/goal-rules'
import type { LocalDate } from '../../shared/local-date'
import { formatSummaryText } from './summary-format'

export function ClientProgressGoalSection({ goal, profileGoal, today, loading, error, alignment, onRetry }: {
  goal: ClientGoal | null | undefined
  profileGoal?: string | null
  today: LocalDate
  loading: boolean
  error: Error | null
  alignment?: string
  onRetry: () => void
}) {
  const goalTitle = goal?.title ?? profileGoal?.trim() ?? ''
  const stage = goal ? currentStage(goal, today) : null
  return <section className="ai-progress-goal" aria-labelledby="ai-progress-goal-title">
    <h3 id="ai-progress-goal-title">Твоя цель</h3>
    {loading && <p className="muted" role="status">Проверяем цель…</p>}
    {error && <div className="ai-progress-goal-error" role="alert"><p>Не удалось загрузить цель.</p><button type="button" className="link" onClick={onRetry}>Повторить</button></div>}
    {!loading && !error && goalTitle && <>
      <strong>{goalTitle}</strong>
      {stage && <small>Текущий этап: {stage.title}</small>}
      {alignment
        ? <p>{formatSummaryText(alignment)}</p>
        : <p className="muted">Обнови сводку — ИИ учтёт эту цель в анализе.</p>}
    </>}
    {!loading && !error && !goalTitle && <div className="ai-progress-goal-empty">
      <p>Добавь цель, чтобы ИИ оценивал прогресс относительно твоей задачи.</p>
      <Link className="button secondary" to="/me/edit">Добавить цель</Link>
    </div>}
  </section>
}
