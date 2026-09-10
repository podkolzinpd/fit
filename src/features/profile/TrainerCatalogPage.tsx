import { useQuery } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useDataBackend } from '../../app/data-backend-context'
import type { TrainerCatalogFilters, TrainerProfessionalProfile } from '../../shared/domain'
import { AsyncView, Field, Page } from '../../shared/ui'

const emptyFilters: TrainerCatalogFilters = {
  query: '',
  specialty: '',
  city: '',
  mode: '',
  acceptingClients: null,
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

function CatalogCard({ profile }: { profile: TrainerProfessionalProfile }) {
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
    <Link className="button secondary" to={`/trainers/${profile.publicId}`} state={{ from: '/me/trainers' }}>Посмотреть анкету</Link>
  </article>
}

export function TrainerCatalogPage() {
  const { trainerProfiles } = useDataBackend()
  const [draft, setDraft] = useState<TrainerCatalogFilters>(emptyFilters)
  const [filters, setFilters] = useState<TrainerCatalogFilters>(emptyFilters)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const catalog = useQuery({
    queryKey: ['trainer-catalog', filters],
    queryFn: () => trainerProfiles.listCatalog(filters),
  })

  function submit(event: FormEvent) {
    event.preventDefault()
    setFilters(normalized(draft))
  }

  function reset() {
    setDraft(emptyFilters)
    setFilters(emptyFilters)
  }

  const appliedExtraFilters = [filters.specialty, filters.city, filters.mode,
    filters.acceptingClients === null ? '' : String(filters.acceptingClients)].filter(Boolean).length

  return <Page title="Тренеры" back="/me/profile" className="trainer-catalog-page ui-identity">
    <p className="trainer-catalog-intro">Анкеты, опыт и формат занятий.</p>
    <form className="trainer-catalog-search card" onSubmit={submit}>
      <Field label="Имя тренера"><input value={draft.query} maxLength={100} placeholder="Например, Анна" onChange={(event) => setDraft((value) => ({ ...value, query: event.target.value }))} /></Field>
      <div className="trainer-catalog-search-actions">
        <button type="submit" className="primary">Найти</button>
        <button type="button" className="secondary" aria-expanded={filtersOpen} onClick={() => setFiltersOpen((value) => !value)}>
          {appliedExtraFilters > 0 ? `Фильтры · ${appliedExtraFilters}` : 'Фильтры'}
        </button>
      </div>
      {filtersOpen && <div className="trainer-catalog-filters">
        <Field label="Направление"><input value={draft.specialty} maxLength={60} placeholder="Силовые, бег" onChange={(event) => setDraft((value) => ({ ...value, specialty: event.target.value }))} /></Field>
        <Field label="Город"><input value={draft.city} maxLength={100} onChange={(event) => setDraft((value) => ({ ...value, city: event.target.value }))} /></Field>
        <Field label="Формат"><select value={draft.mode} onChange={(event) => setDraft((value) => ({ ...value, mode: event.target.value as TrainerCatalogFilters['mode'] }))}>
          <option value="">Любой</option><option value="online">Онлайн</option><option value="in_person">Лично</option>
        </select></Field>
        <Field label="Новые клиенты"><select value={draft.acceptingClients === null ? '' : String(draft.acceptingClients)} onChange={(event) => setDraft((value) => ({ ...value, acceptingClients: event.target.value === '' ? null : event.target.value === 'true' }))}>
          <option value="">Неважно</option><option value="true">Берёт клиентов</option><option value="false">Сейчас не берёт</option>
        </select></Field>
        <button type="button" className="link" onClick={reset}>Сбросить фильтры</button>
      </div>}
    </form>
    <AsyncView loading={catalog.isLoading} error={catalog.error}
      empty={catalog.data?.length === 0} emptyTitle="Тренеры не найдены" emptyDescription="Попробуйте изменить поиск или фильтры."
      onRetry={() => void catalog.refetch()}>
      {catalog.data && catalog.data.length > 0 && <section className="trainer-catalog-results" aria-label="Найденные тренеры">
        <p className="muted">Найдено: {catalog.data.length}</p>
        {catalog.data.map((profile) => <CatalogCard key={profile.publicId} profile={profile} />)}
      </section>}
    </AsyncView>
  </Page>
}
