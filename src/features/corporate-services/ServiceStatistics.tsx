import { useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useAuth } from '../../app/auth-context'
import { corporateServicesRepository as repository, type ServiceRange } from '../../data/repositories/corporate-services.repository'
import { AsyncView, Field } from '../../shared/ui'
import { ServicePeriod, ServiceQuickPeriods } from './ServicePeriod'
import { serviceKinds, servicePeriod } from './service-time'
import { addDays, formatLocalDateShort, localDate } from '../../shared/local-date'
import { rangeSearch } from './service-navigation'
import './services.css'

const labels = { tour: 'Экскурсии', consultation: 'Консультации', instruction: 'Инструктажи', intro: 'Вводные тренировки' }
export function CorporateServiceStatistics() {
  const { actor } = useAuth()
  const [{ range, revision }, setPeriod] = useState(() => ({ range: servicePeriod(actor!.timezone, 'month'), revision: 0 }))
  const applyRange = (range: ServiceRange) => setPeriod(previous => ({ range, revision: previous.revision + 1 }))
  const [trainer, setTrainer] = useState(''), [office, setOffice] = useState('')
  const query = useQuery({ queryKey: ['corporate-service-statistics', actor!.userId, range, trainer, office], queryFn: () => repository.statistics(range, trainer, office), retry: false, staleTime: 0, placeholderData: keepPreviousData })
  const zone = query.data?.timeZone ?? actor!.timezone
  return <section className="corporate-admin-workspace corporate-service-statistics ym-hide-content"><div className="corporate-service-heading"><h2>Статистика услуг</h2><button className="secondary" type="button" disabled={query.isFetching} onClick={() => void query.refetch()}>Обновить</button></div>
    <p className="corporate-service-note">Источник — записи тренеров об услугах сотрудникам Яндекса. Отменённые услуги исключены.</p>
    <ServiceQuickPeriods range={range} zone={zone} onChange={applyRange} />
    <p className="corporate-service-note" aria-label="Учтённый период">Период: {formatLocalDateShort(localDate(range.from))} — {formatLocalDateShort(addDays(localDate(range.until), -1))} · {zone}</p>
    {(trainer || office) && <p className="corporate-service-note" aria-label="Учтённые фильтры">{query.data?.trainers.find(value => value.id === trainer)?.name ?? (trainer ? 'Выбранный тренер' : 'Все тренеры')} · {query.data?.offices.find(value => value.id === office)?.name ?? (office ? 'Выбранный офис' : 'Все офисы')}</p>}
    <AsyncView loading={query.isPending || query.isPlaceholderData} error={query.error} onRetry={() => void query.refetch()}>{query.data && <dl className="corporate-service-counts">{serviceKinds.map(kind => <div key={kind}><dt>{labels[kind]}</dt><dd>{query.data.counts[kind].toLocaleString('ru-RU')}</dd></div>)}</dl>}</AsyncView>
    <details className="corporate-service-filters"><summary>Период и фильтры{trainer || office ? ' · выбраны' : ''}</summary>
      <ServicePeriod key={`${rangeSearch(range)}:${revision}`} range={range} zone={zone} onChange={applyRange} showQuick={false} />
    <div className="corporate-admin-filters"><Field label="Тренер"><select aria-label="Тренер" value={trainer} onChange={event => setTrainer(event.target.value)}><option value="">Все тренеры</option>{query.data?.trainers.map(value => <option key={value.id} value={value.id}>{value.name}{value.active ? '' : ' (история)'}</option>)}</select></Field><Field label="Офис"><select aria-label="Офис" value={office} onChange={event => setOffice(event.target.value)}><option value="">Все офисы</option>{query.data?.offices.map(value => <option key={value.id} value={value.id}>{value.city} · {value.name}{value.archived ? ' (архив)' : ''}</option>)}</select></Field></div>
    </details>
  </section>
}
