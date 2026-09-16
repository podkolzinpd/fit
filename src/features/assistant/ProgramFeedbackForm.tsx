import { useState, type FormEvent } from 'react'
import { useDataBackend } from '../../app/data-backend-context'
import { trackGoal } from '../../shared/yandex-metrika'
import { SaveStatus } from '../../shared/ui'

type Props = {
  modelInputJson: Record<string, unknown>
  modelOutputJson: Record<string, unknown>
  onClose: () => void
}

export function ProgramFeedbackForm({ modelInputJson, modelOutputJson, onClose }: Props) {
  const { appFeedback } = useDataBackend()
  const [choice, setChoice] = useState<'good' | 'problem'>()
  const [comment, setComment] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string>()
  const needsComment = choice === 'problem'
  const canSubmit = choice === 'good' || (needsComment && comment.trim().length >= 3)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canSubmit || submitting) return
    setSubmitting(true); setError(undefined)
    try {
      await appFeedback.submit('training program', choice === 'good' ? 'Программа тренировок: всё хорошо.' : comment, { modelInputJson, modelOutputJson })
      setSent(true)
      trackGoal('training_program_feedback_submitted')
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Не удалось отправить обратную связь.')
    } finally { setSubmitting(false) }
  }

  if (sent) return <section className="app-feedback-card app-feedback-sent" role="status">
    <p className="eyebrow">СПАСИБО</p><h2>Обратная связь отправлена</h2>
    <p>К ней приложены полные данные запроса к модели, её ответы и идентификаторы генерации.</p>
    <button type="button" className="secondary" onClick={onClose}>Готово</button>
  </section>

  return <form className="app-feedback-card" aria-labelledby="program-feedback-title" onSubmit={submit}>
    <div className="app-feedback-head"><div><p className="eyebrow">ПРОВЕРКА ПРОГРАММЫ</p><h2 id="program-feedback-title">Как вам программа?</h2></div><button type="button" className="link" onClick={onClose}>Закрыть</button></div>
    <div className="app-feedback-kinds" role="group" aria-label="Оценка программы">
      <button type="button" aria-pressed={choice === 'good'} className={choice === 'good' ? 'active' : ''} disabled={submitting} onClick={() => setChoice('good')}>Всё хорошо</button>
      <button type="button" aria-pressed={choice === 'problem'} className={choice === 'problem' ? 'active' : ''} disabled={submitting} onClick={() => setChoice('problem')}>Что-то не так</button>
    </div>
    {needsComment && <label className="field"><span>Что именно стоит исправить?</span><textarea aria-label="Комментарий к программе" autoFocus rows={5} maxLength={2000} value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Опишите проблему или желаемое изменение." /><small className="app-feedback-counter">{comment.length}/2000</small></label>}
    <p className="app-feedback-context">Вместе с оценкой отправятся полный JSON запроса к модели, все её JSON-ответы и идентификаторы запросов/генерации.</p>
    <SaveStatus status={submitting ? 'saving' : error ? 'error' : 'idle'} error={error} />
    <div className="actions"><button type="button" className="secondary" onClick={onClose}>Отмена</button><button className="primary" disabled={!canSubmit || submitting}>{submitting ? 'Отправляю…' : 'Отправить отзыв'}</button></div>
  </form>
}
