import { useState, type ReactNode } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { useAuth } from '../../app/auth-context'
import { corporatePersonalRepository as repository, type PersonalCursor } from '../../data/repositories/corporate-personal.repository'
import { ServicePeriod, ServiceQuickPeriods } from '../corporate-services/ServicePeriod'
import { servicePeriod } from '../corporate-services/service-time'
import type { ServiceRange } from '../../data/repositories/corporate-services.repository'
import { AsyncView, EmptyState, Field } from '../../shared/ui'
import { addDays, formatLocalDateShort, localDate } from '../../shared/local-date'
import './personal.css'

export function CorporatePersonalStatistics({ switchView }: {switchView?:ReactNode} = {}) {
  const { actor } = useAuth(), zone = actor!.timezone
  const [{range,revision},setPeriod] = useState(()=>({range:servicePeriod(zone,'month'),revision:0}))
  const [selectedTrainer,setTrainer] = useState({id:'',name:''})
  const trainer = selectedTrainer.id
  const query = useInfiniteQuery({queryKey:['corporate-personal-statistics',actor!.userId,range,trainer],
    initialPageParam:undefined as PersonalCursor|undefined,
    queryFn:({pageParam})=>repository.statistics(range,trainer,pageParam),getNextPageParam:last=>last.nextCursor??undefined,
    retry:false,staleTime:0})
  const first = query.data?.pages[0]
  const apply = (range:ServiceRange)=>{
    const current = first?.trainers.find(value=>value.id===trainer)
    if (current) setTrainer({id:trainer,name:current.name})
    setPeriod(previous=>({range,revision:previous.revision+1}))
  }
  const seen = new Set<string>()
  const rows = (query.data?.pages.flatMap(page=>page.records) ?? []).filter(row=>{
    if (seen.has(row.id)) return false
    seen.add(row.id); return true
  })
  return <section className="corporate-admin-workspace corporate-personal-statistics ym-hide-content">
    <div className="corporate-service-heading"><h2>Персональные тренировки</h2><div className="corporate-statistics-actions">{switchView}<button className="secondary" type="button" disabled={query.isFetching} onClick={()=>void query.refetch()}>Обновить</button></div></div>
    <p className="corporate-personal-note">Проведённые занятия с тренером для клиентов, отмеченных сотрудниками Яндекса. Самостоятельные исключены. Без разбивки по офисам.</p>
    <ServiceQuickPeriods range={range} zone={zone} onChange={apply}/>
    <p className="corporate-personal-note" aria-label="Учтённый период">Период: {formatLocalDateShort(localDate(range.from))} — {formatLocalDateShort(addDays(localDate(range.until),-1))}</p>
    <details className="corporate-service-filters"><summary>Период и тренер{trainer ? ' · выбран' : ''}</summary>
      <ServicePeriod key={`${range.from}:${range.until}:${revision}`} range={range} zone={zone} onChange={apply} showQuick={false}/>
      <Field label="Тренер"><select aria-label="Тренер персональных тренировок" value={trainer} onChange={event=>setTrainer({id:event.target.value,name:event.target.selectedOptions[0]?.textContent??''})}><option value="">Все тренеры</option>{trainer && !first?.trainers.some(value=>value.id===trainer) && <option value={trainer}>{selectedTrainer.name}</option>}{first?.trainers.filter(t=>t.id!==null).map(t=><option key={t.id} value={t.id!}>{t.name}</option>)}</select></Field>
    </details>
    <AsyncView loading={query.isPending} error={query.error && !query.isFetchNextPageError ? query.error : null} onRetry={()=>void query.refetch()}>
      {first && <>
        <p className="corporate-personal-total" aria-label="Проведено персональных тренировок"><strong>{first.count.toLocaleString('ru-RU')}</strong><span>Проведено за выбранный период</span></p>
        {!rows.length ? <EmptyState title="За этот период тренировок нет" description="Здесь появятся проведённые занятия после установки отметки в карточке клиента."/> : <>
          <ul className="corporate-admin-list" aria-label="Учтённые персональные тренировки">{rows.map(row=><li key={row.id}><div><strong>{formatLocalDateShort(localDate(row.date))}</strong><p>{row.trainerName}</p></div><span>Проведена</span></li>)}</ul>
          {query.hasNextPage && <button className="secondary" type="button" disabled={query.isFetchingNextPage} onClick={()=>void query.fetchNextPage()}>{query.isFetchingNextPage ? 'Загружаем…' : query.isFetchNextPageError ? 'Повторить загрузку' : 'Показать ещё'}</button>}
          {query.isFetchNextPageError && <p className="error" role="alert">Не удалось загрузить продолжение. Уже загруженные записи сохранены.</p>}
        </>}
      </>}
    </AsyncView>
  </section>
}
