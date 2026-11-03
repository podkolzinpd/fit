import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useId, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { useAuth } from '../../app/auth-context'
import { isFitLimeEnabled } from '../../app/fit-lime'
import { useDataBackend } from '../../app/data-backend-context'
import { invalidateFinanceViews } from '../../app/invalidate-finance-views'
import { invalidateWorkoutResults } from '../../app/invalidate-workout-results'
import { RepositoryError } from '../../data/repositories/error'
import { SessionAccountingForm, type SessionAccountingDraft } from './SessionAccountingForm'
import type { TrainerFinancePackage, TrainerFinancePackageDraft, TrainerFinancePayment, TrainerFinanceSession, TrainerFinancePaymentDraft } from '../../data/contracts/trainer-finance'
import { addDays, daysBetween, formatLocalDate, localDate, todayInTimeZone } from '../../shared/local-date'
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

export function PackageForm({ current, template, today, saving, error, onCancel, onSubmit, lime = false }: {
  lime?: boolean
  current?: TrainerFinancePackage
  template?: TrainerFinancePackage
  today: string
  saving: boolean
  error: Error | null
  onCancel: () => void
  onSubmit: (draft: TrainerFinancePackageDraft) => void
}) {
  const [validationError, setValidationError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const errorId = useId()
  const source = current ?? template
  const renewalStart = template?.endsOn && template.endsOn >= today ? addDays(localDate(template.endsOn), 1) : today
  const renewalEnd = template?.endsOn && template.endsOn >= template.startsOn
    ? addDays(localDate(renewalStart), daysBetween(localDate(template.startsOn), localDate(template.endsOn))) : ''
  const [startsOn, setStartsOn] = useState(current?.startsOn ?? renewalStart)
  const [kind, setKind] = useState<TrainerFinancePackage['kind']>(source?.kind ?? 'session_pack')
  const [title, setTitle] = useState(source?.title ?? 'Персональные тренировки')
  const [priceValue, setPriceValue] = useState(source ? String(source.priceCents / 100) : '')
  const [paidValue, setPaidValue] = useState('0')
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setValidationError(null)
    if (lime) {
      const form = event.currentTarget
      const values = new FormData(form)
      const errors: Record<string, string> = {}
      if (!String(values.get('title') ?? '').trim()) errors.title = 'Укажите название услуги'
      if (kind === 'session_pack' && !current && Number(values.get('openingUsedSessions')) > Number(values.get('sessionsTotal'))) {
        errors.openingUsedSessions = 'Проведённых занятий не может быть больше общего количества'
      }
      if (!current && Number(values.get('openingPaid')) > Number(values.get('price'))) errors.openingPaid = 'Оплата не может быть больше стоимости'
      const messages: Record<string, string> = {
        title: 'Укажите название до 120 символов', sessionsTotal: 'Укажите целое количество занятий от 1 до 10 000',
        openingUsedSessions: 'Укажите целое количество проведённых занятий от 0 до общего количества',
        price: 'Укажите стоимость в рублях: от 0, не больше двух знаков после запятой',
        openingPaid: 'Укажите оплату в рублях: от 0, не больше двух знаков после запятой',
        startsOn: 'Укажите дату начала', endsOn: 'Укажите дату окончания не раньше начала',
        openingReceivedOn: 'Укажите дату получения', paymentDueOn: 'Проверьте дату оплаты', comment: 'Сократите комментарий до 2000 символов',
      }
      const controls = Array.from(form.elements).filter((element): element is HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement =>
        element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement)
      for (const control of controls) {
        if (!control.validity.valid && !errors[control.name]) errors[control.name] = messages[control.name] ?? 'Проверьте значение'
      }
      setFieldErrors(errors)
      const first = controls.find((control) => errors[control.name])
      if (first) {
        const disclosure = first.closest('details')
        if (disclosure) disclosure.open = true
        first.focus()
        first.scrollIntoView?.({ block: 'nearest' })
        return
      }
    }
    try {
      const form = new FormData(event.currentTarget)
      const sessionsTotal = kind === 'session_pack' ? integer(form.get('sessionsTotal'), 'Всего занятий') : 0
      const openingUsedSessions = kind === 'session_pack' && !current ? integer(form.get('openingUsedSessions'), 'Уже проведено') : 0
      const priceCents = cents(form.get('price'))
      const openingPaidCents = current ? 0 : cents(form.get('openingPaid'))
      if (kind === 'session_pack' && (sessionsTotal < 1 || openingUsedSessions > sessionsTotal)) throw new Error('Проведённых занятий не может быть больше общего количества')
      if (openingPaidCents > priceCents) throw new Error('Начальная оплата не может быть больше стоимости абонемента')
      const endsOn = optional(form, 'endsOn')
      if (endsOn && endsOn < startsOn) throw new Error('Окончание не может быть раньше начала')
      onSubmit({
        kind, title: String(form.get('title') ?? '').trim(), sessionsTotal, openingUsedSessions,
        priceCents, openingPaidCents,
        ...(!current && openingPaidCents > 0 ? { openingReceivedOn: String(form.get('openingReceivedOn') ?? '') } : {}),
        startsOn, endsOn,
        paymentDueOn: optional(form, 'paymentDueOn'), comment: optional(form, 'comment'),
      })
    } catch (cause) {
      setValidationError(cause instanceof Error ? cause.message : 'Проверьте данные')
    }
  }
  const validation = (name: string) => lime ? { 'aria-invalid': Boolean(fieldErrors[name]), 'aria-describedby': fieldErrors[name] ? `${errorId}-${name}` : undefined } : {}
  const field = (name: string, label: string, input: ReactNode) => lime
    ? <div key={name} className="lime-finance-field"><Field label={label}>{input}</Field>{fieldErrors[name] && <small className="error" role="alert" id={`${errorId}-${name}`}>{fieldErrors[name]}</small>}</div>
    : <Field key={name} label={label}>{input}</Field>
  const sessions = kind === 'session_pack' && field('sessionsTotal', lime ? 'Количество занятий' : 'Всего занятий', <input {...validation('sessionsTotal')} name="sessionsTotal" type="number" inputMode="numeric" min="1" max="10000" required defaultValue={source?.sessionsTotal || 10} />)
  const used = kind === 'session_pack' && !current && field('openingUsedSessions', lime ? 'Уже проведено, занятий' : 'Уже проведено', <input {...validation('openingUsedSessions')} name="openingUsedSessions" type="number" inputMode="numeric" min="0" max="10000" required defaultValue="0" />)
  const price = field('price', 'Стоимость, ₽', <input {...validation('price')} name="price" type="number" inputMode="decimal" min="0" step="0.01" required value={priceValue} onChange={(event) => setPriceValue(event.target.value)} />)
  const paid = !current && field('openingPaid', 'Уже оплачено, ₽', <input {...validation('openingPaid')} name="openingPaid" type="number" inputMode="decimal" min="0" step="0.01" required value={paidValue} onChange={(event) => setPaidValue(event.target.value)} />)
  const costAndPayment = <div className="finance-cost-payment">
    <div className="finance-payment-fields">{price}{paid}</div>
    {!current && <button type="button" className="link finance-fill-payment" disabled={saving || Number(priceValue) <= 0 || !priceValue} onClick={() => setPaidValue(priceValue)}>Вся сумма</button>}
    {!current && Number(paidValue) > 0 && field('openingReceivedOn', 'Дата получения', <input {...validation('openingReceivedOn')} name="openingReceivedOn" type="date" required defaultValue={today} />)}
  </div>
  const dates = <>
    {field('startsOn', 'Начало', <input {...validation('startsOn')} name="startsOn" type="date" required value={startsOn} onChange={(event) => setStartsOn(event.target.value)} />)}
    {field('endsOn', 'Окончание', <input {...validation('endsOn')} name="endsOn" type="date" required={kind === 'online_coaching'} min={startsOn} defaultValue={current?.endsOn ?? renewalEnd} />)}
    {field('paymentDueOn', 'Оплатить до', <input {...validation('paymentDueOn')} name="paymentDueOn" type="date" defaultValue={current?.paymentDueOn ?? ''} />)}
  </>
  return <form className={`finance-form card${lime ? ' lime-finance-form' : ''}`} noValidate={lime} aria-busy={saving} onSubmit={submit}>
    <div className="finance-form-heading"><div><p className="eyebrow">ФИНАНСЫ</p><h2>{current ? 'Редактирование' : template ? 'Продление' : 'Новая услуга'}</h2></div></div>
    <Field label="Тип"><select name="kind" value={kind} disabled={Boolean(current)} onChange={(event) => {
      const next = event.target.value as TrainerFinancePackage['kind']
      setKind(next)
      if (title === 'Персональные тренировки' || title === 'Онлайн-сопровождение') setTitle(next === 'session_pack' ? 'Персональные тренировки' : 'Онлайн-сопровождение')
    }}><option value="session_pack">Пакет занятий</option><option value="online_coaching">Онлайн-сопровождение</option></select></Field>
    {field('title', 'Название', <input {...validation('title')} name="title" required maxLength={120} value={title} onChange={(event) => setTitle(event.target.value)} />)}
    {lime ? <>
      {kind === 'session_pack' && <fieldset><legend>Занятия</legend>{sessions}</fieldset>}
      <fieldset><legend>Стоимость и оплата</legend>{costAndPayment}</fieldset>
      <fieldset><legend>Сроки</legend><div className="finance-form-grid">{dates}</div></fieldset>
      {used && <details className="finance-opening-balances"><summary>Уже проведённые занятия</summary><div className="finance-form-grid">{used}</div></details>}
    </> : <>{current
      ? <div className="finance-form-grid">{sessions}{price}</div>
      : <><div className="finance-form-grid">{sessions}{used}</div>{costAndPayment}</>}
      <div className="finance-form-grid">{dates}</div></>}
    {field('comment', 'Комментарий', <textarea {...validation('comment')} name="comment" rows={2} maxLength={2000} defaultValue={source?.comment ?? ''} />)}
    {validationError && <p className="error" role="alert">{validationError}</p>}
    {error && <InlineRequestError error={error} />}
    {/* Keep the focused input until click: keyboard recovery on pointerdown
        otherwise moves this row before pointerup and loses the submission. */}
    <div className="actions"><button type="button" className="secondary" disabled={saving} onPointerDown={(event) => event.preventDefault()} onClick={onCancel}>Отмена</button><button type="submit" className="primary" disabled={saving} onPointerDown={(event) => event.preventDefault()}>{saving ? 'Сохраняем…' : 'Сохранить'}</button></div>
  </form>
}

export function PaymentForm({ current, packages = [], packageId, today, saving, error, onCancel, onSubmit }: {
  current?: TrainerFinancePayment
  packages?: TrainerFinancePackage[]
  packageId?: string
  today: string
  saving: boolean
  error: Error | null
  onCancel: () => void
  onSubmit: (draft: TrainerFinancePaymentDraft, packageId: string) => void
}) {
  const [validationError, setValidationError] = useState<string | null>(null)
  const [selectedPackageId, setSelectedPackageId] = useState(packageId ?? packages[0]?.id ?? '')
  const [amount, setAmount] = useState(current ? String(current.amountCents / 100) : initialPaymentAmount(selectedPackageId, packages))
  return <form className="finance-form card" aria-busy={saving} onSubmit={(event) => {
    event.preventDefault()
    setValidationError(null)
    try {
      const form = new FormData(event.currentTarget)
      const amountCents = cents(form.get('amount'))
      if (amountCents < 1) throw new Error('Сумма должна быть больше нуля')
      const targetPackageId = current ? packageId : String(form.get('packageId') ?? packageId ?? '')
      if (!targetPackageId) throw new Error('Выберите услугу')
      onSubmit({ amountCents, receivedOn: String(form.get('receivedOn') ?? ''), comment: optional(form, 'comment') }, targetPackageId)
    } catch (cause) {
      setValidationError(cause instanceof Error ? cause.message : 'Проверьте данные')
    }
  }}>
    <div className="finance-form-heading"><div><p className="eyebrow">ОПЛАТА</p><h2>{current ? 'Редактирование' : 'Добавить оплату'}</h2></div></div>
    {!current && packages.length > 1 && <Field label="Услуга"><select name="packageId" required value={selectedPackageId} onChange={(event) => { setSelectedPackageId(event.target.value); setAmount(initialPaymentAmount(event.target.value, packages)) }}>{packages.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></Field>}
    <div className="finance-form-grid"><Field label="Сумма, ₽"><input name="amount" type="number" inputMode="decimal" min="0.01" step="0.01" required value={amount} onChange={(event) => setAmount(event.target.value)} /></Field><Field label="Дата"><input name="receivedOn" type="date" required defaultValue={current?.receivedOn ?? today} /></Field></div>
    <Field label="Комментарий"><input name="comment" maxLength={2000} defaultValue={current?.comment ?? ''} /></Field>
    {validationError && <p className="error" role="alert">{validationError}</p>}
    {error && <InlineRequestError error={error} />}
    <div className="actions"><button type="button" className="secondary" disabled={saving} onPointerDown={(event) => event.preventDefault()} onClick={onCancel}>Отмена</button><button type="submit" className="primary" disabled={saving} onPointerDown={(event) => event.preventDefault()}>{saving ? 'Сохраняем…' : 'Сохранить'}</button></div>
  </form>
}

function initialPaymentAmount(packageId: string, packages: TrainerFinancePackage[]) {
  const due = packages.find((item) => item.id === packageId)?.dueCents ?? 0
  return due > 0 ? String(due / 100) : ''
}

type FinanceTab = 'packages' | 'sessions' | 'payments'
type PackageEditor = { mode: 'new' } | { mode: 'edit' | 'renew'; item: TrainerFinancePackage }

const FINANCE_TABS: { id: FinanceTab; label: string }[] = [
  { id: 'packages', label: 'Услуги' },
  { id: 'sessions', label: 'Занятия' },
  { id: 'payments', label: 'Оплаты' },
]

export function TrainerFinancePage() {
  const { clientId = '' } = useParams()
  const location = useLocation()
  const routeState: unknown = location.state
  const { actor } = useAuth()
  const { trainerFinance } = useDataBackend()
  const queryClient = useQueryClient()
  const today = todayInTimeZone(actor?.timezone)
  const [activeTab, setActiveTab] = useState<FinanceTab>('packages')
  const [sessionFilter, setSessionFilter] = useState<'all' | 'unassigned' | 'trial'>('all')
  const [packageEditor, setPackageEditor] = useState<PackageEditor | null>(null)
  const [paymentEditor, setPaymentEditor] = useState<{ packageId: string; payment?: TrainerFinancePayment; direct?: boolean } | null>(null)
  const packageRequest = useRef<string | null>(null)
  const paymentRequest = useRef<string | null>(null)
  const manualOperation = useRef<{ draft: SessionAccountingDraft; requestId: string; attempts: number } | null>(null)
  const [pendingManualDraft, setPendingManualDraft] = useState<SessionAccountingDraft | null>(null)
  const [manualOpen, setManualOpen] = useState(false)
  const [sessionEditor, setSessionEditor] = useState<string | null>(null)
  const [confirm, confirmDialog] = useConfirm()
  const finance = useQuery({ queryKey: ['trainer-finance', clientId], queryFn: () => trainerFinance.listClient(clientId) })
  const refresh = () => invalidateFinanceViews(queryClient, clientId)
  const refreshSession = async (session: TrainerFinanceSession) => {
    const key = ['workout', session.workoutId]
    await queryClient.cancelQueries({ queryKey: key })
    await Promise.all([refresh(), invalidateWorkoutResults(queryClient),
      queryClient.invalidateQueries({ queryKey: key }),
      queryClient.invalidateQueries({ queryKey: ['today-workouts'] }),
      queryClient.invalidateQueries({ queryKey: ['trainer-attention'] }),
      queryClient.invalidateQueries({ queryKey: ['clients'] })])
  }
  const savePackage = useMutation({
    mutationFn: async (draft: TrainerFinancePackageDraft) => {
      if (packageEditor?.mode === 'edit') return trainerFinance.updatePackage(packageEditor.item.id, { ...draft, expectedVersion: packageEditor.item.version })
      packageRequest.current ??= crypto.randomUUID()
      return trainerFinance.createPackage(clientId, { ...draft, requestId: packageRequest.current })
    },
    onSuccess: async () => { await refresh(); packageRequest.current = null; setPackageEditor(null) },
  })
  const savePayment = useMutation({
    mutationFn: async ({ draft, packageId }: { draft: TrainerFinancePaymentDraft; packageId: string }) => {
      if (paymentEditor?.payment) return trainerFinance.updatePayment(paymentEditor.payment.id, { ...draft, expectedVersion: paymentEditor.payment.version })
      paymentRequest.current ??= crypto.randomUUID()
      return trainerFinance.addPayment(packageId, { ...draft, requestId: paymentRequest.current })
    },
    onSuccess: async () => { await refresh(); paymentRequest.current = null; setPaymentEditor(null) },
  })
  const removePayment = useMutation({
    mutationFn: (payment: TrainerFinancePayment) => trainerFinance.voidPayment(payment.id, payment.version, 'Удалено тренером'),
    onSuccess: refresh,
  })
  const addManualSession = useMutation({
    mutationFn: async (draft: SessionAccountingDraft) => {
      if (!manualOperation.current) {
        manualOperation.current = { draft, requestId: crypto.randomUUID(), attempts: 0 }
        setPendingManualDraft(draft)
      }
      if (JSON.stringify(manualOperation.current.draft) !== JSON.stringify(draft)) throw new Error('Сначала повторите сохранение предыдущего занятия')
      manualOperation.current.attempts += 1
      const [disposition, packageId = ''] = draft.value.split(':')
      return trainerFinance.createManualSession(clientId, {
        requestId: manualOperation.current.requestId,
        disposition: disposition as TrainerFinanceSession['disposition'],
        packageId: disposition === 'charged' ? packageId : null,
        comment: draft.comment, workoutDate: draft.workoutDate,
      })
    },
    onSuccess: async session => { await refreshSession(session); setManualOpen(false); manualOperation.current = null; setPendingManualDraft(null) },
    onError: error => {
      // A first explicit rejection confirms no write. A later rejection cannot
      // resolve an earlier lost response: keep its payload/ID for a real replay.
      if (manualOperation.current?.attempts === 1 && error instanceof RepositoryError
        && ['PT422', 'PT403', 'PT404'].includes(error.code)) {
        manualOperation.current = null
        setPendingManualDraft(null)
      }
    },
  })
  const updateSession = useMutation({
    mutationFn: ({ session, value, workoutDate, comment }: { session: TrainerFinanceSession; value: string; workoutDate: string; comment: string | null }) => {
      const [disposition, packageId = ''] = value.split(':')
      return trainerFinance.updateSession(session.id, {
        expectedVersion: session.version,
        disposition: disposition as TrainerFinanceSession['disposition'],
        packageId: disposition === 'charged' ? packageId : null,
        comment,
        workoutDate,
      })
    },
    onSuccess: async session => { await refreshSession(session); setSessionEditor(null) },
  })
  const canCreate = finance.data?.canCreate ?? true
  const packages = finance.data?.packages ?? []
  const activePackages = packages.filter((item) => item.packageStatus === 'active' || item.packageStatus === 'upcoming')
  const pastPackages = packages.filter((item) => item.packageStatus !== 'active' && item.packageStatus !== 'upcoming')
  const sessions = (finance.data?.sessions ?? []).filter((session) => session.voidedAt === null)
  const payments = (finance.data?.payments ?? []).filter((payment) => payment.voidedAt === null)
  const packageById = new Map(packages.map((item) => [item.id, item]))
  const sessionNumberById = new Map<string, number>()
  const chargedCountByPackage = new Map<string, number>()
  for (const session of sessions) if (session.packageId && session.disposition === 'charged') {
    chargedCountByPackage.set(session.packageId, (chargedCountByPackage.get(session.packageId) ?? 0) + 1)
  }
  const nextNumberByPackage = new Map(packages.map((item) => [item.id, Math.max(0, item.sessionsUsed - (chargedCountByPackage.get(item.id) ?? 0))]))
  for (const session of [...sessions].sort((first, second) => first.workoutDate.localeCompare(second.workoutDate) || first.createdAt.localeCompare(second.createdAt))) {
    if (!session.packageId || session.disposition !== 'charged') continue
    const next = (nextNumberByPackage.get(session.packageId) ?? 0) + 1
    nextNumberByPackage.set(session.packageId, next)
    sessionNumberById.set(session.id, next)
  }
  const filteredSessions = sessions.filter((session) => sessionFilter === 'all' || (sessionFilter === 'unassigned' ? session.disposition !== 'charged' : session.disposition === 'trial'))
  const receivedCents = payments.reduce((sum, payment) => sum + payment.amountCents, 0)
  const dueCents = packages.filter((item) => item.closedAt === null).reduce((sum, item) => sum + item.dueCents, 0)
  const tabCount: Record<FinanceTab, number> = { packages: packages.length, sessions: sessions.length, payments: payments.length }
  const openPayment = (packageId: string, payment?: TrainerFinancePayment, direct = false) => {
    paymentRequest.current = null
    savePayment.reset()
    setPaymentEditor({ packageId, payment, direct })
  }
  const renderPayment = (payment: TrainerFinancePayment, showService = true) => <div className="finance-payment" key={payment.id}>
    <div><strong>{money(payment.amountCents)}</strong><span>{formatLocalDate(localDate(payment.receivedOn))}{payment.comment ? ` · ${payment.comment}` : ''}</span></div>
    {showService && <span className="finance-payment-package">{packageById.get(payment.packageId)?.title ?? 'Услуга удалена'}</span>}
    <OverflowMenu label={`Действия с оплатой ${money(payment.amountCents)}`} items={[
      { label: 'Изменить', onClick: () => openPayment(payment.packageId, payment) },
      { label: 'Удалить', danger: true, onClick: () => void confirm({ message: `Удалить оплату ${money(payment.amountCents)} от ${formatLocalDate(localDate(payment.receivedOn))}?`, confirmLabel: 'Удалить', danger: true }).then((ok) => { if (ok) removePayment.mutate(payment) }) },
    ]} />
  </div>
  const renderPackage = (item: TrainerFinancePackage, history = false) => {
    const servicePayments = payments.filter((payment) => payment.packageId === item.id)
    return <article className={`finance-package card${history ? ' is-history' : ''}`} key={item.id}>
      <header><div><span className={`finance-status finance-status-${item.packageStatus}`}>{item.kind === 'online_coaching' ? 'Онлайн · ' : ''}{PACKAGE_STATUS[item.packageStatus]}</span><h2>{item.title}</h2></div><OverflowMenu label={`Действия с услугой ${item.title}`} items={[...(canCreate ? [{ label: 'Продлить', onClick: () => setPackageEditor({ mode: 'renew', item }) }] : []), { label: 'Редактировать', onClick: () => setPackageEditor({ mode: 'edit', item }) }]} /></header>
      <div className="finance-package-summary finance-service-balance">
        {item.kind === 'session_pack'
          ? <p><span>Осталось занятий</span><strong>{item.sessionsRemaining} из {item.sessionsTotal}</strong></p>
          : <p><span>Период</span><strong>{formatLocalDate(localDate(item.startsOn))} — {item.endsOn ? formatLocalDate(localDate(item.endsOn)) : '—'}</strong></p>}
      </div>
      <div className="finance-package-facts finance-service-money"><p><span>Стоимость</span><strong>{money(item.priceCents)}</strong></p><p><span>Оплачено</span><strong>{money(item.paidCents)}</strong></p><p><span>К оплате</span><strong>{money(item.dueCents)}</strong></p></div>
      <div className="finance-package-meta">
        <span>С {formatLocalDate(localDate(item.startsOn))}{item.endsOn ? ` по ${formatLocalDate(localDate(item.endsOn))}` : ''}</span>
        <span className={item.paymentStatus === 'overdue' ? 'is-overdue' : ''}>{item.priceCents === 0 && item.paidCents > 0 ? 'Стоимость не указана' : item.paidCents > item.priceCents ? `Переплата ${money(item.paidCents - item.priceCents)}` : PAYMENT_STATUS[item.paymentStatus]}</span>
      </div>
      <button type="button" className="secondary finance-inline-action" onClick={() => openPayment(item.id, undefined, true)}>Внести оплату</button>
      <details className="finance-service-payments finance-disclosure"><summary><span>Оплаты</span><small>{servicePayments.length}</small></summary><div className="finance-disclosure-content"><div className="finance-payment-list">{servicePayments.map((payment) => renderPayment(payment, false))}</div>{servicePayments.length === 0 && <p className="finance-empty">Оплат пока нет.</p>}</div></details>
      <details className="finance-package-details finance-disclosure">
        <summary><span>Подробнее</span></summary>
        <div className="finance-disclosure-content">
          <div className="finance-package-facts">{item.kind === 'session_pack' && <p><span>Проведено</span><strong>{item.sessionsUsed}</strong></p>}</div>
          {item.comment && <p className="finance-comment">{item.comment}</p>}
          <div className="finance-package-actions"><>{canCreate && <button type="button" className="secondary" onClick={() => setPackageEditor({ mode: 'renew', item })}>Продлить</button>}</><button type="button" className="secondary" onClick={() => setPackageEditor({ mode: 'edit', item })}>Изменить</button></div>
        </div>
      </details>
    </article>
  }
  const financeBackTo = routeState && typeof routeState === 'object'
    && 'financeBackTo' in routeState && typeof routeState.financeBackTo === 'string'
    && /^\/finance(?:\?[^#]*)?$/.test(routeState.financeBackTo)
    ? routeState.financeBackTo
    : `/clients/${clientId}`
  return <Page title="Финансы" subtitle={finance.data?.clientName} back={financeBackTo} swipeBack className="trainer-finance-page">
    <AsyncView loading={finance.isLoading} error={finance.error} onRetry={() => void finance.refetch()}>
      {packageEditor && <PackageForm lime={isFitLimeEnabled(actor)} current={packageEditor.mode === 'edit' ? packageEditor.item : undefined} template={packageEditor.mode === 'renew' ? packageEditor.item : undefined} today={today} saving={savePackage.isPending} error={savePackage.error} onCancel={() => { packageRequest.current = null; setPackageEditor(null) }} onSubmit={(draft) => savePackage.mutate(draft)} />}
      {paymentEditor && <PaymentForm current={paymentEditor.payment} packages={paymentEditor.direct ? packages.filter((item) => item.id === paymentEditor.packageId) : packages} packageId={paymentEditor.packageId} today={today} saving={savePayment.isPending} error={savePayment.error} onCancel={() => { paymentRequest.current = null; setPaymentEditor(null) }} onSubmit={(draft, packageId) => savePayment.mutate({ draft, packageId })} />}
      {!packageEditor && !paymentEditor && <>
        <div className="finance-tabs" role="tablist" aria-label="Раздел финансов клиента">{FINANCE_TABS.map((tab) => <button id={`finance-${tab.id}-tab`} key={tab.id} type="button" role="tab" aria-label={`${tab.label}: ${tabCount[tab.id]}`} aria-selected={activeTab === tab.id} aria-controls={`finance-${tab.id}-panel`} className={activeTab === tab.id ? 'is-active' : ''} onClick={() => setActiveTab(tab.id)}><span>{tab.label}</span><small>{tabCount[tab.id]}</small></button>)}</div>

        <section id="finance-packages-panel" className="finance-tab-panel" data-finance-tab="packages" role="tabpanel" aria-labelledby="finance-packages-tab" hidden={activeTab !== 'packages'}>
          <div className="finance-section-heading"><div><p className="eyebrow">УСЛУГИ</p><h2>{activePackages.length ? 'Текущие' : 'Нет активных'}</h2></div>{canCreate && <button type="button" className="primary" onClick={() => setPackageEditor({ mode: 'new' })}>Новая</button>}</div>
          <div className="finance-package-list">{activePackages.map((item) => renderPackage(item))}</div>
          {finance.isSuccess && packages.length === 0 && <p className="finance-empty">Услуг пока нет.</p>}
          {pastPackages.length > 0 && <details className="finance-history finance-disclosure card"><summary><span>История</span><small>{pastPackages.length}</small></summary><div className="finance-disclosure-content finance-package-list">{pastPackages.map((item) => renderPackage(item, true))}</div></details>}
        </section>

        <section id="finance-sessions-panel" className="finance-tab-panel" data-finance-tab="sessions" role="tabpanel" aria-labelledby="finance-sessions-tab" hidden={activeTab !== 'sessions'}>
          <div className="finance-section-heading"><div><p className="eyebrow">ЗАНЯТИЯ</p><h2>Проведённые</h2></div>{!manualOpen && (canCreate || pendingManualDraft) && <button type="button" className="primary" onClick={() => { if (!manualOperation.current) addManualSession.reset(); setManualOpen(true) }}>{pendingManualDraft ? 'Проверить сохранение' : 'Добавить'}</button>}</div>
          <div className="finance-filter-row finance-session-filters" role="group" aria-label="Фильтр занятий"><button type="button" className={sessionFilter === 'all' ? 'is-active' : ''} aria-pressed={sessionFilter === 'all'} onClick={() => setSessionFilter('all')}>Все</button><button type="button" className={sessionFilter === 'unassigned' ? 'is-active' : ''} aria-pressed={sessionFilter === 'unassigned'} onClick={() => setSessionFilter('unassigned')}>Без списания</button><button type="button" className={sessionFilter === 'trial' ? 'is-active' : ''} aria-pressed={sessionFilter === 'trial'} onClick={() => setSessionFilter('trial')}>Пробные</button></div>
          {manualOpen && <SessionAccountingForm packages={packages} today={today} initialDraft={pendingManualDraft ?? undefined}
            locked={pendingManualDraft !== null} saving={addManualSession.isPending} error={addManualSession.error}
            onCancel={() => { setManualOpen(false); if (!manualOperation.current) addManualSession.reset() }}
            onSubmit={draft => addManualSession.mutate(draft)} />}
          <div className="finance-session-list">{filteredSessions.map((session) => {
            const editing = sessionEditor === session.id
            const sessionPackage = session.packageId ? packageById.get(session.packageId) : undefined
            const number = sessionNumberById.get(session.id)
            return <div className={`finance-session${editing ? ' is-editing' : ''}`} key={session.id}><div className="finance-session-row"><div className="finance-session-leading"><span className="finance-session-number">{number ? `№${number}` : '—'}</span><Link to={`/workouts/${session.workoutId}`}><strong>{formatLocalDate(localDate(session.workoutDate))}</strong><span>{session.source === 'manual' ? 'Добавлено вручную' : 'Из завершённой тренировки'}</span></Link></div><div className="finance-session-accounting"><strong>{SESSION_STATUS[session.disposition]}</strong><span>{sessionPackage?.title ?? 'Без абонемента'}</span></div><OverflowMenu label={`Действия с занятием ${formatLocalDate(localDate(session.workoutDate))}`} items={[{ label: 'Изменить учёт', onClick: () => { updateSession.reset(); setSessionEditor(session.id) } }]} /></div>{editing && <SessionAccountingForm key={session.id} packages={packages} today={today} session={session}
              saving={updateSession.isPending} error={updateSession.error} onCancel={() => setSessionEditor(null)}
              onSubmit={draft => updateSession.mutate({ session, ...draft })} />}</div>
          })}</div>
          {finance.isSuccess && filteredSessions.length === 0 && <p className="finance-empty">В этом разделе занятий нет.</p>}
        </section>

        <section id="finance-payments-panel" className="finance-tab-panel" data-finance-tab="payments" role="tabpanel" aria-labelledby="finance-payments-tab" hidden={activeTab !== 'payments'}>
          <div className="finance-payment-overview"><p><span>Получено</span><strong>{money(receivedCents)}</strong></p><p><span>К оплате</span><strong>{money(dueCents)}</strong></p></div>
          <div className="finance-section-heading"><div><p className="eyebrow">ОПЛАТЫ</p><h2>История</h2></div><button type="button" className="primary" disabled={packages.length === 0} onClick={() => openPayment(activePackages[0]?.id ?? packages[0]!.id)}>Добавить</button></div>
          <div className="finance-payment-list finance-payment-ledger">{payments.map((payment) => renderPayment(payment))}</div>
          {finance.isSuccess && payments.length === 0 && <p className="finance-empty">Оплат пока нет.</p>}
        </section>
      </>}
      {removePayment.error && <InlineRequestError error={removePayment.error} />}
    </AsyncView>
    {confirmDialog}
  </Page>
}
