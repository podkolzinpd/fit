import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useAuth } from '../../app/auth-context'
import { useAppTheme } from '../../app/theme'
import { explorePrivateAnalytics } from '../../data/repositories/private-analytics.repository'
import { csv, display, features, initialFilters, labels, sections, shiftDay, type AnalyticsFilters, type AnalyticsRow } from './analytics-model'
import '../corporate-admin/corporate-admin.css'
import './private-analytics.css'

export function PrivateAnalyticsPage() {
  const { actor } = useAuth(), theme = useAppTheme()
  const [filters,setFilters]=useState(initialFilters)
  const [draft,setDraft]=useState(filters)
  const [history,setHistory]=useState<AnalyticsFilters[]>([])
  const [columns,setColumns]=useState<string[]>(sections[filters.section]!.columns)
  const [chartMetric,setChartMetric]=useState<'users'|'registrations'|'actions'>('users')
  const [exporting,setExporting]=useState(false),[exportError,setExportError]=useState('')
  const query=useQuery({queryKey:['private-analytics-explore',actor?.userId,filters],queryFn:()=>explorePrivateAnalytics(filters),enabled:Boolean(actor),retry:false,gcTime:0,staleTime:0})
  const data=query.error ? undefined : query.data
  const definition=sections[filters.section]!
  function apply(next:AnalyticsFilters,remember=false) {
    if(remember)setHistory(old=>[...old,filters])
    setFilters(next);setDraft(next);setExportError('')
    if(next.section!==filters.section)setColumns(sections[next.section]!.columns)
    // Only non-identifying filters belong in URLs: never names or identities.
    const params=new URLSearchParams({from:next.from,to:next.to,section:next.section,cohort:next.cohort,role:next.role,feature:next.feature,registration:next.registration,group:next.group})
    window.history.replaceState(null,'',`${window.location.pathname}?${params}`)
  }
  function navigate(section:string,extra:Partial<AnalyticsFilters>={},remember=false) {
    apply({...filters,section,sort:sections[section]!.sort,direction:'desc',page:1,search:'',status:'',entity:'',workout:'',...extra},remember)
  }
  function person(row:AnalyticsRow) {navigate('activities',{person:String(row.person_id),role:'',registration:''},true)}
  async function exportRows() {
    setExporting(true);setExportError('')
    try {
      const result:AnalyticsRow[]=[]
      let total=0,revision=''
      for(let page=1;;page++) {
        const batch=await explorePrivateAnalytics({...filters,page,pageSize:500})
        if(page===1){total=batch.total;revision=batch.revision}
        if(batch.total!==total||batch.revision!==revision)throw new Error('Данные изменились во время выгрузки. Обновите страницу и повторите экспорт.')
        result.push(...batch.rows)
        if(result.length>=total)break
        if(!batch.rows.length)throw new Error('Выгрузка прервалась. Повторите экспорт.')
      }
      if(new Set(result.map(r=>r.id)).size!==result.length)throw new Error('Данные изменились во время выгрузки. Повторите экспорт.')
      const url=URL.createObjectURL(new Blob([csv(result,columns)],{type:'text/csv;charset=utf-8'}))
      const link=document.createElement('a');link.href=url;link.download=`fit-${filters.section}-${filters.from}-${filters.to}.csv`;link.click();URL.revokeObjectURL(url)
    } catch(error) {setExportError(error instanceof Error?error.message:'Не удалось выгрузить данные.');void query.refetch()}
    finally {setExporting(false)}
  }
  const max=Math.max(1,...(data?.trend.map(t=>t[chartMetric])??[]))
  const extraColumns=data?.rows.flatMap(row=>Object.keys(row)).filter(key=>labels[key])??[]
  const availableColumns=[...new Set([...definition.columns,...extraColumns])]
  return <main className={`corporate-admin-shell private-analytics-shell fit-lime fit-lime-shell ui-identity ym-hide-content ${theme==='light'?'theme-light':''}`}><div className="page private-analytics">
    <header className="private-analytics-header"><div><h1>Аналитика Fit</h1><p>Люди, действия и результаты · время Москвы</p></div><button type="button" onClick={()=>void query.refetch()} disabled={query.isFetching}>Обновить</button></header>
    <form className="private-analytics-filters" onSubmit={event=>{event.preventDefault();apply({...draft,page:1})}}>
      <label>С даты<input type="date" required value={draft.from} max={draft.to} onChange={e=>setDraft({...draft,from:e.target.value})}/></label>
      <label>По дату<input type="date" required value={draft.to} min={draft.from} onChange={e=>setDraft({...draft,to:e.target.value})}/></label>
      <label>Роль<select value={draft.role} onChange={e=>setDraft({...draft,role:e.target.value})}><option value="">Все</option><option value="trainer">Тренеры</option><option value="client">Клиенты с аккаунтом</option><option value="offline">Карточки без входа</option></select></label>
      <label>Кого анализируем<select value={draft.cohort} onChange={e=>setDraft({...draft,cohort:e.target.value})}><option value="active">Совершавшие действия за период</option><option value="accounts">Все аккаунты · независимо от активности</option><option value="new">Зарегистрированные за период</option><option value="">Аккаунты и карточки без входа</option></select></label>
      <label>Регистрация<select value={draft.registration} onChange={e=>setDraft({...draft,registration:e.target.value})}><option value="">Все</option><option value="self">Самостоятельно</option><option value="connected">Подключённый аккаунт</option><option value="trainer">Тренеры / карточки тренера</option></select></label>
      <label>Функция<select value={draft.feature} onChange={e=>setDraft({...draft,feature:e.target.value})}><option value="">Все</option>{Object.entries(features).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
      <label>Группировка<select value={draft.group} onChange={e=>setDraft({...draft,group:e.target.value})}><option value="day">День</option><option value="week">Неделя</option><option value="month">Месяц</option></select></label>
      <label>Регулярность, дней из 7<select value={draft.regularDays} onChange={e=>setDraft({...draft,regularDays:Number(e.target.value)})}>{[1,2,3,4,5,6,7].map(n=><option key={n}>{n}</option>)}</select></label>
      <button type="submit" className="button primary" disabled={query.isFetching}>Применить</button>
      <button type="button" onClick={()=>{setHistory([]);apply(initialFilters(false))}}>Сбросить</button>
    </form>
    <nav aria-label="Разделы аналитики" className="private-analytics-tabs">{Object.entries(sections).filter(([key])=>!['exercise_detail','sets'].includes(key)).map(([key,value])=><button key={key} type="button" aria-current={filters.section===key?'page':undefined} onClick={()=>navigate(key)}>{value.label}</button>)}</nav>
    {history.length>0 && <button className="private-analytics-back" onClick={()=>{const previous=history.at(-1)!;setHistory(history.slice(0,-1));apply(previous)}}>Назад к предыдущему срезу</button>}
    {(filters.person||filters.trainer||filters.feature) && <p className="private-analytics-selection">Выбран срез: {filters.person?`человек ${data?.rows[0]?.person??filters.person}`:''} {filters.trainer?'клиенты выбранного тренера':''} {features[filters.feature]??''} <button onClick={()=>apply({...filters,person:'',trainer:'',feature:'',page:1})}>Убрать ограничение</button></p>}
    {query.isPending && <p role="status">Загружаем аналитику…</p>}
    {query.error && <p role="alert">{query.error.message}</p>}
    {data && <>
      <p className="private-analytics-freshness">Срез: {display(filters.from,'date')} — {display(filters.to,'date')}. Обновлено: {display(data.computedAt,'date')}. Группа людей применяется к сводке, графику и всем разделам. Поиск и страницы ограничивают только таблицу.</p>
      <aside className="private-analytics-panel" aria-label="Как читать выборку">
        <h2>Кого показываем</h2>
        <p>{filters.cohort==='active'?'Только аккаунты с собственными зафиксированными действиями за выбранные даты. Людей без таких действий в этой группе нет.':filters.cohort==='new'?'Аккаунты, зарегистрированные за выбранные даты. Среди них могут быть люди без действий.':filters.cohort==='accounts'?'Все аккаунты по выбранным условиям, включая людей без действий за период. Даты ограничивают действия, а не дату регистрации.':'Аккаунты и карточки клиентов без входа, включая людей без действий за период.'} {filters.feature?`Действия ограничены функцией «${features[filters.feature]??filters.feature}».`:''}</p>
        <p>Действие — например, изменение тренировки, запись питания или сообщение. Вход и просмотр экрана не считаются. Если тренер ведёт тренировку клиента, действие относится к тренеру.</p>
        <p>Учёт изменений начат {display(data.observationStartedAt,'date')}. До этой даты история неполная: отсутствие событий не доказывает, что человек не пользовался Fit.</p>
      </aside>
      <div className="private-analytics-cards">
        {([{key:'accounts',label:'Аккаунтов в выбранной группе',section:'people'},{key:'new',label:'Новых аккаунтов за период',section:'people'},{key:'active',label:'Совершали действия за период',section:'people'},{key:'workouts',label:'Проведённых тренировок',section:'workouts'},{key:'nutritionUsers',label:'Авторов дневника питания',section:'nutrition'},{key:'received',label:'Поступления тренеров, ₽',section:'payments'}]).map(card=><button key={card.key} onClick={()=>navigate(card.section,card.key==='accounts'?{cohort:filters.cohort}:card.key==='new'?{cohort:'new'}:card.key==='active'?{cohort:'active'}:card.key==='workouts'?{status:'done'}:{},true)}><span>{card.label}</span><strong>{display(data.summary[card.key],card.key)}</strong><small>{card.key==='accounts'?'Вся выбранная группа':card.key==='active'?'Хотя бы одно собственное действие за период':'За выбранный период'} · открыть список</small></button>)}
      </div>
      <p>Та же группа людей, предыдущий период той же длины: новых аккаунтов — {display(data.summary.previousNew)}, активных — {display(data.summary.previousActive)}, проведённых тренировок — {display(data.summary.previousWorkouts)}, поступления — {display(data.summary.previousReceived,'amount')} ₽.</p>
      <details className="private-analytics-definitions"><summary>Как считаются показатели и где неполная история</summary>
        <p>Новые — регистрации за период, независимо от активности. Активные — уникальные авторы подтверждённых действий, а не просто входов. Один человек может быть и новым, и активным. Карточки без входа ({display(data.summary.offline)}) не входят в число аккаунтов.</p>
        <p>На конец выбранного периода: за 1 день — {display(data.summary.active1)}, за 7 дней — {display(data.summary.active7)}, за 30 дней — {display(data.summary.active30)}. Регулярных за 7 дней — {display(data.summary.regular)}: минимум {filters.regularDays} разных активных дней. Это выбранный рабочий порог, не отраслевой бенчмарк; окна 7/30 дней могут выходить за начало выбранного периода.</p>
        <p>Полный учёт изменений поддерживаемых записей и успешных просмотров питания тренером начат {display(data.observationStartedAt,'date')}. Ранее доступны только сохранившиеся создания записей, запросы программ и сообщения. Это нижняя граница активности, не полная история посещений. Импортированные создания могут иметь историческую дату; для периода до начала наблюдения точное удержание не рассчитывается.</p>
        <p>Возврат за две последние недели: {['active','new'].includes(filters.cohort)?'для сравнения возвратов выберите «Все аккаунты», чтобы состав группы не зависел от действий в текущем периоде':data.retentionMeasured?(data.summary.retentionBase?`${data.summary.retained} из ${data.summary.retentionBase} активных в предыдущие 7 дней вернулись в последние 7 дней`:'В предыдущие 7 дней нет активных людей для сравнения'):'пока не измерен — нужны две полные недели наблюдения'}. Это возврат активных людей, не удержание когорты регистраций.</p>
        <p>Голосовой ввод, фактическое участие в видеозвонках, просмотры экранов и применение шаблонов пока не имеют подтверждённого отдельного измерения в этой аналитике. Отсутствие измерения не означает нулевое использование. Известные календарные тестовые данные исключены; полного реестра остальных тестовых аккаунтов нет.</p>
      </details>
      <section aria-label="Динамика" className="private-analytics-panel">
        <div className="private-analytics-header"><h2>Динамика</h2><label>Показатель<select value={chartMetric} onChange={e=>setChartMetric(e.target.value as typeof chartMetric)}><option value="users">Активные люди</option><option value="registrations">Регистрации аккаунтов</option><option value="actions">Действия</option></select></label></div>
        <p>Нажмите столбец, чтобы открыть этот период. Высота показывает количество от 0 до {display(max)}; точное число подписано.</p>
        <div className="private-analytics-chart" aria-label="График по периодам"><div className="private-analytics-chart-columns">{data.trend.map(bucket=><button key={bucket.date} aria-label={`${bucket.date}: ${bucket[chartMetric]}`} onClick={()=>{
          const end=filters.group==='week'?shiftDay(bucket.date,6):filters.group==='month'?shiftDay(new Date(Date.UTC(Number(bucket.date.slice(0,4)),Number(bucket.date.slice(5,7)),1)).toISOString().slice(0,10),-1):bucket.date
          navigate(chartMetric==='registrations'?'people':'activities',{cohort:chartMetric==='registrations'?'new':'',from:bucket.date<filters.from?filters.from:bucket.date,to:end>filters.to?filters.to:end},true)
        }}><strong>{display(bucket[chartMetric])}</strong><span className="private-analytics-chart-track"><span style={{height:`${bucket[chartMetric]/max*100}%`}}/></span><span>{display(bucket.date,'date')}</span></button>)}</div></div>
      </section>
      {['nutrition','payments','packages','features'].includes(filters.section) && <aside className="private-analytics-context">
        {filters.section==='nutrition'?<p>Дней ведения дневника (сумма по людям): <strong>{display(data.summary.nutritionDays)}</strong>. Тренеров с подтверждёнными просмотрами за период: <strong>{display(data.summary.nutritionViews)}</strong> <button onClick={()=>navigate('activities',{feature:'nutrition_views',role:'trainer'},true)}>Показать просмотры</button></p>:['payments','packages'].includes(filters.section)?<p>Поступления за период: <strong>{display(data.summary.received,'amount')} ₽</strong>. Входящие остатки отдельно: {display(data.summary.opening,'amount')} ₽. Долг сейчас: <strong>{display(data.summary.due,'amount')} ₽</strong>, из него просрочено: {display(data.summary.overdue,'amount')} ₽. Долг — текущий снимок, не значение на выбранную историческую дату.</p>:<p>Нулевые и неизмеряемые функции не смешиваются: <strong>не измеряются отдельно</strong> голосовой ввод, участие в видеозвонках и применение шаблонов. Доступность функции конкретному человеку не означает её использование.</p>}
      </aside>}
      <section aria-label={definition.label} className="private-analytics-panel">
        <h2>{definition.label}</h2><p>{definition.description}</p>

        {filters.section==='workouts' && <label>Статус тренировки<select value={filters.status} onChange={e=>apply({...filters,status:e.target.value,page:1})}><option value="">Все</option>{['planned','in_progress','done','cancelled'].map(value=><option key={value} value={value}>{display(value,'status')}</option>)}</select></label>}
        <div className="private-analytics-table-tools">
          <form onSubmit={e=>{e.preventDefault();apply({...filters,search:draft.search,page:1})}}><label>Поиск в таблице<input type="search" maxLength={120} value={draft.search} onChange={e=>setDraft({...draft,search:e.target.value})}/></label><button>Найти</button></form>
          <details><summary>Столбцы</summary><div className="private-analytics-column-picker">{availableColumns.map(key=><label key={key}><input type="checkbox" checked={columns.includes(key)} disabled={columns.length===1&&columns.includes(key)} onChange={e=>setColumns(e.target.checked?[...columns,key]:columns.filter(c=>c!==key))}/>{labels[key]??key}</label>)}</div></details>
          <button disabled={exporting||query.isFetching||data.total===0} onClick={()=>void exportRows()}>{exporting?'Выгружаем…':'Скачать CSV'}</button>
        </div>
        {exportError && <p role="alert">{exportError}</p>}
        <p role="status">Найдено записей: {data.total}. {query.isFetching?'Обновляем…':''}</p>
        {data.rows.length===0?<p>По выбранным условиям записей нет. Измените фильтры или период.</p>:<div className="private-analytics-table"><table><caption className="sr-only">{definition.label}</caption><thead><tr>{columns.map(key=><th key={key} scope="col" aria-sort={filters.sort===key?(filters.direction==='asc'?'ascending':'descending'):'none'}><button onClick={()=>apply({...filters,sort:key,direction:filters.sort===key&&filters.direction==='desc'?'asc':'desc',page:1})}>{labels[key]??key}{filters.sort===key?(filters.direction==='asc'?' ↑':' ↓'):''}</button></th>)}</tr></thead><tbody>{data.rows.map(row=><tr key={String(row.id)}>{columns.map(key=><td key={key}>{key==='person'&&row.person_id?<><button className="private-analytics-link" onClick={()=>person(row)}>{display(row[key],key)}</button>{row.role==='trainer'&&filters.section==='people'&&<button className="private-analytics-link" onClick={()=>navigate('people',{trainer:String(row.person_id),person:'',role:'client',registration:''},true)}>Клиенты с аккаунтом</button>}</>:key==='name'&&filters.section==='exercises'?<button className="private-analytics-link" onClick={()=>navigate('exercise_detail',{exercise:String(row.exercise_key)},true)}>{display(row[key],key)}</button>:key==='name'&&filters.section==='features'?<button className="private-analytics-link" onClick={()=>navigate('activities',{feature:String(row.feature)},true)}>{display(row[key],key)}</button>:key==='package_id'&&row.package_id?<button className="private-analytics-link" onClick={()=>navigate('packages',{entity:String(row.package_id)},true)}>{display(row[key],key)}</button>:(key==='workout_id'||key==='id'&&filters.section==='workouts')?<button className="private-analytics-link" onClick={()=>navigate('sets',{workout:String(row[key])},true)}>{display(row[key],key)}</button>:key==='source_id'&&['workouts','nutrition'].includes(String(row.feature))?<button className="private-analytics-link" onClick={()=>navigate(String(row.feature),{entity:String(row.source_id),feature:''},true)}>{display(row[key],key)}</button>:display(row[key],key)}</td>)}</tr>)}</tbody></table></div>}
        <div className="private-analytics-pagination"><button disabled={filters.page<=1||query.isFetching} onClick={()=>apply({...filters,page:filters.page-1})}>Назад</button><span>Страница {filters.page} из {Math.max(1,Math.ceil(data.total/filters.pageSize))}</span><button disabled={filters.page*filters.pageSize>=data.total||query.isFetching} onClick={()=>apply({...filters,page:filters.page+1})}>Далее</button><label>Строк<select value={filters.pageSize} onChange={e=>apply({...filters,pageSize:Number(e.target.value),page:1})}>{[25,50,100].map(n=><option key={n}>{n}</option>)}</select></label></div>
      </section>
    </>}
  </div></main>
}
