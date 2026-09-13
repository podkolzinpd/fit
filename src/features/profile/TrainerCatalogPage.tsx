import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState, type Dispatch, type FormEvent, type RefObject, type SetStateAction } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { useDataBackend } from '../../app/data-backend-context'
import type { TrainerCatalogFilters, TrainerProfessionalProfile } from '../../shared/domain'
import { CloseIcon } from '../../shared/icons'
import { AsyncView, Field, Page } from '../../shared/ui'

const emptyFilters: TrainerCatalogFilters = {
  query: '',
  specialty: '',
  city: '',
  mode: '',
  acceptingClients: null,
}

const catalogViewKey = 'fit.trainer-catalog.view.v1'

interface CatalogViewState {
  draft: TrainerCatalogFilters
  filters: TrainerCatalogFilters
  scrollTop: number
}

function readCatalogView(): CatalogViewState | null {
  try {
    const raw = window.sessionStorage.getItem(catalogViewKey)
    if (!raw) return null
    const value = JSON.parse(raw) as Partial<CatalogViewState>
    if (!value.draft || !value.filters || typeof value.scrollTop !== 'number') return null
    return value as CatalogViewState
  } catch {
    return null
  }
}

function writeCatalogView(state: CatalogViewState) {
  try {
    window.sessionStorage.setItem(catalogViewKey, JSON.stringify(state))
  } catch {
    // Catalog navigation still works when browser storage is unavailable.
  }
}

function normalized(filters: TrainerCatalogFilters): TrainerCatalogFilters {
  return {
    ...filters,
    query: filters.query.trim(),
    specialty: filters.specialty.trim(),
    city: filters.city.trim(),
  }
}

function yearsLabel(value: number): string {
  if (value === 0) return 'меньше года'
  const word = value % 10 === 1 && value % 100 !== 11 ? 'год'
    : value % 10 >= 2 && value % 10 <= 4 && (value % 100 < 10 || value % 100 >= 20) ? 'года' : 'лет'
  return `${value} ${word}`
}

function CatalogCard({ profile, onOpen }: { profile: TrainerProfessionalProfile; onOpen: () => void }) {
  const published = profile.published
  if (!published) return null
  const currentYear = new Date().getFullYear()
  const experience = published.experienceStartYear === null
    ? null
    : Math.max(0, currentYear - published.experienceStartYear)
  return <article className="trainer-catalog-card card">
    <div className="trainer-catalog-card-head">
      {published.avatarDataUrl
        ? <img src={published.avatarDataUrl} alt="" className="trainer-card-avatar" />
        : <span className="trainer-card-avatar trainer-card-avatar-placeholder" aria-hidden="true">{published.displayName.slice(0, 1).toUpperCase()}</span>}
      <div><h2>{published.displayName}</h2><p>{published.acceptingClients ? 'Берёт новых клиентов' : 'Сейчас без новых клиентов'}</p></div>
    </div>
    {published.specialties.length > 0 && <ul className="trainer-specialties" aria-label="Направления">
      {published.specialties.slice(0, 4).map((item) => <li key={item}>{item}</li>)}
    </ul>}
    {(published.city || published.trainingModes.length > 0 || experience !== null) && <p className="trainer-catalog-facts">
      {[published.trainingModes.map((mode) => mode === 'online' ? 'Онлайн' : 'Лично').join(' · '), published.city,
        experience === null ? '' : `Опыт ${yearsLabel(experience)}`].filter(Boolean).join(' · ')}
    </p>}
    {published.bio && <p className="trainer-catalog-bio">{published.bio}</p>}
    <Link className="button secondary" to={`/trainers/${profile.publicId}`} state={{ from: '/me/trainers' }} onClick={onOpen}>Посмотреть анкету</Link>
  </article>
}

function CatalogFiltersSheet({ draft, setDraft, onApply, onReset, onClose, returnFocus }: {
  draft: TrainerCatalogFilters
  setDraft: Dispatch<SetStateAction<TrainerCatalogFilters>>
  onApply: () => void
  onReset: () => void
  onClose: () => void
  returnFocus: RefObject<HTMLButtonElement | null>
}) {
  const dialog = useRef<HTMLElement>(null)
  const closeRef = useRef(onClose)
  useEffect(() => { closeRef.current = onClose }, [onClose])
  useEffect(() => {
    const section = dialog.current
    section?.querySelector<HTMLElement>('input, select, button')?.focus()
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeRef.current()
      if (event.key !== 'Tab' || !section) return
      const controls = Array.from(section.querySelectorAll<HTMLElement>('input:not(:disabled), select:not(:disabled), button:not(:disabled)'))
      const first = controls[0]
      const last = controls.at(-1)
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    document.addEventListener('keydown', keydown)
    return () => {
      document.removeEventListener('keydown', keydown)
      returnFocus.current?.focus({ preventScroll: true })
    }
  }, [returnFocus])

  const host = document.querySelector('.phone-frame') ?? document.body
  return createPortal(<div className="sheet-overlay trainer-catalog-filter-overlay" onPointerDown={(event) => {
    if (event.target === event.currentTarget) onClose()
  }}>
    <section ref={dialog} className="trainer-catalog-filter-sheet" role="dialog" aria-modal="true" aria-label="Фильтры тренеров">
      <header className="picker-header"><h2>Фильтры</h2><button type="button" className="picker-close" aria-label="Закрыть фильтры" onClick={onClose}><CloseIcon /></button></header>
      <div className="trainer-catalog-filters">
        <Field label="Направление"><input value={draft.specialty} maxLength={60} placeholder="Силовые, бег" onChange={(event) => setDraft((value) => ({ ...value, specialty: event.target.value }))} /></Field>
        <Field label="Город"><input value={draft.city} maxLength={100} onChange={(event) => setDraft((value) => ({ ...value, city: event.target.value }))} /></Field>
        <Field label="Формат"><select value={draft.mode} onChange={(event) => setDraft((value) => ({ ...value, mode: event.target.value as TrainerCatalogFilters['mode'] }))}>
          <option value="">Любой</option><option value="online">Онлайн</option><option value="in_person">Лично</option>
        </select></Field>
        <Field label="Новые клиенты"><select value={draft.acceptingClients === null ? '' : String(draft.acceptingClients)} onChange={(event) => setDraft((value) => ({ ...value, acceptingClients: event.target.value === '' ? null : event.target.value === 'true' }))}>
          <option value="">Неважно</option><option value="true">Берёт клиентов</option><option value="false">Сейчас не берёт</option>
        </select></Field>
      </div>
      <div className="trainer-catalog-filter-actions">
        <button type="button" className="secondary" onClick={onReset}>Сбросить</button>
        <button type="button" className="primary" onClick={onApply}>Показать тренеров</button>
      </div>
    </section>
  </div>, host)
}

export function TrainerCatalogPage() {
  const { trainerProfiles } = useDataBackend()
  const [savedView] = useState(readCatalogView)
  const [draft, setDraft] = useState<TrainerCatalogFilters>(() => savedView?.draft ?? emptyFilters)
  const [filters, setFilters] = useState<TrainerCatalogFilters>(() => savedView?.filters ?? emptyFilters)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const filterButton = useRef<HTMLButtonElement>(null)
  const pendingScroll = useRef(savedView?.scrollTop ?? null)
  const catalog = useQuery({
    queryKey: ['trainer-catalog', filters],
    queryFn: () => trainerProfiles.listCatalog(filters),
  })

  useEffect(() => {
    if (!catalog.isSuccess || pendingScroll.current === null) return
    const scrollTop = pendingScroll.current
    pendingScroll.current = null
    let secondFrame = 0
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        document.querySelector<HTMLElement>('.content')?.scrollTo({ top: scrollTop })
      })
    })
    return () => {
      window.cancelAnimationFrame(firstFrame)
      window.cancelAnimationFrame(secondFrame)
    }
  }, [catalog.isSuccess])

  function apply(next: TrainerCatalogFilters) {
    const value = normalized(next)
    setDraft(value)
    setFilters(value)
    document.querySelector<HTMLElement>('.content')?.scrollTo({ top: 0 })
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    apply(draft)
  }

  function reset() {
    apply(emptyFilters)
    setFiltersOpen(false)
    writeCatalogView({ draft: emptyFilters, filters: emptyFilters, scrollTop: 0 })
  }

  function clearQuery() {
    apply({ ...draft, query: '' })
  }

  function rememberView() {
    writeCatalogView({
      draft,
      filters,
      scrollTop: document.querySelector<HTMLElement>('.content')?.scrollTop ?? 0,
    })
  }

  const appliedExtraFilters = [filters.specialty, filters.city, filters.mode,
    filters.acceptingClients === null ? '' : String(filters.acceptingClients)].filter(Boolean).length

  return <Page title="Тренеры" back="/me/profile" center className="trainer-catalog-page ui-identity">
    <p className="trainer-catalog-intro">Найдите своего тренера.</p>
    <form className="trainer-catalog-search card" role="search" onSubmit={submit}>
      <Field label="Имя тренера"><span className="trainer-catalog-query"><input value={draft.query} maxLength={100} placeholder="Например, Анна" onChange={(event) => setDraft((value) => ({ ...value, query: event.target.value }))} />
        {draft.query && <button type="button" className="trainer-catalog-query-clear" aria-label="Очистить имя тренера" onClick={clearQuery}><CloseIcon /></button>}</span></Field>
      <div className="trainer-catalog-search-actions">
        <button type="submit" className="primary">Найти</button>
        <button ref={filterButton} type="button" className="secondary" aria-expanded={filtersOpen} onClick={() => setFiltersOpen(true)}>
          {appliedExtraFilters > 0 ? `Фильтры · ${appliedExtraFilters}` : 'Фильтры'}
        </button>
      </div>
    </form>
    {filtersOpen && <CatalogFiltersSheet draft={draft} setDraft={setDraft} returnFocus={filterButton}
      onClose={() => setFiltersOpen(false)} onReset={reset} onApply={() => { apply(draft); setFiltersOpen(false) }} />}
    <AsyncView loading={catalog.isLoading} error={catalog.error}
      empty={catalog.data?.length === 0} emptyTitle="Тренеры не найдены" emptyDescription="Измените поиск или сбросьте фильтры."
      emptyAction={<button type="button" className="secondary" onClick={reset}>Сбросить фильтры</button>}
      onRetry={() => void catalog.refetch()}>
      {catalog.data && catalog.data.length > 0 && <section className="trainer-catalog-results" aria-label="Найденные тренеры">
        <p className="muted">Найдено: {catalog.data.length}</p>
        {catalog.data.map((profile) => <CatalogCard key={profile.publicId} profile={profile} onOpen={rememberView} />)}
      </section>}
    </AsyncView>
  </Page>
}
