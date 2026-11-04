import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useAuth } from '../../app/auth-context'
import { useDataBackend } from '../../app/data-backend-context'
import { useClientRealtime } from '../../app/use-client-realtime'
import type { Client } from '../../shared/domain'
import { currentStage, orderedStages, stageProgress, stageStatus } from '../../shared/goal-rules'
import { formatLocalDateShort, todayInTimeZone } from '../../shared/local-date'
import goalIcon from '../../assets/client-profile/goal.svg'

const statusLabels = { done: 'завершён', current: 'идёт', upcoming: 'впереди' }

export function OwnClientProfileGoal({ client }: { client: Client }) {
  const { actor } = useAuth()
  const { goals } = useDataBackend()
  useClientRealtime(client.id)
  const query = useQuery({ queryKey: ['client-goal', client.id], queryFn: () => goals.get(client.id) })
  const today = todayInTimeZone(actor?.timezone)
  const goal = query.data
  const stage = goal ? currentStage(goal, today) : null
  const stages = goal ? orderedStages(goal) : []
  const progress = goal ? stageProgress(goal, today) : null
  const title = goal?.title || client.goal?.trim()
  return <section className="client-own-goal" aria-labelledby="client-own-goal-title">
    <div className="client-own-goal-heading">
      <h2 id="client-own-goal-title"><img src={goalIcon} alt="" />Моя цель</h2>
      {!query.isPending && !query.isError && <Link to="/me/goal" state={{ from: '/me/profile' }}
        aria-label={goal ? 'Изменить цель и подцели' : 'Добавить цель'}>{goal ? 'Изменить' : 'Добавить цель'}</Link>}
    </div>
    {query.isPending ? <p role="status">Загружаем цель…</p>
      : query.isError ? <div role="alert"><p>Не удалось загрузить цель и подцели.</p><button type="button" className="link" onClick={() => void query.refetch()}>Повторить загрузку цели</button></div>
      : <>
        {title && <p className="client-own-goal-title">{title}</p>}
        {goal?.targetDate && <p className="client-own-goal-deadline">До {formatLocalDateShort(goal.targetDate)}</p>}
        {stage && progress && <div className="client-own-goal-current" role="group" aria-label="Текущая подцель">
          <p>Этап {progress.index} из {progress.total}</p><strong>{stage.title}</strong>
          <p>{formatLocalDateShort(stage.startsOn)} — {formatLocalDateShort(stage.endsOn)}</p>
        </div>}
        {!stage && stages.length > 0 && <p className="client-own-goal-meta">Сейчас нет текущего этапа</p>}
        {stages.length > 0 && <details className="client-own-goal-stages">
          <summary>Все подцели · {stages.length}</summary>
          <ol>{stages.map(item => <li key={item.id} aria-current={item.id === stage?.id ? 'step' : undefined}>
            <strong>{item.title}</strong><span>{formatLocalDateShort(item.startsOn)} — {formatLocalDateShort(item.endsOn)} · {statusLabels[stageStatus(item, today)]}</span>
          </li>)}</ol>
        </details>}
        {goal && stages.length === 0 && <p className="client-own-goal-meta">Подцели пока не добавлены</p>}
        {goal && <p className="client-own-goal-meta">{goal.criteria.length
          ? `Критериев оценки: ${goal.criteria.length}${goal.criteria.some(item => item.confirmationStatus !== 'confirmed') ? ' · требуется подтверждение' : ''}`
          : 'Критерии оценки не настроены'}</p>}
      </>}
  </section>
}
