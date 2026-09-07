import { useState, type FormEvent } from 'react'
import type { AppFeedbackKind } from '../../data/repositories/app-feedback.repository'
import { useDataBackend } from '../../app/data-backend-context'
import { trackGoal } from '../../shared/yandex-metrika'
import { SaveStatus } from '../../shared/ui'

export function AppFeedbackForm({ onClose }: { onClose: () => void }) {
  const { appFeedback: appFeedbackRepository } = useDataBackend()
  const [kind, setKind] = useState<AppFeedbackKind>('suggestion')
  const [message, setMessage] = useState('')
  const [validationError, setValidationError] = useState<string | null>(null)
  const [submissionError, setSubmissionError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [sent, setSent] = useState(false)

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (message.trim().length < 3) {
      setValidationError('Напишите хотя бы несколько слов.')
      return
    }
    setValidationError(null)
    setSubmissionError(null)
    setSubmitting(true)
    try {
      await appFeedbackRepository.submit(kind, message)
      setSent(true)
      trackGoal('app_feedback_submitted')
    } catch (error) {
      setSubmissionError(error instanceof Error ? error.message : 'Не удалось отправить сообщение.')
    } finally {
      setSubmitting(false)
    }
  }

  if (sent) return <section className="app-feedback-card app-feedback-sent" role="status">
    <p className="eyebrow">СПАСИБО</p>
    <h2>Сообщение отправлено</h2>
    <p>Мы получили его вместе с экраном и версией Fit — ничего дополнительно описывать не нужно.</p>
    <button type="button" className="secondary" onClick={onClose}>Готово</button>
  </section>

  return <form className="app-feedback-card" aria-labelledby="app-feedback-title" onSubmit={onSubmit}>
    <div className="app-feedback-head">
      <div><p className="eyebrow">ОБРАТНАЯ СВЯЗЬ</p><h2 id="app-feedback-title">Напишите команде Fit</h2></div>
      <button type="button" className="link" onClick={onClose}>Закрыть</button>
    </div>
    <div className="app-feedback-kinds" role="group" aria-label="Тип сообщения">
      <button type="button" aria-pressed={kind === 'suggestion'} className={kind === 'suggestion' ? 'active' : ''} onClick={() => setKind('suggestion')}>Предложение</button>
      <button type="button" aria-pressed={kind === 'problem'} className={kind === 'problem' ? 'active' : ''} onClick={() => setKind('problem')}>Проблема</button>
    </div>
    <label className="field"><span>Сообщение</span><textarea aria-label="Сообщение" autoFocus rows={5} maxLength={2000} value={message} onChange={(event) => {
      setMessage(event.target.value)
      if (validationError) setValidationError(null)
      if (submissionError) setSubmissionError(null)
    }} placeholder={kind === 'suggestion' ? 'Что можно сделать удобнее?' : 'Что произошло и чего вы ожидали?'} />
      <small className="app-feedback-counter">{message.length}/2000</small>
      {validationError && <small className="error">{validationError}</small>}
    </label>
    <p className="app-feedback-context">Экран, роль и версия приложения добавятся автоматически.</p>
    <SaveStatus status={submitting ? 'saving' : submissionError ? 'error' : 'idle'} error={submissionError ?? undefined} />
    <div className="actions"><button type="button" className="secondary" onClick={onClose}>Отмена</button><button className="primary" disabled={submitting || message.trim().length < 3}>Отправить</button></div>
  </form>
}
