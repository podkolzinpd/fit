import { useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../app/auth-context'
import { useAppTheme } from '../../app/theme'
import { corporateAdminRepository as repository } from '../../data/repositories/corporate-admin.repository'
import type { CorporateAdminBundle, CorporateOffice, CorporateTrainer } from '../../shared/corporate-admin'
import { AsyncView, EmptyState, Field, Page, SaveStatus, StatePanel, useConfirm } from '../../shared/ui'
import './corporate-admin.css'
import { matchesAdminTrainer } from './trainer-search'

function useAdminAccess() {
  const { actor } = useAuth()
  return useQuery({ queryKey: ['corporate-admin-access', actor?.userId], queryFn: () => repository.access(),
    enabled: Boolean(actor), staleTime: 0, retry: false })
}

export function CorporateAdminEntry() {
  const access = useAdminAccess()
  return access.data === true ? <div className="menu"><Link to="/admin">Администрирование</Link></div> : null
}

export function CorporateAdminPage() {
  const access = useAdminAccess()
  const { actor } = useAuth()
  const theme = useAppTheme()
  return <div className={`corporate-admin-shell ui-identity ${theme === 'light' ? 'theme-light' : ''}`}>
    <Page title="Администрирование" action={<Link className="secondary" to={actor?.role === 'client' ? '/me/settings' : '/profile/settings'}>Вернуться в ФИТ</Link>}>
      <AsyncView loading={access.isPending} error={access.error} onRetry={() => void access.refetch()}>
        {access.data === true ? <AdminWorkspace /> : <StatePanel tone="info" title="Нет доступа"
          description="Кабинет доступен назначенным администраторам. Вход выполняется через обычную учётную запись ФИТ; регистрация сама по себе не даёт прав администратора." />}
      </AsyncView>
    </Page>
  </div>
}

function AdminWorkspace() {
  const { actor } = useAuth()
  const [params, setParams] = useSearchParams()
  const officesTab = params.get('tab') === 'offices'
  const query = useQuery({ queryKey: ['corporate-admin-bundle', actor?.userId], queryFn: () => repository.bundle(), retry: false })
  return <>
    <nav className="corporate-admin-tabs" aria-label="Разделы кабинета">
      <button type="button" className="secondary" aria-current={!officesTab ? 'page' : undefined} onClick={() => setParams({})}>Тренеры</button>
      <button type="button" className="secondary" aria-current={officesTab ? 'page' : undefined} onClick={() => setParams({ tab: 'offices' })}>Офисы</button>
    </nav>
    <AsyncView loading={query.isPending} error={query.error} onRetry={() => void query.refetch()}>
      {query.data && (officesTab ? <Offices key="offices" data={query.data} /> : <Trainers key="trainers" data={query.data} />)}
    </AsyncView>
  </>
}

function useSave() {
  const { actor } = useAuth()
  const client = useQueryClient()
  return useMutation({ mutationFn: async (input: { kind: 'office'; value: CorporateOffice } | { kind: 'trainer'; value: CorporateTrainer }) => {
    if (input.kind === 'office') await repository.saveOffice(input.value)
    else await repository.saveTrainer(input.value)
  }, onSuccess: async () => { await client.invalidateQueries({ queryKey: ['corporate-admin-bundle', actor?.userId] }) } })
}

function Offices({ data }: { data: CorporateAdminBundle }) {
  const [selected, setSelected] = useState<CorporateOffice | null>(null)
  const [showArchive, setShowArchive] = useState(false)
  const save = useSave()
  const [confirm, confirmation] = useConfirm()
  const select = (office: CorporateOffice | null) => { save.reset(); setSelected(office) }
  const archive = async (office: CorporateOffice) => {
    if (!await confirm({ message: office.archived ? `Восстановить офис «${office.name}»?` : `Архивировать офис «${office.name}»? История сохранится.`, confirmLabel: office.archived ? 'Восстановить' : 'Архивировать' })) return
    save.mutate({ kind: 'office', value: { ...office, archived: !office.archived } })
  }
  const rows = data.offices.filter(o => showArchive || !o.archived)
  return <section className="corporate-admin-workspace">
    <div className="corporate-admin-toolbar"><h2>Офисы</h2><button type="button" className={selected ? 'secondary' : 'primary'} onClick={() => select({ id: crypto.randomUUID(), city: '', name: '', address: '', archived: false, version: 0 })}>Добавить офис</button></div>
    <label className="corporate-admin-checkbox"><input type="checkbox" checked={showArchive} onChange={e => setShowArchive(e.target.checked)} />Показывать архивные</label>
    {selected && <OfficeForm key={selected.id} office={selected} onClose={() => select(null)} />}
    <SaveStatus status={save.isPending ? 'saving' : save.isError ? 'error' : save.isSuccess ? 'saved' : 'idle'} error={save.error?.message} />
    {!rows.length ? <EmptyState title="Офисов пока нет" description="Добавьте офис, чтобы привязать к нему тренеров." /> : <ul className="corporate-admin-list">
      {rows.map(o => <li key={o.id}><div><strong>{o.name}</strong><p>{o.city} · {o.address}{o.archived ? ' · Архив' : ''}</p></div>
        <div className="actions"><button type="button" className="secondary" onClick={() => select(o)} disabled={save.isPending} aria-label={`Изменить офис ${o.name}`}>Изменить</button>
          <button type="button" className="secondary" onClick={() => void archive(o)} disabled={save.isPending} aria-label={`${o.archived ? 'Восстановить' : 'Архивировать'} офис ${o.name}`}>{o.archived ? 'Восстановить' : 'В архив'}</button></div>
      </li>)}
    </ul>}
    {confirmation}
  </section>
}

function OfficeForm({ office, onClose }: { office: CorporateOffice; onClose: () => void }) {
  const form = useForm({ defaultValues: office })
  const save = useSave()
  return <form className="corporate-admin-editor" aria-label="Данные офиса" onSubmit={form.handleSubmit(async value => {
    try { await save.mutateAsync({ kind: 'office', value }); onClose() } catch { /* The mutation renders its error and retains the form. */ }
  })}>
    <h3>{office.version ? 'Изменить офис' : 'Новый офис'}</h3>
    <fieldset disabled={save.isPending}>
      <Field label="Город" error={form.formState.errors.city?.message}><input autoFocus {...form.register('city', { required: 'Укажите город', maxLength: { value: 100, message: 'Не более 100 символов' }, validate: v => Boolean(v.trim()) || 'Укажите город' })} maxLength={100} /></Field>
      <Field label="Название офиса" error={form.formState.errors.name?.message}><input {...form.register('name', { required: 'Укажите название', validate: v => Boolean(v.trim()) || 'Укажите название' })} maxLength={160} /></Field>
      <Field label="Адрес" error={form.formState.errors.address?.message}><input {...form.register('address', { required: 'Укажите адрес', validate: v => Boolean(v.trim()) || 'Укажите адрес' })} maxLength={300} /></Field>
      <div className="actions"><button type="submit" className="primary" aria-busy={save.isPending}>{save.isPending ? 'Сохраняем…' : 'Сохранить офис'}</button><button type="button" className="secondary" onClick={onClose}>Отмена</button></div>
    </fieldset>
    <SaveStatus status={save.isPending ? 'saving' : save.isError ? 'error' : 'idle'} error={save.error?.message} />
  </form>
}

function Trainers({ data }: { data: CorporateAdminBundle }) {
  const [search, setSearch] = useState('')
  const [onlyYandex, setOnlyYandex] = useState(false)
  const [officeId, setOfficeId] = useState('')
  const [selected, setSelected] = useState<CorporateTrainer | null>(null)
  const rows = data.trainers.filter(t => matchesAdminTrainer(t, search) && (!onlyYandex || t.isYandex) && (!officeId || t.officeIds.includes(officeId)))
  return <section className="corporate-admin-workspace">
    <h2>Тренеры</h2>
    <div className="corporate-admin-filters">
      <Field label="Поиск тренера"><input type="search" placeholder="Имя или ссылка на анкету" value={search} onChange={e => setSearch(e.target.value)} /></Field>
      <Field label="Офис"><select value={officeId} onChange={e => setOfficeId(e.target.value)}><option value="">Все офисы</option>{data.offices.map(o => <option key={o.id} value={o.id}>{o.city} · {o.name}{o.archived ? ' · Архив' : ''}</option>)}</select></Field>
      <label className="corporate-admin-checkbox"><input type="checkbox" checked={onlyYandex} onChange={e => setOnlyYandex(e.target.checked)} />Только тренеры Яндекса</label>
    </div>
    {selected && <TrainerForm key={selected.id} trainer={selected} offices={data.offices} onClose={() => setSelected(null)} />}
    {!rows.length ? <EmptyState title="Тренеры не найдены" description={data.trainers.length ? 'Измените поиск или фильтры.' : 'Здесь появятся зарегистрированные в ФИТ тренеры.'} /> : <ul className="corporate-admin-list">
      {rows.map(t => <li key={t.id}><div className="corporate-admin-person"><AdminTrainerPhoto key={t.photoUrl ?? t.id} trainer={t} /><div><strong>{t.name}</strong>
        {t.publishedName && t.publishedName !== t.name && <p>В анкете: {t.publishedName}</p>}
        <p>{t.isYandex ? 'Тренер Яндекса' : 'Без отметки'} · {t.officeIds.map(id => data.offices.find(o => o.id === id)).filter(o => o !== undefined).map(o => `${o.city}, ${o.name}${o.archived ? ' (архив)' : ''}`).join('; ') || 'Офисы не назначены'}</p>
        {t.publicId ? <Link to={`/trainers/${t.publicId}`} target="_blank" rel="noopener noreferrer">Открыть анкету</Link> : t.publicId === null ? <p>Анкета не опубликована</p> : null}</div></div>
        <button type="button" className="secondary" aria-label={`Настроить тренера ${t.name}`} onClick={() => setSelected(t)}>Настроить</button></li>)}
    </ul>}
  </section>
}

function AdminTrainerPhoto({ trainer }: { trainer: CorporateTrainer }) {
  const [failed, setFailed] = useState(false)
  const initials = (trainer.publishedName || trainer.name).split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase()
  return <div className="corporate-admin-photo-wrap">
    {trainer.photoUrl && !failed ? <img className="corporate-admin-photo" src={trainer.photoUrl} alt={`Фото тренера ${trainer.name}`} onError={() => setFailed(true)} />
      : <span className="corporate-admin-photo" aria-hidden="true">{initials}</span>}
    {(failed || trainer.photoUnavailable) && <small role="status">Фото недоступно</small>}
  </div>
}

function TrainerForm({ trainer, offices, onClose }: { trainer: CorporateTrainer; offices: CorporateOffice[]; onClose: () => void }) {
  const form = useForm({ defaultValues: { ...trainer, officeIds: trainer.officeIds.filter(id => offices.some(o => o.id === id && !o.archived)) } })
  const save = useSave()
  const enabled = useWatch({ control: form.control, name: 'isYandex' })
  return <form className="corporate-admin-editor" aria-label={`Настройки ${trainer.name}`} onSubmit={form.handleSubmit(async value => {
    if (value.isYandex && !value.officeIds.length) { form.setError('officeIds', { message: 'Выберите хотя бы один офис' }); return }
    try { await save.mutateAsync({ kind: 'trainer', value }); onClose() } catch { /* Retain unsaved edits; show server error below. */ }
  })}>
    <h3>{trainer.name}</h3>
    <fieldset disabled={save.isPending}>
      <label className="corporate-admin-checkbox"><input type="checkbox" {...form.register('isYandex')} />Тренер Яндекса</label>
      <fieldset className="corporate-admin-office-options"><legend>Офисы тренера{enabled ? ' · выберите хотя бы один' : ''}</legend>
        {offices.filter(o => !o.archived).map(o => <label className="corporate-admin-checkbox" key={o.id}><input type="checkbox" value={o.id} {...form.register('officeIds')} />{o.city} · {o.name}</label>)}
        {!offices.some(o => !o.archived) && <p>Сначала добавьте активный офис в разделе «Офисы».</p>}
      </fieldset>
      {form.formState.errors.officeIds?.message && <p className="error" role="alert">{form.formState.errors.officeIds.message}</p>}
      <div className="actions"><button type="submit" className="primary" aria-busy={save.isPending}>{save.isPending ? 'Сохраняем…' : 'Сохранить тренера'}</button><button type="button" className="secondary" onClick={onClose}>Отмена</button></div>
    </fieldset>
    <SaveStatus status={save.isPending ? 'saving' : save.isError ? 'error' : 'idle'} error={save.error?.message} />
  </form>
}
