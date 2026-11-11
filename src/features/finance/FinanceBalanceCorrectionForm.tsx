import { useId, useState, type FormEvent } from 'react'
import type { TrainerFinanceBalanceCorrection, TrainerFinancePackage } from '../../data/contracts/trainer-finance'
import { RepositoryError } from '../../data/repositories/error'
import { Field, InlineRequestError } from '../../shared/ui'

export function FinanceBalanceCorrectionForm({ item, initialDraft, locked, saving, error, onCancel, onSubmit }: {
  item: TrainerFinancePackage
  initialDraft?: TrainerFinanceBalanceCorrection
  locked: boolean
  saving: boolean
  error: Error | null
  onCancel: () => void
  onSubmit: (value: Pick<TrainerFinanceBalanceCorrection, 'remainingSessions' | 'reason'>) => void
}) {
  const id = useId()
  const [remaining, setRemaining] = useState(String(initialDraft?.remainingSessions ?? item.sessionsRemaining))
  const [reason, setReason] = useState(initialDraft?.reason ?? '')
  const [invalid, setInvalid] = useState(false)
  const invalidRemaining = remaining.trim() === '' || !Number.isSafeInteger(Number(remaining)) || Number(remaining) < 0 || Number(remaining) > item.sessionsTotal
  const invalidReason = !reason.trim() || reason.trim().length > 500
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving) return
    setInvalid(true)
    if (invalidRemaining || invalidReason) {
      event.currentTarget.querySelector<HTMLInputElement | HTMLTextAreaElement>(invalidRemaining ? 'input' : 'textarea')?.focus()
      return
    }
    onSubmit({ remainingSessions: Number(remaining), reason: reason.trim() })
  }
  const message = error instanceof RepositoryError && error.code === 'PT422'
    ? 'Проверьте остаток с учётом уже списанных занятий. Ошибочное списание можно исправить в разделе «Занятия».'
    : error instanceof RepositoryError && ['PT409', '40001'].includes(error.code)
      ? 'Данные блока изменились. Проверьте текущий остаток и сохраните ещё раз.' : undefined
  return <form className="finance-form card lime-finance-form" aria-busy={saving} noValidate onSubmit={submit}>
    <div className="finance-form-heading"><h2>Скорректировать остаток</h2></div>
    <p>{item.title} · Сейчас {item.sessionsRemaining} из {item.sessionsTotal}</p>
    <div className="lime-finance-field"><Field label="Должно остаться"><input type="number" inputMode="numeric" min="0" max={item.sessionsTotal} step="1" required
      disabled={saving || locked} value={remaining} onChange={event => setRemaining(event.target.value)}
      aria-invalid={invalid && invalidRemaining} aria-describedby={invalid && invalidRemaining ? `${id}-remaining` : undefined} /></Field>
      {invalid && invalidRemaining && <small className="error" role="alert" id={`${id}-remaining`}>Укажите целое число от 0 до {item.sessionsTotal}.</small>}</div>
    <div className="lime-finance-field"><Field label="Причина"><textarea rows={2} required maxLength={500} disabled={saving || locked}
      value={reason} onChange={event => setReason(event.target.value)} aria-invalid={invalid && invalidReason}
      aria-describedby={invalid && invalidReason ? `${id}-reason` : undefined} /></Field>
      {invalid && invalidReason && <small className="error" role="alert" id={`${id}-reason`}>Укажите причину корректировки.</small>}</div>
    {error && <InlineRequestError error={error} message={message} />}
    <div className="actions"><button type="button" className="secondary" disabled={saving} onClick={onCancel}>Отмена</button>
      <button type="submit" className="primary" disabled={saving || (!locked && Number(remaining) === item.sessionsRemaining)}>{saving ? 'Сохраняем…' : locked ? 'Повторить сохранение' : 'Сохранить'}</button></div>
  </form>
}
