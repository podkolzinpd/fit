import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAuth } from '../../app/auth-context'
import { useDataBackend } from '../../app/data-backend-context'
import type {
  TrainerFinancePackage,
  TrainerFinancePackageDraft,
  TrainerFinancePayment, TrainerFinanceSession,
  TrainerFinancePaymentDraft,
} from '../../data/repositories/trainer-finance.repository'
import { formatLocalDate, localDate, todayInTimeZone } from '../../shared/local-date'
import { AsyncView, Field, InlineRequestError, OverflowMenu, Page, useConfirm } from '../../shared/ui'

const PACKAGE_STATUS: Record<TrainerFinancePackage['packageStatus'], string> = {
  active: 'Активен', upcoming: 'Начнётся позже', completed: 'Завершён', expired: 'Срок закончился', closed: 'Закрыт',
}
const PAYMENT_STATUS: Record<TrainerFinancePackage['paymentStatus'], string> = {
  unpaid: 'Не оплачен', partial: 'Оплачен частично', paid: 'Оплачен', overdue: 'Просрочен',
}
const SESSION_STATUS: Record<TrainerFinanceSession['disposition'], string> = {
  charged: 'Списано', unassigned: 'Нужно выбрать абонемент', free: 'Без списания', trial: 'Пробное',
}

function money(cents: number) {
  return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: cents % 100 === 0 ? 0 : 2 }).format(cents / 100)
}

function cents(value: FormDataEntryValue | null): number {
  const normalized = String(value ?? '').trim().replace(/\s/g, '').replace(',', '.')
  const amount = Number(normalized)
  if (!Number.isFinite(amount) || amount < 0) throw new Error('Проверьте сумму')
  return Math.round(amount * 100)
}

function integer(value: FormDataEntryValue | null, label: string) {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`Проверьте поле «${label}»`)
  return parsed
}

function optional(form: FormData, name: string) {
  const value = String(form.get(name) ?? '').trim()
  return value || null
}

function PackageForm({ current, today, saving, error, onCancel, onSubmit }: {
  current?: TrainerFinancePackage
  today: string
  saving: boolean
  error: Error | null
  onCancel: () => void
  onSubmit: (draft: TrainerFinancePackageDraft) => void
}) {
  const [validationError, setValidationError] = useState<string | null>(null)
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setValidationError(null)
    try {
      const form = new FormData(event.currentTarget)
      const sessionsTotal = integer(form.get('sessionsTotal'), 'Всего занятий')
      const openingUsedSessions = current ? 0 : integer(form.get('openingUsedSessions'), 'Уже проведено')
      if (sessionsTotal < 1 || openingUsedSessions > sessionsTotal) throw new Error('Проведённых занятий не может быть больше общего количества')
      onSubmit({
        title: String(form.get('title') ?? '').trim(), sessionsTotal, openingUsedSessions,
        priceCents: cents(form.get('price')), openingPaidCents: current ? 0 : cents(form.get('openingPaid')),
        startsOn: String(form.get('startsOn') ?? ''), endsOn: optional(form, 'endsOn'),
        paymentDueOn: optional(form, 'paymentDueOn'), comment: optional(form, 'comment'),
      })
    } catch (cause) {
      setValidationError(cause instanceof Error ? cause.message : 'Проверьте данные')
    }
  }
  return <form className="finance-form card" onSubmit={submit}>
    <div className="finance-form-heading"><div><p className="eyebrow">АБОНЕМЕНТ</p><h2>{current ? 'Редактирование' : 'Новый абонемент'}</h2></div></div>
    <Field label="Название"><input name="title" required maxLength={120} defaultValue={current?.title ?? 'Персональные тренировки'} /></Field>
    <div className="finance-form-grid">
      <Field label="Всего занятий"><input name="sessionsTotal" type="number" inputMode="numeric" min="1" max="10000" required defaultValue={current?.sessionsTotal ?? 10} /></Field>
      {!current && <Field label="Уже проведено"><input name="openingUsedSessions" type="number" inputMode="numeric" min="0" max="10000" required defaultValue="0" /></Field>}
      <Field label="Стоимость, ₽"><input name="price" type="number" inputMode="decimal" min="0" step="0.01" required defaultValue={current ? current.priceCents / 100 : ''} /></Field>
      {!current && <Field label="Уже оплачено, ₽"><input name="openingPaid" type="number" inputMode="decimal" min="0" step="0.01" required defaultValue="0" /></Field>}
      <Field label="Начало"><input name="startsOn" type="date" required defaultValue={current?.startsOn ?? today} /></Field>
      <Field label="Окончание"><input name="endsOn" type="date" defaultValue={current?.endsOn ?? ''} /></Field>
      <Field label="Оплатить до"><input name="paymentDueOn" type="date" defaultValue={current?.paymentDueOn ?? ''} /></Field>
    </div>
    <Field label="Комментарий"><textarea name="comment" rows={2} maxLength={2000} defaultValue={current?.comment ?? ''} /></Field>
    {validationError && <p className="error" role="alert">{validationError}</p>}
    {error && <InlineRequestError error={error} />}
    <div className="actions"><button type="button" className="secondary" onClick={onCancel}>Отмена</button><button type="submit" className="primary" disabled={saving}>{saving ? 'Сохраняем…' : 'Сохранить'}</button></div>
  </form>
}

function PaymentForm({ current, today, saving, error, onCancel, onSubmit }: {
  current?: TrainerFinancePayment
  today: string
  saving: boolean
  error: Error | null
  onCancel: () => void
  onSubmit: (draft: TrainerFinancePaymentDraft) => void
}) {
  const [validationError, setValidationError] = useState<string | null>(null)
  return <form className="finance-form card" onSubmit={(event) => {
    event.preventDefault()
    setValidationError(null)
    try {
      const form = new FormData(event.currentTarget)
      const amountCents = cents(form.get('amount'))
      if (amountCents < 1) throw new Error('Сумма должна быть больше нуля')
      onSubmit({ amountCents, receivedOn: String(form.get('receivedOn') ?? ''), comment: optional(form, 'comment') })
    } catch (cause) {
      setValidationError(cause instanceof Error ? cause.message : 'Проверьте данные')
    }
  }}>
    <div className="finance-form-heading"><div><p className="eyebrow">ОПЛАТА</p><h2>{current ? 'Редактирование' : 'Добавить оплату'}</h2></div></div>
    <div className="finance-form-grid"><Field label="Сумма, ₽"><input name="amount" type="number" inputMode="decimal" min="0.01" step="0.01" required defaultValue={current ? current.amountCents / 100 : ''} /></Field><Field label="Дата"><input name="receivedOn" type="date" required defaultValue={current?.receivedOn ?? today} /></Field></div>
    <Field label="Комментарий"><input name="comment" maxLength={2000} defaultValue={current?.comment ?? ''} /></Field>
    {validationError && <p className="error" role="alert">{validationError}</p>}
    {error && <InlineRequestError error={error} />}
    <div className="actions"><button type="button" className="secondary" onClick={onCancel}>Отмена</button><button type="submit" className="primary" disabled={saving}>{saving ? 'Сохраняем…' : 'Сохранить'}</button></div>
  </form>
}

export function TrainerFinancePage() {
  const { clientId = '' } = useParams()
  const { actor } = useAuth()
  const { clients, trainerFinance, workouts } = useDataBackend()
  const queryClient = useQueryClient()
  const today = todayInTimeZone(actor?.timezone)
  const [packageEditor, setPackageEditor] = useState<TrainerFinancePackage | 'new' | null>(null)
  const [paymentEditor, setPaymentEditor] = useState<{ packageId: string; payment?: TrainerFinancePayment } | null>(null)
  const [manualOpen, setManualOpen] = useState(false)
  const [confirm, confirmDialog] = useConfirm()
  const client = useQuery({ queryKey: ['client', clientId], queryFn: () => clients.get(clientId) })
  const finance = useQuery({ queryKey: ['trainer-finance', clientId], queryFn: () => trainerFinance.listClient(clientId) })
  const refresh = async () => { await queryClient.invalidateQueries({ queryKey: ['trainer-finance', clientId] }) }
  const savePackage = useMutation({
    mutationFn: async (draft: TrainerFinancePackageDraft) => packageEditor === 'new'
      ? trainerFinance.createPackage(clientId, draft)
      : trainerFinance.updatePackage(packageEditor!.id, { ...draft, expectedVersion: packageEditor!.version }),
    onSuccess: async () => { setPackageEditor(null); await refresh() },
  })
  const savePayment = useMutation({
    mutationFn: async (draft: TrainerFinancePaymentDraft) => paymentEditor?.payment
      ? trainerFinance.updatePayment(paymentEditor.payment.id, { ...draft, expectedVersion: paymentEditor.payment.version })
      : trainerFinance.addPayment(paymentEditor!.packageId, draft),
    onSuccess: async () => { setPaymentEditor(null); await refresh() },
  })
  const removePayment = useMutation({
    mutationFn: (payment: TrainerFinancePayment) => trainerFinance.voidPayment(payment.id, payment.version, 'Удалено тренером'),
    onSuccess: refresh,
  })
  const addManualSession = useMutation({
    mutationFn: (workoutDate: string) => workouts.saveCompleted({
      requestId: crypto.randomUUID(), clientId, workoutDate: localDate(workoutDate),
      notes: 'Проведённое занятие', exercises: [],
    }),
    onSuccess: async () => { setManualOpen(false); await refresh() },
  })
  const updateSession = useMutation({
    mutationFn: ({ session, value }: { session: TrainerFinanceSession; value: string }) => {
      const [disposition, packageId = ''] = value.split(':')
      return trainerFinance.updateSession(session.id, {
        expectedVersion: session.version,
        disposition: disposition as TrainerFinanceSession['disposition'],
        packageId: disposition === 'charged' ? packageId : null,
        comment: disposition === 'unassigned' ? 'Нужно выбрать абонемент' : null,
      })
    },
    onSuccess: refresh,
  })
  const packages = finance.data?.packages ?? []
  return <Page title="Абонементы и оплаты" subtitle={client.data?.fullName} back={`/clients/${clientId}`} swipeBack className="trainer-finance-page">
    <AsyncView loading={client.isLoading || finance.isLoading} error={(client.error ?? finance.error) as Error | null} onRetry={() => { void client.refetch(); void finance.refetch() }}>
      {packageEditor && <PackageForm current={packageEditor === 'new' ? undefined : packageEditor} today={today} saving={savePackage.isPending} error={savePackage.error} onCancel={() => setPackageEditor(null)} onSubmit={(draft) => savePackage.mutate(draft)} />}
      {!packageEditor && <>
        <section className="finance-page-intro"><div><p className="eyebrow">УЧЁТ</p><h2>{packages.length ? 'Абонементы' : 'Добавьте первый абонемент'}</h2><p>{packages.length ? 'Занятия и оплаты считаются отдельно.' : 'Укажите количество занятий, стоимость и уже внесённую сумму.'}</p></div><button type="button" className="primary" onClick={() => setPackageEditor('new')}>Новый абонемент</button></section>
        <div className="finance-package-list">{packages.map((item) => {
          const payments = (finance.data?.payments ?? []).filter((payment) => payment.packageId === item.id && payment.voidedAt === null)
          return <article className="finance-package card" key={item.id}>
            <header><div><span className={`finance-status finance-status-${item.packageStatus}`}>{PACKAGE_STATUS[item.packageStatus]}</span><h2>{item.title}</h2></div><OverflowMenu label={`Действия с абонементом ${item.title}`} items={[{ label: 'Редактировать', onClick: () => setPackageEditor(item) }]} /></header>
            <div className="finance-package-summary"><p><strong>{item.sessionsRemaining}</strong><span>занятий осталось из {item.sessionsTotal}</span></p><p><strong>{money(item.paidCents)}</strong><span>{PAYMENT_STATUS[item.paymentStatus]} · всего {money(item.priceCents)}</span></p></div>
            <p className="finance-package-dates">С {formatLocalDate(localDate(item.startsOn))}{item.endsOn ? ` по ${formatLocalDate(localDate(item.endsOn))}` : ''}</p>
            {item.dueCents > 0 && <p className={`finance-due${item.paymentStatus === 'overdue' ? ' is-overdue' : ''}`}>Осталось оплатить {money(item.dueCents)}</p>}
            {item.comment && <p className="finance-comment">{item.comment}</p>}
              <div className="finance-payments-heading"><h3>Оплаты</h3><button type="button" className="link" onClick={() => setPaymentEditor({ packageId: item.id })}>Добавить оплату</button></div>
            {paymentEditor?.packageId === item.id && <PaymentForm current={paymentEditor.payment} today={today} saving={savePayment.isPending} error={savePayment.error} onCancel={() => setPaymentEditor(null)} onSubmit={(draft) => savePayment.mutate(draft)} />}
            {!paymentEditor || paymentEditor.packageId !== item.id ? <div className="finance-payment-list">{payments.length ? payments.map((payment) => <div className="finance-payment" key={payment.id}><div><strong>{money(payment.amountCents)}</strong><span>{formatLocalDate(localDate(payment.receivedOn))}{payment.comment ? ` · ${payment.comment}` : ''}</span></div><OverflowMenu label={`Действия с оплатой ${money(payment.amountCents)}`} items={[{ label: 'Изменить', onClick: () => setPaymentEditor({ packageId: item.id, payment }) }, { label: 'Удалить', danger: true, onClick: () => void confirm({ message: `Удалить оплату ${money(payment.amountCents)}? Итог пересчитается, запись останется в истории.`, confirmLabel: 'Удалить', danger: true }).then((ok) => { if (ok) removePayment.mutate(payment) }) }]} /></div>) : <p className="finance-empty">Оплат пока нет</p>}</div> : null}
          </article>
        })}</div>
        {finance.isSuccess && packages.length === 0 && <p className="finance-empty">Финансовых записей пока нет.</p>}
        <section className="finance-sessions card">
          <div className="finance-payments-heading"><div><p className="eyebrow">ЗАНЯТИЯ</p><h2>Проведённые</h2></div><button type="button" className="link" onClick={() => setManualOpen((value) => !value)}>{manualOpen ? 'Закрыть' : 'Добавить занятие'}</button></div>
          {manualOpen && <form className="finance-manual-session" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); addManualSession.mutate(String(form.get('workoutDate') ?? '')) }}><Field label="Дата занятия"><input name="workoutDate" type="date" required defaultValue={today} /></Field><button type="submit" className="primary" disabled={addManualSession.isPending}>{addManualSession.isPending ? 'Добавляем…' : 'Добавить проведённое занятие'}</button></form>}
          <div className="finance-session-list">{(finance.data?.sessions ?? []).filter((session) => session.voidedAt === null).map((session) => <div className="finance-session" key={session.id}><Link to={`/workouts/${session.workoutId}`}><strong>{formatLocalDate(localDate(session.workoutDate))}</strong><span>{session.source === 'manual' ? 'Добавлено вручную' : 'Из завершённой тренировки'}</span></Link><label><span className="sr-only">Учёт занятия за {formatLocalDate(localDate(session.workoutDate))}</span><select value={session.disposition === 'charged' ? `charged:${session.packageId}` : session.disposition} disabled={updateSession.isPending} onChange={(event) => updateSession.mutate({ session, value: event.target.value })}><option value="unassigned">Выбрать абонемент</option>{packages.filter((item) => item.id === session.packageId || (item.closedAt === null && item.sessionsRemaining > 0 && item.startsOn <= session.workoutDate && (item.endsOn === null || item.endsOn >= session.workoutDate))).map((item) => <option key={item.id} value={`charged:${item.id}`}>Списать: {item.title}</option>)}<option value="free">Без списания</option><option value="trial">Пробное</option></select></label><small>{SESSION_STATUS[session.disposition]}</small></div>)}</div>
          {finance.isSuccess && !(finance.data?.sessions ?? []).some((session) => session.voidedAt === null) && <p className="finance-empty">Проведённых занятий пока нет.</p>}
          {addManualSession.error && <InlineRequestError error={addManualSession.error} />}
          {updateSession.error && <InlineRequestError error={updateSession.error} />}
        </section>
      </>}
      {removePayment.error && <InlineRequestError error={removePayment.error} />}
    </AsyncView>
    {confirmDialog}
  </Page>
}
