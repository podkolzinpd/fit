import { useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useAuth } from '../../app/auth-context'
import { corporateServicesRepository as repository } from '../../data/repositories/corporate-services.repository'
import { AsyncView, Field } from '../../shared/ui'
import { ServicePeriod } from './ServicePeriod'
import { serviceKinds, servicePeriod } from './service-time'
import './services.css'

const labels = { tour: 'Экскурсии', consultation: 'Консультации', instruction: 'Инструктажи', intro: 'Вводные тренировки' }
export function CorporateServiceStatistics() {
  const { actor } = useAuth()
  const [range, setRange] = useState(() => servicePeriod(actor!.timezone, 'month'))
  const [trainer, setTrainer] = useState(''), [office, setOffice] = useState('')
  const query = useQuery({ queryKey: ['corporate-service-statistics', actor!.userId, range, trainer, office], queryFn: () => repository.statistics(range, trainer, office), retry: false, staleTime: 0, placeholderData: keepPreviousData })
  const zone = query.data?.timeZone ?? actor!.timezone
  return <section className="corporate-admin-workspace corporate-service-statistics ym-hide-content"><div className="corporate-service-heading"><h2>Статистика услуг</h2><button className="secondary" type="button" disabled={query.isFetching} onClick={() => void query.refetch()}>Обновить</button></div>
    <p className="corporate-service-note">Источник — записи тренеров об услугах сотрудникам Яндекса. Отменённые услуги исключены.</p>
    <ServicePeriod range={range} zone={zone} onChange={setRange} />
    <div className="corporate-admin-filters"><Field label="Тренер"><select aria-label="Тренер" value={trainer} onChange={event => setTrainer(event.target.value)}><option value="">Все тренеры</option>{query.data?.trainers.map(value => <option key={value.id} value={value.id}>{value.name}{value.active ? '' : ' (история)'}</option>)}</select></Field><Field label="Офис"><select aria-label="Офис" value={office} onChange={event => setOffice(event.target.value)}><option value="">Все офисы</option>{query.data?.offices.map(value => <option key={value.id} value={value.id}>{value.city} · {value.name}{value.archived ? ' (архив)' : ''}</option>)}</select></Field></div>
    <p className="corporate-service-note">Время аккаунта: {zone}</p>
    <AsyncView loading={query.isPending || query.isPlaceholderData} error={query.error} onRetry={() => void query.refetch()}>{query.data && <dl className="corporate-service-counts">{serviceKinds.map(kind => <div key={kind}><dt>{labels[kind]}</dt><dd>{query.data.counts[kind].toLocaleString('ru-RU')}</dd></div>)}</dl>}</AsyncView>
  </section>
}
