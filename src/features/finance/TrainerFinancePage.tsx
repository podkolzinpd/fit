import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRef, useState, type FormEvent } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { useAuth } from '../../app/auth-context'
import { useDataBackend } from '../../app/data-backend-context'
import type {
  TrainerFinancePackage,
  TrainerFinancePackageDraft,
  TrainerFinancePayment, TrainerFinanceSession,
  TrainerFinancePaymentDraft,
} from '../../data/repositories/trainer-finance.repository'
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

export function PackageForm({ current, template, today, saving, error, onCancel, onSubmit }: {
  current?: TrainerFinancePackage
  template?: TrainerFinancePackage
  today: string
  saving: boolean
  error: Error | null
  onCancel: () => void
  onSubmit: (draft: TrainerFinancePackageDraft) => void
}) {
  const [validationError, setValidationError] = useState<string | null>(null)
  const source = current ?? template
  const renewalStart = template?.endsOn && template.endsOn >= today ? addDays(localDate(template.endsOn), 1) : today
  const renewalEnd = template?.endsOn && template.endsOn >= template.startsOn
    ? addDays(localDate(renewalStart), daysBetween(localDate(template.startsOn), localDate(template.endsOn))) : ''
  const [startsOn, setStartsOn] = useState(current?.startsOn ?? renewalStart)
  const [kind, setKind] = useState<TrainerFinancePackage['kind']>(source?.kind ?? 'session_pack')
  const [title, setTitle] = useState(source?.title ?? 'Персональные тренировки')
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setValidationError(null)
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
        startsOn, endsOn,
        paymentDueOn: optional(form, 'paymentDueOn'), comment: optional(form, 'comment'),
      })
    } catch (cause) {
      setValidationError(cause instanceof Error ? cause.message : 'Проверьте данные')
    }
  }
  return <form className="finance-form card" aria-busy={saving} onSubmit={submit}>
    <div className="finance-form-heading"><div><p className="eyebrow">ФИНАНСЫ</p><h2>{current ? 'Редактирование' : template ? 'Продление' : 'Новая услуга'}</h2></div></div>
    <Field label="Тип"><select name="kind" value={kind} disabled={Boolean(current)} onChange={(event) => {
      const next = event.target.value as TrainerFinancePackage['kind']
      setKind(next)
      if (title === 'Персональные тренировки' || title === 'Онлайн-сопровождение') setTitle(next === 'session_pack' ? 'Персональные тренировки' : 'Онлайн-сопровождение')
    }}><option value="session_pack">Пакет занятий</option><option value="online_coaching">Онлайн-сопровождение</option></select></Field>
    <Field label="Название"><input name="title" required maxLength={120} value={title} onChange={(event) => setTitle(event.target.value)} /></Field>
    <div className="finance-form-grid">
      {kind === 'session_pack' && <Field label="Всего занятий"><input name="sessionsTotal" type="number" inputMode="numeric" min="1" max="10000" required defaultValue={source?.sessionsTotal || 10} /></Field>}
      {kind === 'session_pack' && !current && <Field label="Уже проведено"><input name="openingUsedSessions" type="number" inputMode="numeric" min="0" max="10000" required defaultValue="0" /></Field>}
      <Field label="Стоимость, ₽"><input name="price" type="number" inputMode="decimal" min="0" step="0.01" required defaultValue={source ? source.priceCents / 100 : ''} /></Field>
      {!current && <Field label="Уже оплачено, ₽"><input name="openingPaid" type="number" inputMode="decimal" min="0" step="0.01" required defaultValue="0" /></Field>}
      <Field label="Начало"><input name="startsOn" type="date" required value={startsOn} onChange={(event) => setStartsOn(event.target.value)} /></Field>
      <Field label="Окончание"><input name="endsOn" type="date" required={kind === 'online_coaching'} min={startsOn} defaultValue={current?.endsOn ?? renewalEnd} /></Field>
      <Field label="Оплатить до"><input name="paymentDueOn" type="date" defaultValue={current?.paymentDueOn ?? ''} /></Field>
    </div>
    <Field label="Комментарий"><textarea name="comment" rows={2} maxLength={2000} defaultValue={source?.comment ?? ''} /></Field>
    {validationError && <p className="error" role="alert">{validationError}</p>}
    {error && <InlineRequestError error={error} />}
    <div className="actions"><button type="button" className="secondary" disabled={saving} onClick={onCancel}>Отмена</button><button type="submit" className="primary" disabled={saving}>{saving ? 'Сохраняем…' : 'Сохранить'}</button></div>
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
  return <form className="finance-form card" onSubmit={(event) => {
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
    {!current && packages.length > 1 && <Field label="Услуга"><select name="packageId" required defaultValue={packageId ?? packages[0]?.id}>{packages.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></Field>}
    <div className="finance-form-grid"><Field label="Сумма, ₽"><input name="amount" type="number" inputMode="decimal" min="0.01" step="0.01" required defaultValue={current ? current.amountCents / 100 : ''} /></Field><Field label="Дата"><input name="receivedOn" type="date" required defaultValue={current?.receivedOn ?? today} /></Field></div>
    <Field label="Комментарий"><input name="comment" maxLength={2000} defaultValue={current?.comment ?? ''} /></Field>
    {validationError && <p className="error" role="alert">{validationError}</p>}
    {error && <InlineRequestError error={error} />}
    <div className="actions"><button type="button" className="secondary" disabled={saving} onClick={onCancel}>Отмена</button><button type="submit" className="primary" disabled={saving}>{saving ? 'Сохраняем…' : 'Сохранить'}</button></div>
  </form>
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
  const { clients, trainerFinance } = useDataBackend()
  const queryClient = useQueryClient()
  const today = todayInTimeZone(actor?.timezone)
  const [activeTab, setActiveTab] = useState<FinanceTab>('packages')
  const [sessionFilter, setSessionFilter] = useState<'all' | 'unassigned' | 'trial'>('all')
  const [packageEditor, setPackageEditor] = useState<PackageEditor | null>(null)
  const [paymentEditor, setPaymentEditor] = useState<{ packageId: string; payment?: TrainerFinancePayment } | null>(null)
  const manualOperation = useRef<{ payload: string; requestId: string } | null>(null)
  const [manualOpen, setManualOpen] = useState(false)
  const [sessionEditor, setSessionEditor] = useState<string | null>(null)
  const [confirm, confirmDialog] = useConfirm()
  const client = useQuery({ queryKey: ['client', clientId], queryFn: () => clients.get(clientId) })
  const finance = useQuery({ queryKey: ['trainer-finance', clientId], queryFn: () => trainerFinance.listClient(clientId) })
  const refresh = async () => { await queryClient.invalidateQueries({ queryKey: ['trainer-finance', clientId] }) }
  const savePackage = useMutation({
    mutationFn: async (draft: TrainerFinancePackageDraft) => packageEditor?.mode !== 'edit'
      ? trainerFinance.createPackage(clientId, draft)
      : trainerFinance.updatePackage(packageEditor.item.id, { ...draft, expectedVersion: packageEditor.item.version }),
    onSuccess: async () => { setPackageEditor(null); await refresh() },
  })
  const savePayment = useMutation({
    mutationFn: async ({ draft, packageId }: { draft: TrainerFinancePaymentDraft; packageId: string }) => paymentEditor?.payment
      ? trainerFinance.updatePayment(paymentEditor.payment.id, { ...draft, expectedVersion: paymentEditor.payment.version })
      : trainerFinance.addPayment(packageId, draft),
    onSuccess: async () => { setPaymentEditor(null); await refresh() },
  })
  const removePayment = useMutation({
    mutationFn: (payment: TrainerFinancePayment) => trainerFinance.voidPayment(payment.id, payment.version, 'Удалено тренером'),
    onSuccess: refresh,
  })
  const addManualSession = useMutation({
    mutationFn: async (draft: { workoutDate: string; value: string; comment: string | null }) => {
      const payload = JSON.stringify(draft)
      if (!manualOperation.current) {
        manualOperation.current = { payload, requestId: crypto.randomUUID() }
      }
      const [disposition, packageId = ''] = draft.value.split(':')
      return trainerFinance.createManualSession(clientId, {
        requestId: manualOperation.current.requestId,
        disposition: disposition as TrainerFinanceSession['disposition'],
        packageId: disposition === 'charged' ? packageId : null,
        comment: draft.comment, workoutDate: draft.workoutDate,
      })
    },
    onSuccess: async () => { setManualOpen(false); manualOperation.current = null; await refresh() },
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
    onSuccess: async () => { setSessionEditor(null); await refresh() },
  })
  const packages = finance.data?.packages ?? []
  const activePackages = packages.filter((item) => item.packageStatus === 'active' || item.packageStatus === 'upcoming')
  const activeSessionPackages = activePackages.filter((item) => item.kind === 'session_pack')
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
  const renderPackage = (item: TrainerFinancePackage, history = false) => {
    return <article className={`finance-package card${history ? ' is-history' : ''}`} key={item.id}>
      <header><div><span className={`finance-status finance-status-${item.packageStatus}`}>{item.kind === 'online_coaching' ? 'Онлайн · ' : ''}{PACKAGE_STATUS[item.packageStatus]}</span><h2>{item.title}</h2></div><OverflowMenu label={`Действия с услугой ${item.title}`} items={[{ label: 'Продлить', onClick: () => setPackageEditor({ mode: 'renew', item }) }, { label: 'Редактировать', onClick: () => setPackageEditor({ mode: 'edit', item }) }]} /></header>
      <div className="finance-package-summary">
        {item.kind === 'session_pack'
          ? <p><span>Осталось занятий</span><strong>{item.sessionsRemaining} из {item.sessionsTotal}</strong></p>
          : <p><span>Период</span><strong>{formatLocalDate(localDate(item.startsOn))} — {item.endsOn ? formatLocalDate(localDate(item.endsOn)) : '—'}</strong></p>}
        <p><span>Оплата</span><strong>{money(item.paidCents)}</strong><small>{item.priceCents === 0 && item.paidCents > 0 ? 'Стоимость не указана' : item.paidCents > item.priceCents ? `Переплата ${money(item.paidCents - item.priceCents)}` : `${PAYMENT_STATUS[item.paymentStatus]} · из ${money(item.priceCents)}`}</small></p>
      </div>
      <div className="finance-package-meta">
        <span>С {formatLocalDate(localDate(item.startsOn))}{item.endsOn ? ` по ${formatLocalDate(localDate(item.endsOn))}` : ''}</span>
        {item.dueCents > 0 && <strong className={item.paymentStatus === 'overdue' ? 'is-overdue' : ''}>К оплате {money(item.dueCents)}</strong>}
      </div>
      <details className="finance-package-details finance-disclosure">
        <summary><span>Подробнее</span></summary>
        <div className="finance-disclosure-content">
          <div className="finance-package-facts">{item.kind === 'session_pack' && <p><span>Проведено</span><strong>{item.sessionsUsed}</strong></p>}<p><span>Оплачено</span><strong>{money(item.paidCents)}</strong></p><p><span>К оплате</span><strong>{money(item.dueCents)}</strong></p></div>
          {item.comment && <p className="finance-comment">{item.comment}</p>}
          <div className="finance-package-actions"><button type="button" className="secondary" onClick={() => setPackageEditor({ mode: 'renew', item })}>Продлить</button><button type="button" className="secondary" onClick={() => setPackageEditor({ mode: 'edit', item })}>Изменить</button></div>
        </div>
      </details>
    </article>
  }
  const financeBackTo = routeState && typeof routeState === 'object'
    && 'financeBackTo' in routeState && routeState.financeBackTo === '/finance'
    ? '/finance'
    : `/clients/${clientId}`
  return <Page title="Финансы" subtitle={client.data?.fullName} back={financeBackTo} swipeBack className="trainer-finance-page">
    <AsyncView loading={client.isLoading || finance.isLoading} error={(client.error ?? finance.error) as Error | null} onRetry={() => { void client.refetch(); void finance.refetch() }}>
      {packageEditor && <PackageForm current={packageEditor.mode === 'edit' ? packageEditor.item : undefined} template={packageEditor.mode === 'renew' ? packageEditor.item : undefined} today={today} saving={savePackage.isPending} error={savePackage.error} onCancel={() => setPackageEditor(null)} onSubmit={(draft) => savePackage.mutate(draft)} />}
      {paymentEditor && <PaymentForm current={paymentEditor.payment} packages={packages} packageId={paymentEditor.packageId} today={today} saving={savePayment.isPending} error={savePayment.error} onCancel={() => setPaymentEditor(null)} onSubmit={(draft, packageId) => savePayment.mutate({ draft, packageId })} />}
      {!packageEditor && !paymentEditor && <>
        <div className="finance-tabs" role="tablist" aria-label="Раздел финансов клиента">{FINANCE_TABS.map((tab) => <button id={`finance-${tab.id}-tab`} key={tab.id} type="button" role="tab" aria-label={`${tab.label}: ${tabCount[tab.id]}`} aria-selected={activeTab === tab.id} aria-controls={`finance-${tab.id}-panel`} className={activeTab === tab.id ? 'is-active' : ''} onClick={() => setActiveTab(tab.id)}><span>{tab.label}</span><small>{tabCount[tab.id]}</small></button>)}</div>

        <section id="finance-packages-panel" className="finance-tab-panel" data-finance-tab="packages" role="tabpanel" aria-labelledby="finance-packages-tab" hidden={activeTab !== 'packages'}>
          <div className="finance-section-heading"><div><p className="eyebrow">УСЛУГИ</p><h2>{activePackages.length ? 'Текущие' : 'Нет активных'}</h2></div><button type="button" className="primary" onClick={() => setPackageEditor({ mode: 'new' })}>Новая</button></div>
          <div className="finance-package-list">{activePackages.map((item) => renderPackage(item))}</div>
          {finance.isSuccess && packages.length === 0 && <p className="finance-empty">Услуг пока нет.</p>}
          {pastPackages.length > 0 && <details className="finance-history finance-disclosure card"><summary><span>История</span><small>{pastPackages.length}</small></summary><div className="finance-disclosure-content finance-package-list">{pastPackages.map((item) => renderPackage(item, true))}</div></details>}
        </section>

        <section id="finance-sessions-panel" className="finance-tab-panel" data-finance-tab="sessions" role="tabpanel" aria-labelledby="finance-sessions-tab" hidden={activeTab !== 'sessions'}>
          <div className="finance-section-heading"><div><p className="eyebrow">ЗАНЯТИЯ</p><h2>Проведённые</h2></div>{!manualOpen && <button type="button" className="primary" onClick={() => setManualOpen(true)}>Добавить</button>}</div>
          <div className="finance-filter-row finance-session-filters" role="group" aria-label="Фильтр занятий"><button type="button" className={sessionFilter === 'all' ? 'is-active' : ''} aria-pressed={sessionFilter === 'all'} onClick={() => setSessionFilter('all')}>Все</button><button type="button" className={sessionFilter === 'unassigned' ? 'is-active' : ''} aria-pressed={sessionFilter === 'unassigned'} onClick={() => setSessionFilter('unassigned')}>Без списания</button><button type="button" className={sessionFilter === 'trial' ? 'is-active' : ''} aria-pressed={sessionFilter === 'trial'} onClick={() => setSessionFilter('trial')}>Пробные</button></div>
          {manualOpen && <form className="finance-manual-session" aria-busy={addManualSession.isPending} onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); addManualSession.mutate({ workoutDate: String(form.get('workoutDate') ?? ''), value: String(form.get('accounting') ?? 'unassigned'), comment: optional(form, 'comment') }) }}><Field label="Дата занятия"><input name="workoutDate" type="date" required defaultValue={today} /></Field><Field label="Учёт"><select name="accounting" defaultValue="unassigned"><option value="unassigned">Выбрать позже</option>{activeSessionPackages.map((item) => <option key={item.id} value={`charged:${item.id}`}>Списать: {item.title}</option>)}<option value="free">Без списания</option><option value="trial">Пробное</option></select></Field><Field label="Комментарий"><input name="comment" maxLength={2000} /></Field><div className="actions"><button type="button" className="secondary" disabled={addManualSession.isPending} onClick={() => setManualOpen(false)}>Отмена</button><button type="submit" className="primary" disabled={addManualSession.isPending}>{addManualSession.isPending ? 'Добавляем…' : 'Добавить'}</button></div></form>}
          <div className="finance-session-list">{filteredSessions.map((session) => {
            const editing = sessionEditor === session.id
            const eligible = packages.filter((item) => item.kind === 'session_pack' && (item.id === session.packageId || (item.closedAt === null && item.sessionsRemaining > 0 && item.startsOn <= session.workoutDate && (item.endsOn === null || item.endsOn >= session.workoutDate))))
            const sessionPackage = session.packageId ? packageById.get(session.packageId) : undefined
            const number = sessionNumberById.get(session.id)
            return <div className={`finance-session${editing ? ' is-editing' : ''}`} key={session.id}><div className="finance-session-row"><div className="finance-session-leading"><span className="finance-session-number">{number ? `№${number}` : '—'}</span><Link to={`/workouts/${session.workoutId}`}><strong>{formatLocalDate(localDate(session.workoutDate))}</strong><span>{session.source === 'manual' ? 'Добавлено вручную' : 'Из завершённой тренировки'}</span></Link></div><div className="finance-session-accounting"><strong>{SESSION_STATUS[session.disposition]}</strong><span>{sessionPackage?.title ?? 'Без абонемента'}</span></div><OverflowMenu label={`Действия с занятием ${formatLocalDate(localDate(session.workoutDate))}`} items={[{ label: 'Изменить учёт', onClick: () => setSessionEditor(session.id) }]} /></div>{editing && <form className="finance-session-editor" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); updateSession.mutate({ session, value: String(form.get('accounting') ?? 'unassigned'), workoutDate: String(form.get('workoutDate') ?? session.workoutDate), comment: optional(form, 'comment') }) }}><Field label="Дата"><input name="workoutDate" type="date" required defaultValue={session.workoutDate} /></Field><Field label="Учёт"><select name="accounting" defaultValue={session.disposition === 'charged' ? `charged:${session.packageId}` : session.disposition}><option value="unassigned">Выбрать позже</option>{eligible.map((item) => <option key={item.id} value={`charged:${item.id}`}>Списать: {item.title}</option>)}<option value="free">Без списания</option><option value="trial">Пробное</option></select></Field><Field label="Комментарий"><input name="comment" maxLength={2000} defaultValue={session.comment ?? ''} /></Field><div className="actions"><button type="button" className="secondary" onClick={() => setSessionEditor(null)}>Отмена</button><button type="submit" className="primary" disabled={updateSession.isPending}>{updateSession.isPending ? 'Сохраняем…' : 'Сохранить'}</button></div></form>}</div>
          })}</div>
          {finance.isSuccess && filteredSessions.length === 0 && <p className="finance-empty">В этом разделе занятий нет.</p>}
          {addManualSession.error && <InlineRequestError error={addManualSession.error} />}
          {updateSession.error && <InlineRequestError error={updateSession.error} />}
        </section>

        <section id="finance-payments-panel" className="finance-tab-panel" data-finance-tab="payments" role="tabpanel" aria-labelledby="finance-payments-tab" hidden={activeTab !== 'payments'}>
          <div className="finance-payment-overview"><p><span>Получено</span><strong>{money(receivedCents)}</strong></p><p><span>К оплате</span><strong>{money(dueCents)}</strong></p></div>
          <div className="finance-section-heading"><div><p className="eyebrow">ОПЛАТЫ</p><h2>История</h2></div><button type="button" className="primary" disabled={packages.length === 0} onClick={() => setPaymentEditor({ packageId: activePackages[0]?.id ?? packages[0]!.id })}>Добавить</button></div>
          <div className="finance-payment-list finance-payment-ledger">{payments.map((payment) => { const paymentPackage = packageById.get(payment.packageId); return <div className="finance-payment" key={payment.id}><div><strong>{money(payment.amountCents)}</strong><span>{formatLocalDate(localDate(payment.receivedOn))}{payment.comment ? ` · ${payment.comment}` : ''}</span></div><span className="finance-payment-package">{paymentPackage?.title ?? 'Услуга удалена'}</span><OverflowMenu label={`Действия с оплатой ${money(payment.amountCents)}`} items={[{ label: 'Изменить', onClick: () => setPaymentEditor({ packageId: payment.packageId, payment }) }, { label: 'Удалить', danger: true, onClick: () => void confirm({ message: `Удалить оплату ${money(payment.amountCents)}? Итог пересчитается, запись останется в истории.`, confirmLabel: 'Удалить', danger: true }).then((ok) => { if (ok) removePayment.mutate(payment) }) }]} /></div> })}</div>
          {finance.isSuccess && payments.length === 0 && <p className="finance-empty">Оплат пока нет.</p>}
        </section>
      </>}
      {removePayment.error && <InlineRequestError error={removePayment.error} />}
    </AsyncView>
    {confirmDialog}
  </Page>
}
