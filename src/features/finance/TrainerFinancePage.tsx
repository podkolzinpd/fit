import { financeInputCents as cents } from './finance-input-cents'
import { ChevronDownIcon } from '../../shared/icons'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useId, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { FinanceMonthlySummary } from './FinanceMonthlySummary'
import { financeMoney } from './finance-monthly'
import { useTrainerFinanceMonth } from './use-trainer-finance-month'
import { BackIcon, ChevronRightIcon } from '../../shared/icons'
import { useAuth } from '../../app/auth-context'
import { isFitLimeEnabled } from '../../app/fit-lime'
import { useDataBackend } from '../../app/data-backend-context'
import { invalidateFinanceViews } from '../../app/invalidate-finance-views'
import { invalidateWorkoutResults } from '../../app/invalidate-workout-results'
import { RepositoryError } from '../../data/repositories/error'
import { clearFinanceOperation, financeOperationKey, pendingPackageSchema, pendingPaymentSchema, pendingSessionSchema, readFinanceOperation, writeFinanceOperation } from './pending-finance-operation'
import { financePackagePeriod } from './finance-package-label'
import { SessionAccountingForm, type SessionAccountingDraft } from './SessionAccountingForm'
import type { TrainerFinancePackage, TrainerFinancePackageDraft, TrainerFinancePayment, TrainerFinanceSession, TrainerFinancePaymentDraft } from '../../data/contracts/trainer-finance'
import { addDays, daysBetween, formatLocalDate, formatMonth, localDate, todayInTimeZone } from '../../shared/local-date'
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


function integer(value: FormDataEntryValue | null, label: string) {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`Проверьте поле «${label}»`)
  return parsed
}

function optional(form: FormData, name: string) {
  const value = String(form.get(name) ?? '').trim()
  return value || null
}

export function PackageForm({ current, template, today, saving, error, initialDraft, locked = false, onCancel, onSubmit, lime = false, paymentEntry = false }: {
  lime?: boolean
  paymentEntry?: boolean
  current?: TrainerFinancePackage
  template?: TrainerFinancePackage
  initialDraft?: TrainerFinancePackageDraft
  locked?: boolean
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
  const [startsOn, setStartsOn] = useState(initialDraft?.startsOn ?? current?.startsOn ?? renewalStart)
  const [singleSession, setSingleSession] = useState(lime && (initialDraft?.singleSession ?? source?.singleSession ?? paymentEntry))
  const [kind, setKind] = useState<TrainerFinancePackage['kind']>(initialDraft?.kind ?? source?.kind ?? 'session_pack')
  const [title, setTitle] = useState(initialDraft?.title ?? source?.title ?? (singleSession ? 'Разовое занятие' : 'Персональные тренировки'))
  const [priceValue, setPriceValue] = useState(initialDraft ? String(initialDraft.priceCents / 100) : source ? String(source.priceCents / 100) : '')
  const [paidValue, setPaidValue] = useState(initialDraft ? String(initialDraft.openingPaidCents / 100) : '0')
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (saving) return
    if (locked && initialDraft) { onSubmit(initialDraft); return }
    setValidationError(null)
    if (lime) {
      const form = event.currentTarget
      const values = new FormData(form)
      const errors: Record<string, string> = {}
      if (!String(values.get('title') ?? '').trim()) errors.title = 'Укажите название услуги'
      if (!singleSession && kind === 'session_pack' && !current && Number(values.get('openingUsedSessions')) > Number(values.get('sessionsTotal'))) {
        errors.openingUsedSessions = 'Проведённых занятий не может быть больше общего количества'
      }
      if (!current && Number(values.get('openingPaid')) > Number(values.get('price'))) errors.openingPaid = 'Оплата не может быть больше стоимости'
      const messages: Record<string, string> = {
        title: 'Укажите название до 120 символов', sessionsTotal: 'Укажите целое количество занятий от 1 до 10 000',
        openingUsedSessions: 'Укажите целое количество проведённых занятий от 0 до общего количества',
        price: 'Укажите стоимость в рублях: от 0 до 1 000 000 000, максимум два знака после запятой',
        openingPaid: 'Укажите оплату в рублях: от 0 до 1 000 000 000, максимум два знака после запятой',
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
      const sessionsTotal = singleSession ? 1 : kind === 'session_pack' ? integer(form.get('sessionsTotal'), 'Всего занятий') : 0
      const openingUsedSessions = !singleSession && kind === 'session_pack' && !current ? integer(form.get('openingUsedSessions'), 'Уже проведено') : 0
      const priceCents = cents(form.get('price'))
      const openingPaidCents = current ? 0 : cents(form.get('openingPaid'))
      if (kind === 'session_pack' && (sessionsTotal < 1 || openingUsedSessions > sessionsTotal)) throw new Error('Проведённых занятий не может быть больше общего количества')
      if (openingPaidCents > priceCents) throw new Error('Начальная оплата не может быть больше стоимости абонемента')
      const endsOn = optional(form, 'endsOn')
      localDate(startsOn)
      if (endsOn) localDate(endsOn)
      if (optional(form, 'paymentDueOn')) localDate(String(form.get('paymentDueOn')))
      if (openingPaidCents > 0) localDate(String(form.get('openingReceivedOn')))
      if (endsOn && endsOn < startsOn) throw new Error('Окончание не может быть раньше начала')
      onSubmit({
        kind, ...(singleSession ? { singleSession: true } : {}), title: String(form.get('title') ?? '').trim(), sessionsTotal, openingUsedSessions,
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
  const sessions = !singleSession && kind === 'session_pack' && field('sessionsTotal', lime ? 'Количество занятий' : 'Всего занятий', <input disabled={saving || locked} {...validation('sessionsTotal')} name="sessionsTotal" type="number" inputMode="numeric" min="1" max="10000" required defaultValue={initialDraft?.sessionsTotal ?? (source?.sessionsTotal || 10)} />)
  const used = !singleSession && kind === 'session_pack' && !current && field('openingUsedSessions', lime ? 'Уже проведено, занятий' : 'Уже проведено', <input disabled={saving || locked} {...validation('openingUsedSessions')} name="openingUsedSessions" type="number" inputMode="numeric" min="0" max="10000" required defaultValue={initialDraft?.openingUsedSessions ?? 0} />)
  const price = field('price', 'Стоимость, ₽', <input disabled={saving || locked} {...validation('price')} name="price" type="number" inputMode="decimal" min="0" max="1000000000" step="0.01" required value={priceValue} onChange={(event) => setPriceValue(event.target.value)} />)
  const paid = !current && field('openingPaid', 'Уже оплачено, ₽', <input disabled={saving || locked} {...validation('openingPaid')} name="openingPaid" type="number" inputMode="decimal" min="0" max="1000000000" step="0.01" required value={paidValue} onChange={(event) => setPaidValue(event.target.value)} />)
  const costAndPayment = <div className="finance-cost-payment">
    <div className="finance-payment-fields">{price}{paid}</div>
    {!current && <button type="button" className="link finance-fill-payment" disabled={saving || locked || Number(priceValue) <= 0 || !priceValue} onClick={() => setPaidValue(priceValue)}>Вся сумма</button>}
    {!current && Number(paidValue) > 0 && field('openingReceivedOn', 'Дата получения', <input disabled={saving || locked} {...validation('openingReceivedOn')} name="openingReceivedOn" type="date" required defaultValue={initialDraft?.openingReceivedOn ?? today} />)}
  </div>
  const titleField = field('title', 'Название', <input disabled={saving || locked} {...validation('title')} name="title" required maxLength={120} value={title} onChange={(event) => setTitle(event.target.value)} />)
  const commentField = field('comment', 'Комментарий', <textarea disabled={saving || locked} {...validation('comment')} name="comment" rows={2} maxLength={2000} defaultValue={initialDraft?.comment ?? source?.comment ?? ''} />)
  const dates = <>
    {field('startsOn', 'Начало', <input disabled={saving || locked} {...validation('startsOn')} name="startsOn" type="date" required value={startsOn} onChange={(event) => setStartsOn(event.target.value)} />)}
    {field('endsOn', 'Окончание', <input disabled={saving || locked} {...validation('endsOn')} name="endsOn" type="date" required={kind === 'online_coaching'} min={startsOn} defaultValue={initialDraft ? initialDraft.endsOn ?? '' : current?.endsOn ?? renewalEnd} />)}
    {field('paymentDueOn', 'Оплатить до', <input disabled={saving || locked} {...validation('paymentDueOn')} name="paymentDueOn" type="date" defaultValue={initialDraft ? initialDraft.paymentDueOn ?? '' : current?.paymentDueOn ?? ''} />)}
  </>
  const typeSelect = <select name="kind" value={singleSession ? 'single' : kind} disabled={saving || locked || Boolean(current)} onChange={(event) => {
      const next = event.target.value
      setSingleSession(next === 'single')
      setKind(next === 'online_coaching' ? 'online_coaching' : 'session_pack')
      if (['Персональные тренировки', 'Онлайн-сопровождение', 'Разовое занятие', 'Ведение'].includes(title))
        setTitle(next === 'single' ? 'Разовое занятие' : next === 'session_pack' ? 'Персональные тренировки' : lime ? 'Ведение' : 'Онлайн-сопровождение')
    }}>{lime && <option value="single">Разовое занятие</option>}<option value="session_pack">{lime ? 'Абонемент' : 'Пакет занятий'}</option><option value="online_coaching">{lime ? 'Ведение за период' : 'Онлайн-сопровождение'}</option></select>
  return <form className={`finance-form card${lime ? ' lime-finance-form' : ''}`} noValidate={lime} aria-busy={saving} onSubmit={submit}>
    <div className="finance-form-heading"><div>{!lime && <p className="eyebrow">ФИНАНСЫ</p>}<h2>{current ? 'Редактирование' : template ? 'Продление' : paymentEntry ? 'Добавить оплату' : 'Новая услуга'}</h2></div></div>
    <Field label="Тип">{lime ? <span className="finance-select-field">{typeSelect}<ChevronDownIcon /></span> : typeSelect}</Field>
    {!singleSession && titleField}
    {lime ? <>
      {sessions && <fieldset><legend>Занятия</legend>{sessions}</fieldset>}
      <fieldset><legend>Стоимость и оплата</legend>{costAndPayment}</fieldset>
      <>{singleSession ? <details className="finance-opening-balances"><summary>Дополнительно</summary>{titleField}<div className="finance-form-grid">{dates}</div>{commentField}</details> : <fieldset><legend>Сроки</legend><div className="finance-form-grid">{dates}</div></fieldset>}</>
      {used && <details className="finance-opening-balances"><summary>Уже проведённые занятия</summary><div className="finance-form-grid">{used}</div></details>}
    </> : <>{current
      ? <div className="finance-form-grid">{sessions}{price}</div>
      : <><div className="finance-form-grid">{sessions}{used}</div>{costAndPayment}</>}
      <div className="finance-form-grid">{dates}</div></>}
    {!singleSession && commentField}
    {validationError && <p className="error" role="alert">{validationError}</p>}
    {locked && !error && <p role="status">Сохранение не подтверждено</p>}
    {error && <InlineRequestError error={error} message={locked ? 'Сохранение не подтверждено' : undefined} />}
    {/* Keep the focused input until click: keyboard recovery on pointerdown
        otherwise moves this row before pointerup and loses the submission. */}
    <div className="actions"><button type="button" className="secondary" disabled={saving} onPointerDown={(event) => event.preventDefault()} onClick={onCancel}>Отмена</button><button type="submit" className="primary" disabled={saving} onPointerDown={(event) => event.preventDefault()}>{saving ? 'Сохраняем…' : locked ? 'Повторить сохранение' : 'Сохранить'}</button></div>
  </form>
}

export function PaymentForm({ lime = false, current, packages = [], packageId, today, saving, error, initialDraft, locked = false, onCancel, onSubmit, onNewService }: {
  lime?: boolean
  onNewService?: () => void
  current?: TrainerFinancePayment
  initialDraft?: TrainerFinancePaymentDraft
  locked?: boolean
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
  const [amount, setAmount] = useState(initialDraft ? String(initialDraft.amountCents / 100) : current ? String(current.amountCents / 100) : initialPaymentAmount(selectedPackageId, packages))
  const selectedPackage = packages.find(item => item.id === selectedPackageId)
  return <form className="finance-form card" aria-busy={saving} onSubmit={(event) => {
    event.preventDefault()
    if (saving) return
    if (locked && initialDraft && packageId) { onSubmit(initialDraft, packageId); return }
    setValidationError(null)
    try {
      const form = new FormData(event.currentTarget)
      const amountCents = cents(form.get('amount'))
      if (amountCents < 1) throw new Error('Сумма должна быть больше нуля')
      const targetPackageId = current ? packageId : String(form.get('packageId') ?? packageId ?? '')
      if (!targetPackageId) throw new Error('Выберите услугу')
      onSubmit({ amountCents, receivedOn: localDate(String(form.get('receivedOn') ?? '')), comment: optional(form, 'comment') }, targetPackageId)
    } catch (cause) {
      setValidationError(cause instanceof Error ? cause.message : 'Проверьте данные')
    }
  }}>
    <div className="finance-form-heading"><div>{!lime && <p className="eyebrow">ОПЛАТА</p>}<h2>{current ? lime ? 'Изменить оплату' : 'Редактирование' : 'Добавить оплату'}</h2></div></div>
    {!current && packages.length > 1 && <Field label="Услуга"><select disabled={saving || locked} name="packageId" required value={selectedPackageId} onChange={(event) => { setSelectedPackageId(event.target.value); setAmount(initialPaymentAmount(event.target.value, packages)) }}>{packages.map((item) => <option key={item.id} value={item.id}>{lime ? `${item.title} · ${financePackagePeriod(item)} · к оплате ${money(item.dueCents)}` : item.title}</option>)}</select></Field>}
    {lime && selectedPackage && (current || packages.length === 1) && <p className="finance-payment-package">{selectedPackage.title} · {financePackagePeriod(selectedPackage)} · к оплате {money(selectedPackage.dueCents)}</p>}
    {lime && onNewService && !current && <button type="button" className="secondary" disabled={saving || locked} onClick={onNewService}>Новая услуга</button>}
    <div className="finance-form-grid"><Field label="Сумма, ₽"><input disabled={saving || locked} name="amount" type="number" inputMode="decimal" min="0.01" max="1000000000" step="0.01" required value={amount} onChange={(event) => setAmount(event.target.value)} /></Field><Field label="Дата"><input disabled={saving || locked} name="receivedOn" type="date" required defaultValue={initialDraft?.receivedOn ?? current?.receivedOn ?? today} /></Field></div>
    <Field label="Комментарий">{lime ? <textarea disabled={saving || locked} name="comment" rows={2} maxLength={2000} defaultValue={initialDraft?.comment ?? current?.comment ?? ''} /> : <input disabled={saving || locked} name="comment" maxLength={2000} defaultValue={initialDraft?.comment ?? current?.comment ?? ''} />}</Field>
    {validationError && <p className="error" role="alert">{validationError}</p>}
    {locked && !error && <p role="status">Сохранение не подтверждено</p>}
    {error && <InlineRequestError error={error} message={locked ? 'Сохранение не подтверждено' : undefined} />}
    <div className="actions"><button type="button" className="secondary" disabled={saving} onPointerDown={(event) => event.preventDefault()} onClick={onCancel}>Отмена</button><button type="submit" className="primary" disabled={saving} onPointerDown={(event) => event.preventDefault()}>{saving ? 'Сохраняем…' : locked ? 'Повторить сохранение' : 'Сохранить'}</button></div>
  </form>
}

function initialPaymentAmount(packageId: string, packages: TrainerFinancePackage[]) {
  const due = packages.find((item) => item.id === packageId)?.dueCents ?? 0
  return due > 0 ? String(due / 100) : ''
}

type FinanceTab = 'packages' | 'sessions' | 'payments'
type PaymentEditor = { packageId: string; payment?: TrainerFinancePayment; direct?: boolean }
type CreateOperation<D, E> = { draft: D; editor: E; requestId: string; attempts: number }
function isFirstRejectedCreate(error: Error, operation: { attempts: number } | null) {
  return operation?.attempts === 1 && error instanceof RepositoryError && ['invalid_request', 'PT422', 'PT403', 'PT404'].includes(error.code)
}

type PackageEditor = { mode: 'new'; fromPayment?: boolean } | { mode: 'edit' | 'renew'; item: TrainerFinancePackage }

const FINANCE_TABS: { id: FinanceTab; label: string }[] = [
  { id: 'packages', label: 'Услуги' },
  { id: 'sessions', label: 'Занятия' },
  { id: 'payments', label: 'Оплаты' },
]

export function TrainerFinancePage() {
  const { clientId = '' } = useParams()
  const { actor } = useAuth()
  return <TrainerFinanceClientPage key={`${actor?.userId}:${clientId}`} />
}

function TrainerFinanceClientPage() {
  const { clientId = '' } = useParams()
  const location = useLocation()
  const routeState: unknown = location.state
  const { actor } = useAuth()
  const { trainerFinance } = useDataBackend()
  const queryClient = useQueryClient()
  const today = todayInTimeZone(actor?.timezone)
  const monthView = useTrainerFinanceMonth(today, isFitLimeEnabled(actor))
  const [activeTab, setActiveTab] = useState<FinanceTab>(() => monthView.enabled ? monthView.metric === 'sessions' ? 'sessions' : 'payments' : 'packages')
  const changeTab = (tab: FinanceTab) => {
    setActiveTab(tab)
    if (monthView.enabled && tab !== 'packages') monthView.changeMetric(tab === 'sessions' ? 'sessions' : 'money')
  }
  const [sessionFilter, setSessionFilter] = useState<'all' | 'unassigned' | 'trial'>('all')
  const [packageEditor, setPackageEditor] = useState<PackageEditor | null>(null)
  const [paymentEditor, setPaymentEditor] = useState<PaymentEditor | null>(null)
  const packageKey = financeOperationKey(actor?.userId ?? '', clientId, 'package')
  const paymentKey = financeOperationKey(actor?.userId ?? '', clientId, 'payment')
  const manualKey = financeOperationKey(actor?.userId ?? '', clientId, 'session')
  const [restored] = useState(() => ({
    package: readFinanceOperation(packageKey, pendingPackageSchema),
    payment: readFinanceOperation(paymentKey, pendingPaymentSchema),
    manual: readFinanceOperation(manualKey, pendingSessionSchema),
  }))
  const packageOperation = useRef<CreateOperation<TrainerFinancePackageDraft, PackageEditor> | null>(restored.package
    ? { ...restored.package, editor: { mode: 'new' } } : null)
  const paymentOperation = useRef<CreateOperation<TrainerFinancePaymentDraft, PaymentEditor> | null>(restored.payment
    ? { ...restored.payment, editor: { packageId: restored.payment.packageId, direct: true } } : null)
  const [pendingPackageDraft, setPendingPackageDraft] = useState<TrainerFinancePackageDraft | null>(restored.package?.draft ?? null)
  const [pendingPayment, setPendingPayment] = useState<{ draft: TrainerFinancePaymentDraft; packageId: string } | null>(restored.payment)
  const pendingPaymentDraft = pendingPayment?.draft ?? null
  const pendingPaymentPackageId = pendingPayment?.packageId ?? null
  const manualOperation = useRef<{ draft: SessionAccountingDraft; requestId: string; attempts: number } | null>(restored.manual)
  const [pendingManualDraft, setPendingManualDraft] = useState<SessionAccountingDraft | null>(restored.manual?.draft ?? null)
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
    mutationFn: async ({ draft, editor }: { draft: TrainerFinancePackageDraft; editor: PackageEditor }) => {
      if (editor.mode === 'edit') return trainerFinance.updatePackage(editor.item.id, { ...draft, expectedVersion: editor.item.version })
      if (!packageOperation.current) {
        packageOperation.current = { draft, editor, requestId: crypto.randomUUID(), attempts: 0 }
        setPendingPackageDraft(draft)
      }
      const operation = packageOperation.current
      operation.attempts += 1
      writeFinanceOperation(packageKey, { draft: operation.draft, requestId: operation.requestId, attempts: operation.attempts })
      return trainerFinance.createPackage(clientId, { ...operation.draft, requestId: operation.requestId })
    },
    onSuccess: async (_, { editor }) => {
      await refresh()
      clearFinanceOperation(packageKey, packageOperation.current?.requestId)
      packageOperation.current = null; setPendingPackageDraft(null)
      setPackageEditor(current => current === editor ? null : current)
    },
    onError: error => {
      if (isFirstRejectedCreate(error, packageOperation.current)) {
        clearFinanceOperation(packageKey, packageOperation.current?.requestId)
        packageOperation.current = null; setPendingPackageDraft(null)
      }
    },
  })
  const savePayment = useMutation({
    mutationFn: async ({ draft, packageId, editor }: { draft: TrainerFinancePaymentDraft; packageId: string; editor: PaymentEditor }) => {
      if (editor.payment) return trainerFinance.updatePayment(editor.payment.id, { ...draft, expectedVersion: editor.payment.version })
      if (!paymentOperation.current) {
        paymentOperation.current = { draft, editor: { ...editor, packageId }, requestId: crypto.randomUUID(), attempts: 0 }
        setPendingPayment({ draft, packageId })
      }
      const operation = paymentOperation.current
      operation.attempts += 1
      writeFinanceOperation(paymentKey, { draft: operation.draft, packageId: operation.editor.packageId, requestId: operation.requestId, attempts: operation.attempts })
      return trainerFinance.addPayment(operation.editor.packageId, { ...operation.draft, requestId: operation.requestId })
    },
    onSuccess: async (_, { editor }) => {
      await refresh()
      const restoredEditor = paymentOperation.current?.editor
      clearFinanceOperation(paymentKey, paymentOperation.current?.requestId)
      paymentOperation.current = null; setPendingPayment(null)
      setPaymentEditor(current => current === editor || current === restoredEditor ? null : current)
    },
    onError: error => {
      if (isFirstRejectedCreate(error, paymentOperation.current)) {
        clearFinanceOperation(paymentKey, paymentOperation.current?.requestId)
        paymentOperation.current = null; setPendingPayment(null)
      }
    },
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
      writeFinanceOperation(manualKey, manualOperation.current)
      const [disposition, packageId = ''] = draft.value.split(':')
      return trainerFinance.createManualSession(clientId, {
        requestId: manualOperation.current.requestId,
        disposition: disposition === 'single' ? 'unassigned' : disposition as TrainerFinanceSession['disposition'],
        ...(draft.singleService ? {singleService:draft.singleService} : {}),
        packageId: disposition === 'charged' ? packageId : null,
        comment: draft.comment, workoutDate: draft.workoutDate,
      })
    },
    onSuccess: async session => { await refreshSession(session); setManualOpen(false); clearFinanceOperation(manualKey, manualOperation.current?.requestId); manualOperation.current = null; setPendingManualDraft(null) },
    onError: error => {
      // A first explicit rejection confirms no write. A later rejection cannot
      // resolve an earlier lost response: keep its payload/ID for a real replay.
      if (manualOperation.current?.attempts === 1 && error instanceof RepositoryError
        && ['invalid_request', 'PT422', 'PT403', 'PT404'].includes(error.code)) {
        clearFinanceOperation(manualKey, manualOperation.current?.requestId)
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
  const attendedWorkouts = finance.data?.attendedWorkouts ?? []
  const attendanceIds = new Set(attendedWorkouts.map(item => item.workoutId))
  const inPeriod = (date: string) => !monthView.enabled || monthView.allHistory || date.startsWith(monthView.month.slice(0,7))
  const periodSessions = sessions.filter(session => inPeriod(session.workoutDate)
    && (!monthView.enabled || monthView.allHistory || attendanceIds.has(session.workoutId)))
  const sessionWorkoutIds = new Set(sessions.map(session => session.workoutId))
  const attendanceWithoutLedger = monthView.enabled ? attendedWorkouts.filter(item => !sessionWorkoutIds.has(item.workoutId) && inPeriod(item.workoutDate)) : []
  const visiblePayments = payments.filter(payment => inPeriod(payment.receivedOn))
  const filteredSessions = periodSessions.filter((session) => sessionFilter === 'all' || (sessionFilter === 'unassigned' ? session.disposition !== 'charged' : session.disposition === 'trial'))
  const sessionRows = [
    ...filteredSessions.map(session => ({ kind: 'ledger' as const, session, workoutDate: session.workoutDate })),
    ...(sessionFilter === 'trial' ? [] : attendanceWithoutLedger).map(workout => ({ kind: 'attendance' as const, workout, workoutDate: workout.workoutDate })),
  ]
  const orderedSessions = monthView.enabled ? sessionRows.sort((a,b) => b.workoutDate.localeCompare(a.workoutDate)) : sessionRows
  const receivedCents = visiblePayments.reduce((sum, payment) => sum + payment.amountCents, 0)
  const dueCents = packages.filter((item) => item.closedAt === null).reduce((sum, item) => sum + item.dueCents, 0)
  const tabCount: Record<FinanceTab, number> = { packages: packages.length, sessions: periodSessions.length + attendanceWithoutLedger.length, payments: visiblePayments.length }
  const openPackage = (editor: PackageEditor) => {
    if (!packageOperation.current && !savePackage.isPending) savePackage.reset()
    setPaymentEditor(null)
    setPackageEditor(packageOperation.current?.editor ?? editor)
  }
  const openPayment = (packageId: string, payment?: TrainerFinancePayment, direct = false) => {
    if (!paymentOperation.current && !savePayment.isPending) savePayment.reset()
    setPaymentEditor(paymentOperation.current?.editor ?? { packageId, payment, direct })
  }
  const renderPayment = (payment: TrainerFinancePayment, showService = true) => <div className="finance-payment" key={payment.id}>
    <div><strong>{money(payment.amountCents)}</strong>{isFitLimeEnabled(actor) ? <><span>{formatLocalDate(localDate(payment.receivedOn))}</span>{payment.comment && <span className="finance-receipt-comment">{payment.comment}</span>}</> : <span>{formatLocalDate(localDate(payment.receivedOn))}{payment.comment ? ` · ${payment.comment}` : ''}</span>}</div>
    {showService && <span className="finance-payment-package">{packageById.get(payment.packageId)?.title ?? 'Услуга удалена'}</span>}
    <OverflowMenu label={`Действия с оплатой ${money(payment.amountCents)}`} items={[
      { label: 'Изменить', disabled: pendingPaymentDraft !== null, onClick: () => openPayment(payment.packageId, payment) },
      { label: 'Удалить', danger: true, onClick: () => void confirm({ message: `Удалить оплату ${money(payment.amountCents)} от ${formatLocalDate(localDate(payment.receivedOn))}?`, confirmLabel: 'Удалить', danger: true }).then((ok) => { if (ok) removePayment.mutate(payment) }) },
    ]} />
  </div>
  const renderPackage = (item: TrainerFinancePackage, history = false) => {
    const servicePayments = payments.filter((payment) => payment.packageId === item.id)
    return <article className={`finance-package card${history ? ' is-history' : ''}`} key={item.id}>
      <header><div><span className={`finance-status finance-status-${item.packageStatus}`}>{isFitLimeEnabled(actor) && item.singleSession ? 'Разовая · ' : item.kind === 'online_coaching' ? isFitLimeEnabled(actor) ? 'Ведение · ' : 'Онлайн · ' : ''}{PACKAGE_STATUS[item.packageStatus]}</span><h2>{item.title}</h2></div><OverflowMenu label={`Действия с услугой ${item.title}`} items={[...(canCreate && !(isFitLimeEnabled(actor) && item.singleSession) ? [{ label: 'Продлить', disabled: pendingPackageDraft !== null, onClick: () => openPackage({ mode: 'renew', item }) }] : []), { label: 'Редактировать', disabled: pendingPackageDraft !== null, onClick: () => openPackage({ mode: 'edit', item }) }]} /></header>
      <div className="finance-package-summary finance-service-balance">
        {item.kind === 'session_pack'
          ? <p><span>{isFitLimeEnabled(actor) && item.singleSession ? 'Занятие' : 'Осталось занятий'}</span><strong>{isFitLimeEnabled(actor) && item.singleSession ? item.sessionsUsed > 0 ? 'Проведено' : 'Не проведено' : `${item.sessionsRemaining} из ${item.sessionsTotal}`}</strong></p>
          : <p><span>Период</span><strong>{formatLocalDate(localDate(item.startsOn))} — {item.endsOn ? formatLocalDate(localDate(item.endsOn)) : '—'}</strong></p>}
      </div>
      <div className="finance-package-facts finance-service-money"><p><span>Стоимость</span><strong>{money(item.priceCents)}</strong></p><p><span>Оплачено</span><strong>{money(item.paidCents)}</strong></p><p><span>К оплате</span><strong>{money(item.dueCents)}</strong></p></div>
      <div className="finance-package-meta">
        <span>С {formatLocalDate(localDate(item.startsOn))}{item.endsOn ? ` по ${formatLocalDate(localDate(item.endsOn))}` : ''}</span>
        <span className={item.paymentStatus === 'overdue' ? 'is-overdue' : ''}>{item.priceCents === 0 && item.paidCents > 0 ? 'Стоимость не указана' : item.paidCents > item.priceCents ? `Переплата ${money(item.paidCents - item.priceCents)}` : PAYMENT_STATUS[item.paymentStatus]}</span>
      </div>
      {(item.dueCents > 0 || pendingPaymentPackageId === item.id) && <button type="button" className="secondary finance-inline-action" disabled={pendingPaymentDraft !== null && pendingPaymentPackageId !== item.id} onClick={() => openPayment(item.id, undefined, true)}>{pendingPaymentPackageId === item.id ? 'Проверить сохранение' : 'Внести оплату'}</button>}
      <details className="finance-service-payments finance-disclosure"><summary><span>Оплаты</span><small>{servicePayments.length}</small></summary><div className="finance-disclosure-content"><div className="finance-payment-list">{servicePayments.map((payment) => renderPayment(payment, false))}</div>{servicePayments.length === 0 && <p className="finance-empty">{monthView.enabled && !monthView.allHistory ? 'За этот месяц оплат нет.' : 'Оплат пока нет.'}</p>}</div></details>
      <details className="finance-package-details finance-disclosure">
        <summary><span>Подробнее</span></summary>
        <div className="finance-disclosure-content">
          <div className="finance-package-facts">{item.kind === 'session_pack' && <p><span>Проведено</span><strong>{item.sessionsUsed}</strong></p>}</div>
          {item.comment && <p className="finance-comment">{item.comment}</p>}
          {!isFitLimeEnabled(actor) && <div className="finance-package-actions">{canCreate && <button type="button" className="secondary" disabled={pendingPackageDraft !== null} onClick={() => openPackage({ mode: 'renew', item })}>Продлить</button>}<button type="button" className="secondary" disabled={pendingPackageDraft !== null} onClick={() => openPackage({ mode: 'edit', item })}>Изменить</button></div>}

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
    {monthView.enabled && <>
      <div className="finance-period-block"><span>Месяц</span><div className="finance-month-switcher" aria-label="Месяц финансов спортсмена">
        <button type="button" aria-label="Предыдущий месяц" onClick={() => monthView.move(-1)}><BackIcon /></button>
        <strong>{formatMonth(monthView.month)}</strong>
        <button type="button" aria-label="Следующий месяц" onClick={() => monthView.move(1)}><ChevronRightIcon /></button>
      </div></div>
      <AsyncView loading={monthView.query.isLoading} error={monthView.query.error} onRetry={() => void monthView.query.refetch()}>
        {monthView.query.data && monthView.query.data.completedSessions !== undefined && <FinanceMonthlySummary
          data={monthView.query.data} metric={monthView.metric} clientId={clientId} showMetricSwitch={false}
          onMetricChange={monthView.changeMetric} />}
      </AsyncView>
    </>}
    <AsyncView loading={finance.isLoading} error={finance.error} onRetry={() => void finance.refetch()}>
      {packageEditor && <PackageForm paymentEntry={packageEditor.mode === 'new' && packageEditor.fromPayment} lime={isFitLimeEnabled(actor)} current={packageEditor.mode === 'edit' ? packageEditor.item : undefined} template={packageEditor.mode === 'renew' ? packageEditor.item : undefined} today={today} saving={savePackage.isPending} error={savePackage.error} initialDraft={pendingPackageDraft ?? undefined} locked={pendingPackageDraft !== null} onCancel={() => setPackageEditor(null)} onSubmit={(draft) => savePackage.mutate({ draft, editor: packageEditor })} />}
      {paymentEditor && <PaymentForm onNewService={isFitLimeEnabled(actor) && canCreate && !pendingPaymentDraft ? () => openPackage({ mode: 'new', fromPayment: true }) : undefined} lime={isFitLimeEnabled(actor)} current={paymentEditor.payment} packages={paymentEditor.direct ? packages.filter((item) => item.id === paymentEditor.packageId) : packages} packageId={paymentEditor.packageId} today={today} saving={savePayment.isPending} error={savePayment.error} initialDraft={pendingPaymentDraft ?? undefined} locked={pendingPaymentDraft !== null} onCancel={() => setPaymentEditor(null)} onSubmit={(draft, packageId) => savePayment.mutate({ draft, packageId, editor: paymentEditor })} />}
      {!packageEditor && !paymentEditor && <>
        <div className="finance-tabs" role="tablist" aria-label="Раздел финансов клиента">{FINANCE_TABS.map((tab) => <button id={`finance-${tab.id}-tab`} key={tab.id} type="button" role="tab" aria-label={`${tab.label}: ${tabCount[tab.id]}`} aria-selected={activeTab === tab.id} aria-controls={`finance-${tab.id}-panel`} className={activeTab === tab.id ? 'is-active' : ''} onClick={() => changeTab(tab.id)}><span>{tab.label}</span><small>{tabCount[tab.id]}</small></button>)}</div>

        {monthView.enabled && activeTab !== 'packages' && <div className="finance-filter-row" role="group" aria-label="Период истории">
          <button type="button" className={!monthView.allHistory ? 'is-active' : ''} aria-pressed={!monthView.allHistory} onClick={() => monthView.changeHistory(false)}>За месяц</button>
          <button type="button" className={monthView.allHistory ? 'is-active' : ''} aria-pressed={monthView.allHistory} onClick={() => monthView.changeHistory(true)}>Вся история</button>
        </div>}
        <section id="finance-packages-panel" className="finance-tab-panel" data-finance-tab="packages" role="tabpanel" aria-labelledby="finance-packages-tab" hidden={activeTab !== 'packages'}>
          <div className="finance-section-heading"><div>{!isFitLimeEnabled(actor) && <p className="eyebrow">УСЛУГИ</p>}<h2>{isFitLimeEnabled(actor) ? activePackages.length ? 'Текущие услуги' : 'Услуги' : activePackages.length ? 'Текущие' : 'Нет активных'}</h2></div>{canCreate && <button type="button" className="primary" onClick={() => openPackage({ mode: 'new' })}>{pendingPackageDraft ? 'Проверить сохранение' : isFitLimeEnabled(actor) ? 'Новая услуга' : 'Новая'}</button>}</div>
          <div className="finance-package-list">{activePackages.map((item) => renderPackage(item))}</div>
          {finance.isSuccess && packages.length === 0 && <p className="finance-empty">Услуг пока нет.</p>}
          {pastPackages.length > 0 && <details className="finance-history finance-disclosure card"><summary><span>История</span><small>{pastPackages.length}</small></summary><div className="finance-disclosure-content finance-package-list">{pastPackages.map((item) => renderPackage(item, true))}</div></details>}
        </section>

        <section id="finance-sessions-panel" className="finance-tab-panel" data-finance-tab="sessions" role="tabpanel" aria-labelledby="finance-sessions-tab" hidden={activeTab !== 'sessions'}>
          <div className="finance-section-heading"><div>{!isFitLimeEnabled(actor) && <p className="eyebrow">ЗАНЯТИЯ</p>}<h2>{monthView.enabled ? monthView.allHistory ? 'Все занятия' : 'Занятия за месяц' : isFitLimeEnabled(actor) ? 'Проведённые занятия' : 'Проведённые'}</h2></div>{!manualOpen && (canCreate || pendingManualDraft) && <button type="button" className="primary" onClick={() => { if (!manualOperation.current) addManualSession.reset(); setManualOpen(true) }}>{pendingManualDraft ? 'Проверить сохранение' : 'Добавить'}</button>}</div>
          <div className="finance-filter-row finance-session-filters" role="group" aria-label="Фильтр занятий"><button type="button" className={sessionFilter === 'all' ? 'is-active' : ''} aria-pressed={sessionFilter === 'all'} onClick={() => setSessionFilter('all')}>Все</button><button type="button" className={sessionFilter === 'unassigned' ? 'is-active' : ''} aria-pressed={sessionFilter === 'unassigned'} onClick={() => setSessionFilter('unassigned')}>Без списания</button>{(!isFitLimeEnabled(actor) || sessions.some(session=>session.disposition==='trial')) && <button type="button" className={sessionFilter === 'trial' ? 'is-active' : ''} aria-pressed={sessionFilter === 'trial'} onClick={() => setSessionFilter('trial')}>Пробные</button>}</div>
          {manualOpen && <SessionAccountingForm lime={isFitLimeEnabled(actor)} packages={packages} today={today} initialDraft={pendingManualDraft ?? undefined}
            locked={pendingManualDraft !== null} saving={addManualSession.isPending} error={addManualSession.error}
            onCancel={() => { setManualOpen(false); if (!manualOperation.current) addManualSession.reset() }}
            onSubmit={draft => addManualSession.mutate(draft)} />}
          <div className="finance-session-list">{orderedSessions.map((row) => {
            if (row.kind === 'attendance') return <div className="finance-session" key={row.workout.workoutId}>
              <div className="finance-session-row"><div className="finance-session-leading"><span className="finance-session-number">—</span>
                <div className="finance-monthly-source"><strong>{formatLocalDate(localDate(row.workout.workoutDate))}</strong><span>{row.workout.title ?? 'С тренером'}</span></div></div>
                <div className="finance-session-accounting"><strong>Проведена</strong></div></div>
            </div>
            const session = row.session
            const editing = sessionEditor === session.id
            const sessionPackage = session.packageId ? packageById.get(session.packageId) : undefined
            const number = isFitLimeEnabled(actor)&&sessionPackage?.singleSession ? undefined : sessionNumberById.get(session.id)
            return <div className={`finance-session${editing ? ' is-editing' : ''}`} key={session.id}><div className="finance-session-row"><div className="finance-session-leading"><span className="finance-session-number">{number ? `№${number}` : '—'}</span><Link to={`/workouts/${session.workoutId}`}><strong>{formatLocalDate(localDate(session.workoutDate))}</strong><span>{session.source === 'manual' ? 'Добавлено вручную' : 'Из завершённой тренировки'}</span></Link></div><div className="finance-session-accounting"><strong>{isFitLimeEnabled(actor)&&sessionPackage?.singleSession&&session.disposition==='charged'?'Разовая · проведена':SESSION_STATUS[session.disposition]}</strong><span>{sessionPackage?.title ?? 'Без абонемента'}</span></div><OverflowMenu label={`Действия с занятием ${formatLocalDate(localDate(session.workoutDate))}`} items={[{ label: 'Изменить учёт', onClick: () => { updateSession.reset(); setSessionEditor(session.id) } }]} /></div>{editing && <SessionAccountingForm key={session.id} lime={isFitLimeEnabled(actor)} packages={packages} today={today} session={session}
              saving={updateSession.isPending} error={updateSession.error} onCancel={() => setSessionEditor(null)}
              onSubmit={draft => updateSession.mutate({ session, ...draft })} />}</div>
          })}</div>
          {finance.isSuccess && orderedSessions.length === 0 && <p className="finance-empty">В этом разделе занятий нет.</p>}
        </section>

        <section id="finance-payments-panel" className="finance-tab-panel" data-finance-tab="payments" role="tabpanel" aria-labelledby="finance-payments-tab" hidden={activeTab !== 'payments'}>
          <div className={`finance-payment-overview${monthView.enabled && !monthView.allHistory ? ' finance-monthly-payments-summary' : ''}`}>
            {(!monthView.enabled || monthView.allHistory) && <p><span>{monthView.enabled ? 'Получено за всю историю' : 'Получено'}</span><strong>{monthView.enabled ? financeMoney(receivedCents) : money(receivedCents)}</strong></p>}
            <p><span>{monthView.enabled ? 'К оплате сейчас' : 'К оплате'}</span><strong>{money(dueCents)}</strong></p></div>
          <div className="finance-section-heading"><div>{!isFitLimeEnabled(actor) && <p className="eyebrow">ОПЛАТЫ</p>}<h2>{monthView.enabled ? monthView.allHistory ? 'Все оплаты' : 'Оплаты за месяц' : isFitLimeEnabled(actor) ? 'История оплат' : 'История'}</h2></div><button type="button" className="primary" disabled={packages.length === 0 && !pendingPaymentDraft && (!isFitLimeEnabled(actor) || !canCreate)} onClick={() => isFitLimeEnabled(actor) && packages.length === 0 && !pendingPaymentDraft ? openPackage({ mode: 'new', fromPayment: true }) : openPayment(activePackages[0]?.id ?? packages[0]?.id ?? '')}>{pendingPaymentDraft ? 'Проверить сохранение' : isFitLimeEnabled(actor) ? 'Добавить оплату' : 'Добавить'}</button></div>
          <div className="finance-payment-list finance-payment-ledger">{visiblePayments.map((payment) => renderPayment(payment))}</div>
          {finance.isSuccess && visiblePayments.length === 0 && <p className="finance-empty">{monthView.enabled && !monthView.allHistory ? 'За этот месяц оплат нет.' : 'Оплат пока нет.'}</p>}
        </section>
      </>}
      {removePayment.error && <InlineRequestError error={removePayment.error} />}
    </AsyncView>
    {confirmDialog}
  </Page>
}
