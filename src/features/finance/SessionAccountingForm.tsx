import { SingleSessionFields, readSingleServiceFields, type SingleServiceDraft } from './SingleSessionFields'
import { useState } from 'react'
import type { TrainerFinancePackage, TrainerFinanceSession } from '../../data/contracts/trainer-finance'
import { Field, InlineRequestError } from '../../shared/ui'
import { FinanceAccountingChoices } from './FinanceAccountingChoices'

export interface SessionAccountingDraft {
  singleService?: SingleServiceDraft
  workoutDate: string
  value: string
  comment: string | null
}

export function SessionAccountingForm({ packages, today, session, initialDraft, locked = false, lime = false, saving, error,
  onCancel, onSubmit }: {
  packages: TrainerFinancePackage[]
  today: string
  session?: TrainerFinanceSession
  initialDraft?: SessionAccountingDraft
  locked?: boolean
  lime?: boolean
  saving: boolean
  error?: Error | null
  onCancel: () => void
  onSubmit: (draft: SessionAccountingDraft) => void
}) {
  const [validationError,setValidationError]=useState<string|null>(null)
  const [date, setDate] = useState(initialDraft?.workoutDate ?? session?.workoutDate ?? today)
  const [value, setValue] = useState(initialDraft?.value ?? (session?.disposition === 'charged'
    ? `charged:${session.packageId}` : session?.disposition ?? 'unassigned'))
  const [comment, setComment] = useState(initialDraft?.comment ?? session?.comment ?? '')
  const eligibleAt = (workoutDate: string) => packages.filter(item => item.kind === 'session_pack'
    && item.closedAt === null && item.startsOn <= workoutDate
    && (item.endsOn === null || item.endsOn >= workoutDate)
    && item.sessionsUsed - (session?.disposition === 'charged' && session.packageId === item.id ? 1 : 0) < item.sessionsTotal)
  const eligible = eligibleAt(date)
  const invalidCharge = value.startsWith('charged:') && !eligible.some(item => `charged:${item.id}` === value)
  return <form className={session ? 'finance-session-editor' : 'finance-manual-session'} aria-busy={saving}
    onSubmit={event => {
      event.preventDefault()
      setValidationError(null)
      try { if (!saving && (!invalidCharge || locked)) onSubmit({ workoutDate: date, value, comment: comment.trim() || null,
        ...(value==='single:new'?{singleService:locked&&initialDraft?.singleService?initialDraft.singleService:readSingleServiceFields(event.currentTarget,today,initialDraft?.singleService)}:{}) })
      } catch(cause) { setValidationError(cause instanceof Error?cause.message:'Проверьте сумму') }
    }}>
    <Field label={session ? 'Дата' : 'Дата занятия'}><input name="workoutDate" type="date" required
      value={date} disabled={saving || locked} onChange={event => {
        const next = event.target.value
        setDate(next)
        if (value.startsWith('charged:') && !eligibleAt(next).some(item => `charged:${item.id}` === value)) setValue('unassigned')
      }} /></Field>
    {lime ? <FinanceAccountingChoices allowNewSingle={!session} historicalTrial={session?.disposition==='trial'} packages={eligible} value={value} disabled={saving || locked}
      unavailableValue={invalidCharge ? value : undefined} onChange={setValue} /> : <Field label="Учёт"><select name="accounting" value={value} disabled={saving || locked} onChange={event => setValue(event.target.value)}>
      <option value="unassigned">Выбрать позже</option>
      {eligible.map(item => <option key={item.id} value={`charged:${item.id}`}>Списать: {item.title}</option>)}
      {invalidCharge && <option value={value} disabled>Абонемент недоступен</option>}
      <option value="free">Без списания</option><option value="trial">Пробное</option>
    </select></Field>}
    {lime && value==='single:new' && <SingleSessionFields today={today} disabled={saving||locked} initial={initialDraft?.singleService}/>}
    <Field label="Комментарий"><input name="comment" maxLength={2000} value={comment} disabled={saving || locked} onChange={event => setComment(event.target.value)} /></Field>
    {validationError && <p className="error" role="alert">{validationError}</p>}
    {error && <InlineRequestError error={error} message={locked ? 'Сохранение не подтверждено' : undefined} />}
    <div className="actions"><button type="button" className="secondary" disabled={saving} onPointerDown={event => event.preventDefault()} onClick={onCancel}>Отмена</button>
      <button type="submit" className="primary" disabled={saving || (invalidCharge && !locked)} onPointerDown={event => event.preventDefault()}>
        {saving ? session ? 'Сохраняем…' : 'Добавляем…' : locked ? 'Повторить сохранение' : session ? 'Сохранить' : 'Добавить'}
      </button></div>
  </form>
}
