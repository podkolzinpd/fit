import { useRef, useState, type PropsWithChildren } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../app/auth-context'
import { isFitLimeEnabled } from '../../app/fit-lime'
import { CorporateServiceError, corporateServiceKind, corporateServicesRepository as repository, type CorporateService, type CorporateServiceKind, type ServiceCursor, type ServiceDraft, type ServiceOffice } from '../../data/repositories/corporate-services.repository'
import { FitLimeDatePicker } from '../../shared/FitLimeDatePicker'
import { currentTimeInTimeZone, formatLocalDate, localDate, todayInTimeZone } from '../../shared/local-date'
import { AsyncView, EmptyState, Field, Page, SaveStatus, StatePanel, useConfirm } from '../../shared/ui'
import { ServicePeriod } from './ServicePeriod'
import { serviceInstant, serviceKinds, serviceLabels, servicePeriod, serviceTimeLabel } from './service-time'
import './services.css'

const root = '/profile/yandex-services'
const accessKey = (id?: string) => ['corporate-services-access', id]
function useServiceAccess() {
  const { actor } = useAuth()
  return useQuery({ queryKey: accessKey(actor?.userId), queryFn: () => repository.access(), enabled: actor?.role === 'trainer', retry: false, staleTime: 0, gcTime: 0, refetchOnMount: 'always' })
}
export function CorporateServiceEntry() {
  const access = useServiceAccess()
  return access.data === true ? <div className="menu corporate-service-entry"><Link to={root}>Работа в Яндексе</Link></div> : null
}
function ServiceGate({ children }: PropsWithChildren) {
  const access = useServiceAccess()
  return <AsyncView loading={access.isPending} error={access.error} onRetry={() => void access.refetch()}>
    {access.data === true ? children : <StatePanel tone="info" title="Нет доступа" description="Учёт услуг доступен только тренерам с отдельным допуском и действующим назначением офиса." />}
  </AsyncView>
}
export function CorporateServicesPage() {
  return <Page title="Работа в Яндексе" back="/profile" swipeBack className="corporate-services-page ym-hide-content"><ServiceGate><ServicesWorkspace /></ServiceGate></Page>
}
function ServicesWorkspace() {
  const { actor } = useAuth()
  const [params] = useSearchParams()
  const zone = actor!.timezone
  const [range, setRange] = useState(() => servicePeriod(zone, 'month'))
  const history = useInfiniteQuery({ queryKey: ['corporate-services', actor!.userId, range], queryFn: ({ pageParam }) => repository.list(range, pageParam), initialPageParam: undefined as ServiceCursor | undefined, getNextPageParam: page => page.nextCursor ?? undefined, retry: false })
  const rows = history.data?.pages.flatMap(page => page.records)
  const effectiveZone = history.data?.pages[0]?.timeZone ?? zone
  return <div className="corporate-service-workspace">
    <p className="corporate-service-note">Отмечайте услуги, оказанные сотрудникам Яндекса. Регистрация посетителя не нужна.</p>
    <div className="corporate-service-actions" aria-label="Отметить услугу">{serviceKinds.map(kind => <Link className="secondary" key={kind} to={`${root}/new?kind=${kind}`}>{serviceLabels[kind]}</Link>)}</div>
    {params.get('saved') === '1' && <SaveStatus status="saved" />}
    <section className="corporate-service-history"><div className="corporate-service-heading"><h2>Мои услуги</h2><button className="secondary" type="button" disabled={history.isFetching} onClick={() => void history.refetch()}>Обновить</button></div><ServicePeriod range={range} zone={effectiveZone} onChange={setRange} />
      <p className="corporate-service-note">Время аккаунта: {effectiveZone}</p>
      <AsyncView loading={history.isPending} error={history.error} onRetry={() => void history.refetch()}>
        {rows?.length ? <ul className="corporate-service-list">{rows.map(row => <li key={row.id}><div><strong>{serviceLabels[row.kind]}</strong><p>{row.city} · {row.officeName}</p><p>{serviceTimeLabel(row.occurredAt, effectiveZone)}</p>{row.voidedAt && <p>Отменена · не входит в статистику</p>}</div><Link className="secondary" to={`${root}/${row.id}`}>{row.voidedAt ? 'История' : 'Исправить'}</Link></li>)}</ul> : rows && <EmptyState title="За этот период услуг нет" description="Отметьте оказанную услугу или выберите другой период." />}
      </AsyncView>
      {history.hasNextPage && <button type="button" className="secondary" disabled={history.isFetchingNextPage} onClick={() => void history.fetchNextPage()}>{history.isFetchingNextPage ? 'Загружаем…' : 'Показать ещё'}</button>}
    </section>
  </div>
}
export function CorporateServiceRecordPage() {
  const { id } = useParams()
  return <Page title={id ? 'Запись услуги' : 'Отметить услугу'} back={root} swipeBack className="corporate-services-page ym-hide-content"><ServiceGate><RecordLoader id={id} /></ServiceGate></Page>
}
function RecordLoader({ id }: { id?: string }) {
  const { actor } = useAuth()
  const [params] = useSearchParams()
  const range = servicePeriod(actor!.timezone, 'today')
  const metadata = useQuery({ queryKey: ['corporate-service-offices', actor!.userId, range], queryFn: () => repository.list(range), retry: false, staleTime: 0, refetchOnWindowFocus: false, refetchOnReconnect: false })
  const record = useQuery({ queryKey: ['corporate-service-record', actor!.userId, id], queryFn: () => repository.record(id!), enabled: Boolean(id), retry: false, staleTime: 0, refetchOnWindowFocus: false, refetchOnReconnect: false })
  const kind = corporateServiceKind.safeParse(params.get('kind'))
  return <AsyncView loading={metadata.isPending || Boolean(id && record.isPending)} error={metadata.error ?? record.error} onRetry={() => { void metadata.refetch(); if (id) void record.refetch() }}>
    {metadata.data && (!id || record.data) && <ServiceForm key={record.data ? `${record.data.id}:${record.data.version}` : 'new'} record={record.data} initialKind={kind.success ? kind.data : 'consultation'} offices={metadata.data.offices} zone={metadata.data.timeZone} />}
  </AsyncView>
}
function ServiceForm({ record, initialKind, offices, zone }: { record?: CorporateService; initialKind: CorporateServiceKind; offices: ServiceOffice[]; zone: string }) {
  const { actor } = useAuth()
  const client = useQueryClient(), navigate = useNavigate()
  const [confirm, confirmation] = useConfirm()
  const [initial] = useState(() => ({ id: record?.id ?? crypto.randomUUID(), at: record?.occurredAt ?? new Date().toISOString() }))
  const [auditOpen, setAuditOpen] = useState(Boolean(record?.voidedAt))
  const command = useRef<{ payload: string; id: string } | null>(null)
  const voidCommand = useRef(crypto.randomUUID())
  const form = useForm({ defaultValues: { kind: record?.kind ?? initialKind, officeId: record?.officeId ?? (offices.length === 1 ? offices[0]!.id : ''), date: todayInTimeZone(zone, new Date(initial.at)), time: currentTimeInTimeZone(zone, new Date(initial.at)) } })
  const date = useWatch({ control: form.control, name: 'date' }), time = useWatch({ control: form.control, name: 'time' })
  const refresh = async () => {
    await Promise.all([client.invalidateQueries({ queryKey: ['corporate-services', actor!.userId] }), client.invalidateQueries({ queryKey: ['corporate-service-record', actor!.userId] }), client.invalidateQueries({ queryKey: ['corporate-service-statistics'] })])
    navigate(`${root}?saved=1`, { replace: true })
  }
  const denied = (error: Error) => { if (error instanceof CorporateServiceError && error.status === 403) void client.invalidateQueries({ queryKey: accessKey(actor!.userId) }) }
  const save = useMutation({ mutationFn: (draft: ServiceDraft) => repository.save(draft), onSuccess: refresh, onError: denied })
  const cancel = useMutation({ mutationFn: () => repository.void(initial.id, voidCommand.current, record!.version), onSuccess: refresh, onError: denied })
  const recover = useMutation({ mutationFn: () => repository.record(initial.id), onSuccess: value => { client.setQueryData(['corporate-service-record', actor!.userId, initial.id], value); navigate(`${root}/${initial.id}`, { replace: true }) } })
  const busy = save.isPending || cancel.isPending || recover.isPending
  return <div className="corporate-service-workspace">
    {record?.voidedAt ? <StatePanel tone="info" title="Услуга отменена" description="Запись и история сохранены. В статистику эта услуга не входит." /> : <form className="corporate-service-form" aria-label="Данные услуги" onSubmit={event => { void form.handleSubmit(value => {
      let at: string
      try { at = serviceInstant(value.date, value.time, zone, initial.at); if (Date.parse(at) > Date.now()) throw new Error('Нельзя отметить услугу в будущем.') } catch (error) { form.setError('time', { message: error instanceof Error ? error.message : 'Проверьте время.' }); return }
      const draft = { id: initial.id, kind: value.kind, officeId: value.officeId, occurredAt: at, version: record?.version ?? 0 }
      const payload = JSON.stringify(draft)
      if (command.current?.payload !== payload) command.current = { payload, id: crypto.randomUUID() }
      save.mutate({ ...draft, commandId: command.current!.id })
    })(event) }}>
      <p className="corporate-service-note">Подтверждаю: услуга оказана сотруднику Яндекса.</p>
      <fieldset disabled={busy}>
        <Field label="Услуга"><select aria-label="Услуга" {...form.register('kind')}>{serviceKinds.map(kind => <option key={kind} value={kind}>{serviceLabels[kind]}</option>)}</select></Field>
        <Field label="Офис" error={form.formState.errors.officeId?.message}><select aria-label="Офис" {...form.register('officeId', { required: 'Выберите офис', validate: value => offices.some(office => office.id === value) || 'Выберите действующий назначенный офис' })}><option value="">Выберите офис</option>{record?.officeId && !offices.some(o => o.id === record.officeId) && <option disabled value={record.officeId}>{record.city} · {record.officeName} (недоступен)</option>}{offices.map(office => <option value={office.id} key={office.id}>{office.city} · {office.name}</option>)}</select></Field>
        <div className="corporate-service-date"><span>Дата и время</span><FitLimeDatePicker reference={isFitLimeEnabled(actor)} today={todayInTimeZone(zone)} value={localDate(date)} onChange={value => { form.setValue('date', value); form.clearErrors('time') }} time={{ start: time, end: '' }} onTimeChange={value => { form.setValue('time', value.start); form.clearErrors('time') }} showEndTime={false} startLabel="Время" triggerLabel={`${formatLocalDate(localDate(date))} · ${time}`} />{form.formState.errors.time?.message && <p className="error" role="alert">{form.formState.errors.time.message}</p>}</div>
        <p className="corporate-service-note">Время аккаунта: {zone}</p>
        <div className="actions"><button className="primary" type="submit" aria-busy={save.isPending}>{record ? 'Сохранить исправление' : 'Сохранить услугу'}</button><Link className="secondary" to={root}>Назад к услугам</Link></div>
      </fieldset>
      <SaveStatus status={save.isPending ? 'saving' : save.isError ? 'error' : 'idle'} error={save.error?.message} />
      {save.isError && <button className="secondary" type="button" disabled={busy} onClick={async () => { if (await confirm({ message: 'Загрузить сохранённую запись? Несохранённый ввод будет заменён.', confirmLabel: 'Загрузить запись' })) recover.mutate() }}>Загрузить сохранённую запись</button>}
      {recover.isError && <p role="alert" className="error">{recover.error.message}</p>}
    </form>}
    {record && <section className="corporate-service-record-actions">
      {!record.voidedAt && <button className="secondary" type="button" disabled={busy} onClick={async () => { if (await confirm({ message: 'Отменить услугу? Она исчезнет из итогов, запись и история сохранятся.', confirmLabel: 'Отменить услугу', danger: true })) cancel.mutate() }}>Отменить услугу</button>}
      <SaveStatus status={cancel.isPending ? 'saving' : cancel.isError ? 'error' : 'idle'} error={cancel.error?.message} />
      <button className="secondary" type="button" aria-expanded={auditOpen} onClick={() => setAuditOpen(value => !value)}>История изменений</button>
      {auditOpen && <ServiceAudit id={record.id} zone={zone} />}
    </section>}
    {confirmation}
  </div>
}
function ServiceAudit({ id, zone }: { id: string; zone: string }) {
  const { actor } = useAuth()
  const audit = useInfiniteQuery({ queryKey: ['corporate-service-audit', actor!.userId, id], queryFn: ({ pageParam }) => repository.audit(id, pageParam), initialPageParam: undefined as number | undefined, getNextPageParam: page => page.nextBeforeVersion ?? undefined, retry: false })
  return <AsyncView loading={audit.isPending} error={audit.error} onRetry={() => void audit.refetch()}><ol className="corporate-service-audit">{audit.data?.pages.flatMap(page => page.events).map(event => <li key={event.version}><strong>{event.action === 'create' ? 'Создана' : event.action === 'update' ? 'Исправлена' : 'Отменена'} · версия {event.version}</strong><p>{serviceTimeLabel(event.at, zone)}</p><p>{serviceLabels[event.after.kind]} · {event.after.city}, {event.after.officeName} · {serviceTimeLabel(event.after.occurredAt, zone)}</p>{event.before && <p>До изменения: {serviceLabels[event.before.kind]} · {event.before.city}, {event.before.officeName} · {serviceTimeLabel(event.before.occurredAt, zone)}</p>}</li>)}</ol>{audit.hasNextPage && <button type="button" className="secondary" disabled={audit.isFetchingNextPage} onClick={() => void audit.fetchNextPage()}>Ещё изменения</button>}</AsyncView>
}
