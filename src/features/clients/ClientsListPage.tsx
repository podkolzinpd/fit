import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { clientsRepository } from '../../data/repositories/clients.repository'
import { bmiLabel } from '../../data/repositories/workouts.repository'
import { AsyncView, Page } from '../../shared/ui'
import { ChevronRightIcon, CloseIcon, ProfileIcon, SearchIcon } from '../../shared/icons'
import { useAuth } from '../../app/auth-context'
import { isDarkThemePilotEnabled, isMonochromeUiEnabled } from '../../app/feature-flags'

// Порог, с которого список перестаёт охватываться взглядом и поиск начинает
// экономить время. Ниже него поле только занимало верх экрана: у тренера с
// тремя-четырьмя спортсменами искать нечего.
const CLIENTS_SEARCH_MIN = 6

export function ClientsPage() {
  const { actor } = useAuth()
  // В новой identity поиск появляется только когда он действительно экономит
  // время. Rollout=preview сохраняет прежний server-managed pilot, а старый
  // dark-pilot остаётся совместим до отдельного cleanup.
  const searchPilot = Boolean(isMonochromeUiEnabled(actor?.featureFlags?.monochromePreview) || (actor && isDarkThemePilotEnabled(actor.userId)))
  const showArchived = window.localStorage?.getItem('fit.showArchivedClients') === 'true'
  // Список — рабочая очередь тренера, поэтому при каждом входе показываем
  // актуальную активность, а не данные из короткого SPA-кэша.
  const query = useQuery({ queryKey: ['clients', showArchived], queryFn: () => clientsRepository.list(showArchived), refetchOnMount: 'always' })
  const [search, setSearch] = useState('')
  // Порог считаем по всему списку, а не по отфильтрованному: иначе поле
  // исчезало бы прямо во время ввода, как только совпадений станет мало.
  const showSearch = !searchPilot || (query.data?.length ?? 0) >= CLIENTS_SEARCH_MIN
  const clients = useMemo(() => {
    // Если список успел сократиться ниже порога, набранный ранее запрос не
    // должен продолжать скрывать карточки: поля для его сброса уже нет.
    const normalizedSearch = showSearch ? search.trim().toLocaleLowerCase('ru') : ''
    return query.data
      ?.filter((client) => !normalizedSearch || client.fullName.toLocaleLowerCase('ru').includes(normalizedSearch))
      .sort((left, right) => (right.lastActivityAt ?? '').localeCompare(left.lastActivityAt ?? '')) ?? []
  }, [query.data, search, showSearch])
  return <Page title="Клиенты" className="clients-page" action={query.data?.length ? <Link className="button" to="/clients/new">Добавить</Link> : undefined}>
    <AsyncView loading={query.isLoading} error={query.error} empty={!query.data?.length} onRetry={() => void query.refetch()}
      emptyTitle="Клиентов пока нет"
      emptyDescription="Добавьте первого клиента, чтобы планировать тренировки и отслеживать прогресс."
      emptyAction={<Link className="button" to="/clients/new">Добавить клиента</Link>}>
      {showSearch && (searchPilot
        ? <div className="clients-search-pilot">
          <SearchIcon aria-hidden="true" />
          <input type="search" aria-label="Поиск клиента" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Поиск по имени" autoComplete="off" />
          {search !== '' && <button type="button" className="clients-search-clear" aria-label="Очистить поиск" onClick={() => setSearch('')}><CloseIcon /></button>}
        </div>
        : <label className="clients-search"><span className="sr-only">Поиск клиента</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Поиск по имени" autoComplete="off" /></label>)}
      {clients.length > 0 ? <div className="cards clients-list">{clients.map((client) => <Link className="card client-card" key={client.id} to={`/clients/${client.id}`}><span className="client-avatar" aria-hidden="true"><ProfileIcon /></span><div><strong>{client.fullName}</strong><p>{client.ageYears && client.heightCm ? `${client.ageYears} лет · ${client.heightCm} см · ИМТ ${bmiLabel(client.heightCm, client.currentWeightKg)}` : 'Нужно дополнить профиль'}{client.currentWeightKg ? ` · ${client.currentWeightKg} кг` : ''}</p></div>{client.archivedAt && <span className="badge">Архив</span>}<span className="client-card-arrow" aria-hidden="true"><ChevronRightIcon /></span></Link>)}</div> : <p className="clients-search-empty">По этому имени клиентов не найдено.</p>}
    </AsyncView>
  </Page>
}
