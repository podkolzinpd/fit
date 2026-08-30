import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type {
  ProgressNextStepAction,
  ProgressNextStepCandidate,
  ProgressNextStepRecommendation,
  ProgressNextStepResult,
} from './next-step-recommendation'

type RecommendationState = 'draft' | 'editing' | 'confirmed' | 'rejected'

export function ProgressNextStepSection({ result, links, loading, error, onRetry, titleId }: {
  result: ProgressNextStepResult
  links: Partial<Record<ProgressNextStepAction, string | ((candidate: ProgressNextStepCandidate) => string)>>
  loading: boolean
  error: Error | null
  onRetry: () => void
  titleId: string
}) {
  const [state, setState] = useState<RecommendationState>('draft')
  const [recommendation, setRecommendation] = useState<ProgressNextStepRecommendation>(result.recommendation)
  const [editedId, setEditedId] = useState(result.recommendation.id)
  const choices = useMemo(
    () => [result.recommendation, ...result.alternatives],
    [result.alternatives, result.recommendation],
  )
  useEffect(() => {
    setState('draft')
    setRecommendation(result.recommendation)
    setEditedId(result.recommendation.id)
  }, [result.recommendation.id, result.recommendation.source, result.recommendation.title])

  if (loading) return <section className="client-progress-upcoming client-progress-next-step" role="status">
    <span>Следующий шаг</span><p>Подбираем действие по подтверждённым данным…</p>
  </section>
  if (error) return <section className="client-progress-upcoming client-progress-next-step" role="alert">
    <span>Следующий шаг</span><p>Не удалось проверить данные для рекомендации.</p>
    <button type="button" className="link" onClick={onRetry}>Повторить</button>
  </section>

  const linkValue = links[recommendation.action]
  const actionHref = typeof linkValue === 'function' ? linkValue(recommendation) : linkValue
  return <section
    className={`client-progress-upcoming client-progress-next-step state-${state}`}
    aria-labelledby={titleId}
    data-recommendation-source={recommendation.source}
  >
    <header className="progress-next-step-head">
      <span>Следующий шаг</span>
      <strong>{recommendation.source === 'llm' ? 'Черновик · ИИ' : recommendation.source === 'user' ? 'Изменённый черновик' : 'Черновик · правила'}</strong>
    </header>
    {state !== 'rejected' && <>
      <h3 id={titleId}>{recommendation.title}</h3>
      <p>{recommendation.explanation}</p>
      <small className="progress-next-step-evidence">Основание: {recommendation.evidence}</small>
    </>}
    {state === 'draft' && <div className="progress-next-step-actions" aria-label="Действия с черновиком рекомендации">
      <button type="button" className="secondary" onClick={() => setState('confirmed')}>Подтвердить</button>
      {choices.length > 1 && <button type="button" className="link" onClick={() => setState('editing')}>Изменить</button>}
      <button type="button" className="link" onClick={() => setState('rejected')}>Отклонить</button>
    </div>}
    {state === 'editing' && <form className="progress-next-step-editor" onSubmit={(event) => {
      event.preventDefault()
      const selected = choices.find((item) => item.id === editedId)
      if (selected) setRecommendation({ ...selected, source: 'user' })
      setState('draft')
    }}>
      <fieldset><legend>Выбери другой допустимый шаг</legend>
        {choices.map((item) => <label key={item.id}>
          <input type="radio" name="next-step" value={item.id} checked={editedId === item.id} onChange={() => setEditedId(item.id)} />
          <span>{item.title}</span>
        </label>)}
      </fieldset>
      <div className="progress-next-step-actions">
        <button type="submit" className="secondary">Применить к черновику</button>
        <button type="button" className="link" onClick={() => setState('draft')}>Отмена</button>
      </div>
    </form>}
    {state === 'confirmed' && <div className="progress-next-step-decision" role="status">
      <p>Черновик подтверждён. Ничего не сохранено и план не изменён автоматически.</p>
      {actionHref && recommendation.actionLabel && <Link className="secondary" to={actionHref}>{recommendation.actionLabel}</Link>}
      <div className="progress-next-step-actions">
        {choices.length > 1 && <button type="button" className="link" onClick={() => setState('editing')}>Изменить</button>}
        <button type="button" className="link" onClick={() => setState('rejected')}>Отклонить</button>
      </div>
    </div>}
    {state === 'rejected' && <div className="progress-next-step-decision" role="status">
      <h3 id={titleId}>Рекомендация отклонена</h3>
      <p>Ничего не сохранено и план остался без изменений.</p>
      <button type="button" className="link" onClick={() => {
        setRecommendation(result.recommendation)
        setEditedId(result.recommendation.id)
        setState('draft')
      }}>Вернуть черновик</button>
    </div>}
  </section>
}
