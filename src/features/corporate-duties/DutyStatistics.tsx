import { FitLimeDatePicker } from '../../shared/FitLimeDatePicker'
import { formatLocalDateShort, localDate, todayInTimeZone } from '../../shared/local-date'
import { useLayoutEffect, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react'
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../../app/auth-context'
import { CorporateDutyError, corporateDutiesRepository as repository, type CorporateDuty, type DutyCommand, type DutyOffice } from '../../data/repositories/corporate-duties.repository'
import type { ServiceCursor } from '../../data/repositories/corporate-services.repository'
import { AsyncView, EmptyState, Field, useConfirm } from '../../shared/ui'
import { ServicePeriod, ServiceQuickPeriods } from '../corporate-services/ServicePeriod'
import { serviceInstant, servicePeriod } from '../corporate-services/service-time'
import { dutyDuration, dutyLocalInput, dutyMoment, dutyStatus } from './duty-time'
import './duties.css'
const auditAction:Record<string,string>={start:'Начато',stop:'Завершено',correct:'Исправлено',void:'Аннулировано',restore:'Восстановлено',confirm:'Подтверждена длительность'}
export function CorporateDutyStatistics({switchView}:{switchView?:ReactNode}){
 const {actor}=useAuth()
 const [range,setRange]=useState(()=>servicePeriod(actor!.timezone,'month'))
 const [trainer,setTrainer]=useState({id:'',name:''}),[office,setOffice]=useState({id:'',name:''})
 const [selected,setSelected]=useState<CorporateDuty|null>(null)
 const query=useInfiniteQuery({queryKey:['corporate-duty-statistics',actor!.userId,range,trainer.id,office.id],
  initialPageParam:undefined as ServiceCursor|undefined,queryFn:({pageParam})=>repository.list(range,true,trainer.id,office.id,pageParam),getNextPageParam:last=>last.nextCursor??undefined,retry:false,staleTime:0})
 const first=query.data?.pages[0]
 const rows=query.data?.pages.flatMap(p=>p.records).filter((r,i,all)=>all.findIndex(x=>x.id===r.id)===i)
 const trainerName=(id:string)=>first?.trainers.find(t=>t.id===id)?.name||(trainer.id===id?trainer.name:'Тренер недоступен')
 return <section className="corporate-admin-workspace corporate-duty-workspace corporate-duty-statistics ym-hide-content">
  <div className="corporate-service-heading"><h2>Дежурства</h2><div className="corporate-statistics-actions">{switchView}<button type="button" className="secondary" disabled={query.isFetching} onClick={()=>void query.refetch()}>Обновить</button></div></div>
  <p className="corporate-duty-note">Только завершённые проверенные смены. Открытые и требующие проверки показаны отдельно. Персональные тренировки из часов не вычитаются.</p>
  <ServiceQuickPeriods range={range} zone={actor!.timezone} onChange={setRange}/>
  <details className="corporate-service-filters"><summary>Период, тренер и офис{trainer.id||office.id?' · выбран фильтр':''}</summary>
   <ServicePeriod key={`${range.from}:${range.until}`} range={range} zone={actor!.timezone} onChange={setRange} showQuick={false}/>
   <div className="corporate-admin-filters"><Field label="Тренер"><select aria-label="Тренер дежурств" value={trainer.id} onChange={e=>setTrainer({id:e.target.value,name:e.target.selectedOptions[0]?.textContent??''})}><option value="">Все тренеры</option>{trainer.id&&!first?.trainers.some(t=>t.id===trainer.id)&&<option value={trainer.id}>{trainer.name}</option>}{first?.trainers.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></Field>
   <Field label="Офис"><select aria-label="Офис в отчёте дежурств" value={office.id} onChange={e=>setOffice({id:e.target.value,name:e.target.selectedOptions[0]?.textContent??''})}><option value="">Все офисы</option>{office.id&&!first?.offices.some(o=>o.id===office.id)&&<option value={office.id}>{office.name}</option>}{first?.offices.map(o=><option key={o.id} value={o.id}>{o.city} · {o.name}{o.archived?' (архив)':''}</option>)}</select></Field></div>
  </details>
  <AsyncView loading={query.isPending} error={query.error&&!query.isFetchNextPageError?query.error:null} onRetry={()=>void query.refetch()}>
   {first&&<>
    <dl className="corporate-duty-totals" aria-label="Итоги дежурств"><div><dt>Часы</dt><dd>{dutyDuration(first.seconds)}</dd></div><div><dt>{trainer.id?'Дни':'Дни тренеров'}</dt><dd>{first.days}</dd></div><div><dt>Завершённые смены</dt><dd>{first.completed}</dd></div></dl>
    <p role="status">Открытых: {first.open} · Требуют проверки: {first.review}</p>
    {!trainer.id&&first.byTrainer.length>0&&<ul className="corporate-admin-list" aria-label="Дежурства по тренерам">{first.byTrainer.map(t=><li key={t.trainerId}><strong>{trainerName(t.trainerId)}</strong><span>{dutyDuration(t.seconds)} · дней: {t.days} · смен: {t.completed}</span></li>)}</ul>}
    {!rows?.length?<EmptyState title="За этот период дежурств нет" description="Выберите другой период или дождитесь первой смены."/>:<ul className="corporate-admin-list" aria-label="Детали дежурств">{rows.map(d=><li key={d.id}><div><strong>{trainerName(d.trainerId)}</strong><p>{d.officeCity} · {d.officeName}</p><p>{dutyMoment(d.startedAt,d.timeZone)} — {d.endedAt?dutyMoment(d.endedAt,d.timeZone):'ещё идёт'}</p><p>{dutyStatus[d.status]}{d.seconds!==null?` · ${dutyDuration(d.seconds)}`:''} · {d.timeZone}</p></div><button type="button" className="secondary" onClick={()=>setSelected(d)}>Открыть запись</button></li>)}</ul>}
    {query.hasNextPage&&<button type="button" className="secondary" disabled={query.isFetchingNextPage} onClick={()=>void query.fetchNextPage()}>{query.isFetchNextPageError?'Повторить загрузку':'Показать ещё'}</button>}
    {query.isFetchNextPageError&&<p role="alert">Не удалось загрузить продолжение. Уже загруженные записи сохранены.</p>}
    {selected&&<DutyEditor key={`${actor!.userId}:${selected.id}:${selected.version}`} duty={selected} offices={first.offices} onClose={()=>setSelected(current=>current?.id===selected.id&&current.version===selected.version?null:current)} onReload={value=>setSelected(current=>current?.id===value.id&&value.version>=current.version?value:current)}/>}
    <details className="corporate-service-filters"><summary>Часовые пояса офисов</summary><OfficeTimeZone key={actor!.userId} offices={first.offices} reload={async()=>{const fresh=await query.refetch();if(fresh.error||!fresh.data)throw Error('Не удалось обновить часовые пояса.');return fresh.data.pages[0]!.offices}}/></details>
   </>}
  </AsyncView>
 </section>
}
function OfficeTimeZone({offices,reload}:{offices:DutyOffice[];reload:()=>Promise<DutyOffice[]>}){
 const cache=useQueryClient(),[selected,setSelected]=useState<DutyOffice|null>(null),[zone,setZone]=useState('')
 const [recovering,setRecovering]=useState(false),[error,setError]=useState<string|null>(null)
 const [confirm,confirmation]=useConfirm()
 const zones=['UTC',...Intl.supportedValuesOf('timeZone')]
 const mutation=useMutation({mutationFn:(draft:{officeId:string;timeZone:string;version:number})=>repository.zone(draft.officeId,draft.timeZone,draft.version),onSuccess:async(receipt,draft)=>{
  setSelected(previous=>previous?.id===draft.officeId?{...previous,timeZone:receipt.timeZone,zoneVersion:receipt.version}:previous)
  await cache.cancelQueries({queryKey:['corporate-duty-statistics']});await cache.invalidateQueries({queryKey:['corporate-duty-statistics']});await cache.invalidateQueries({queryKey:['corporate-duty-access']})
 }})
 const busy=mutation.isPending||recovering
 return <form className="corporate-duty-editor" aria-label="Часовой пояс офиса" onSubmit={e=>{e.preventDefault();if(selected&&zone)mutation.mutate({officeId:selected.id,timeZone:zone,version:selected.zoneVersion})}}>
  <p className="corporate-duty-note">Выберите явно. Изменение применяется к новым сменам; зона прежних смен сохраняется.</p>
  <Field label="Офис для часового пояса"><select required aria-label="Офис для часового пояса" disabled={busy} value={selected?.id??''} onChange={e=>{const value=offices.find(o=>o.id===e.target.value)??null;setSelected(value);setZone(value?.timeZone??'');mutation.reset();setError(null)}}><option value="">Выберите офис</option>{offices.filter(o=>!o.archived).map(o=><option key={o.id} value={o.id}>{o.city} · {o.name}</option>)}</select></Field>
  <Field label="Часовой пояс"><select aria-label="Часовой пояс" required disabled={!selected||busy||mutation.isError} value={zone} onChange={e=>{setZone(e.target.value);mutation.reset()}}><option value="">Выберите часовой пояс</option>{zone&&!zones.includes(zone)&&<option value={zone}>{zone}</option>}{zones.map(z=><option key={z} value={z}>{z}</option>)}</select></Field>
  <button type="submit" className="primary" disabled={!selected||!zone||busy||mutation.isError}>Сохранить часовой пояс</button>
  {mutation.isSuccess&&<p role="status">Часовой пояс сохранён.</p>}{mutation.isError&&<div role="alert"><p>{mutation.error.message}</p><button type="button" className="secondary" disabled={busy} onClick={async()=>{
   if(!await confirm({message:'Загрузить сохранённый часовой пояс? Несохранённый выбор будет заменён.',confirmLabel:'Загрузить'}))return
   setRecovering(true);setError(null)
   try{const values=await reload(),value=values.find(o=>o.id===selected?.id);if(!value)throw Error('Офис недоступен.');setSelected(value);setZone(value.timeZone??'');mutation.reset()}catch(e){setError(e instanceof Error?e.message:'Не удалось загрузить часовой пояс.')}finally{setRecovering(false)}
  }}>Загрузить сохранённый часовой пояс</button></div>}
  {error&&<p role="alert">{error}</p>}{confirmation}
 </form>
}
function DutyEditor({duty,offices,onClose,onReload}:{duty:CorporateDuty;offices:DutyOffice[];onClose:()=>void;onReload:(duty:CorporateDuty)=>void}){
 const {actor}=useAuth(),cache=useQueryClient()
 const editor=useRef<HTMLElement|null>(null)
 useLayoutEffect(()=>{editor.current?.scrollIntoView?.({block:'start'});editor.current?.focus({preventScroll:true})},[])
 const [officeId,setOffice]=useState(duty.officeId),[start,setStart]=useState(dutyLocalInput(duty.startedAt,duty.timeZone)),[end,setEnd]=useState(duty.endedAt?dutyLocalInput(duty.endedAt,duty.timeZone):'')
 const [reason,setReason]=useState(''),[error,setError]=useState<string|null>(null),[recovering,setRecovering]=useState(false)
 const [confirm,confirmation]=useConfirm(),pending=useRef<DutyCommand|null>(null)
 const zone=officeId===duty.officeId?duty.timeZone:offices.find(o=>o.id===officeId)?.timeZone
 const query=useInfiniteQuery({queryKey:['corporate-duty-audit',actor!.userId,duty.id],initialPageParam:undefined as number|undefined,
  queryFn:({pageParam})=>repository.audit(duty.id,pageParam),getNextPageParam:last=>last.records.length===50?last.records.at(-1)?.id:undefined,retry:false,staleTime:0})
 const mutation=useMutation({mutationFn:(value:DutyCommand)=>repository.command(value,true),onSuccess:async()=>{
  await Promise.all([['corporate-duty-statistics'],['corporate-duties'],['corporate-duty-access'],['corporate-duty-audit',actor!.userId,duty.id]].map(async queryKey=>{await cache.cancelQueries({queryKey});await cache.invalidateQueries({queryKey})}))
  onClose()
 }})
 const busy=mutation.isPending||recovering
 function instant(value:string,original?:string){const [date,time]=value.split('T');if(!date||!time||!zone)throw Error('Укажите дату, время и часовой пояс офиса.');return serviceInstant(date,time,zone,original)}
 async function submit(action:DutyCommand['action']){
  setError(null)
  if(!reason.trim()){setError('Укажите причину изменения.');return}
  try{
   if(action==='confirm'&&(officeId!==duty.officeId||start!==dutyLocalInput(duty.startedAt,duty.timeZone)||end!==(duty.endedAt?dutyLocalInput(duty.endedAt,duty.timeZone):'')))throw Error('Сначала сохраните исправление времени. Подтверждение относится к сохранённой смене.')
   const payload:DutyCommand={commandId:'',id:duty.id,version:duty.version,action,reason:reason.trim()}
   if(action==='correct'||action==='restore'){
    payload.officeId=officeId;payload.startedAt=instant(start,duty.startedAt);payload.endedAt=instant(end,duty.endedAt??undefined)
    if(Date.parse(payload.endedAt)<=Date.parse(payload.startedAt)||Date.parse(payload.endedAt)>Date.now())throw Error('Окончание должно быть позже начала и не в будущем.')
   }
   if(!await confirm({message:action==='void'?'Аннулировать дежурство? Оно исчезнет из итогов, история сохранится.':action==='confirm'?'Подтвердить фактическую длительность больше суток? Часы и дни попадут в итог.':'Сохранить исправление дежурства с указанной причиной?',confirmLabel:action==='void'?'Аннулировать':'Подтвердить',danger:action==='void'}))return
   const compare=(v:DutyCommand)=>JSON.stringify({...v,commandId:''})
   if(!pending.current||compare(pending.current)!==compare(payload))pending.current={...payload,commandId:crypto.randomUUID()}
   mutation.mutate(pending.current)
  }catch(e){setError(e instanceof Error?e.message:'Проверьте данные.')}
 }
 return <section ref={editor} tabIndex={-1} className="corporate-duty-editor" aria-label="Запись дежурства">
  <div className="corporate-service-heading"><h3>Запись дежурства</h3><button type="button" className="secondary" disabled={busy} onClick={onClose}>Закрыть запись</button></div>
  <p>{dutyStatus[duty.status]} · время офиса: {zone??'не задано'}</p>
  <fieldset disabled={busy||mutation.isError}>
   <Field label="Офис исправления"><select aria-label="Офис исправления" value={officeId} onChange={e=>{
    const next=e.target.value,nextZone=next===duty.officeId?duty.timeZone:offices.find(o=>o.id===next)?.timeZone
    if(!nextZone){setError('Сначала укажите часовой пояс выбранного офиса.');return}
    try{const a=instant(start,duty.startedAt),b=end?instant(end,duty.endedAt??undefined):null;setStart(dutyLocalInput(a,nextZone));if(b)setEnd(dutyLocalInput(b,nextZone));setOffice(next);setError(null)}catch(e){setError(e instanceof Error?e.message:'Проверьте время.')}
   }}>{!offices.some(o=>o.id===duty.officeId)&&<option value={duty.officeId}>{duty.officeName}</option>}{offices.map(o=><option key={o.id} value={o.id} disabled={o.id!==duty.officeId&&!o.timeZone}>{o.city} · {o.name}{o.archived?' (архив)':''}</option>)}</select></Field>
   <DutyDateControl label="Начало дежурства" value={start} onChange={setStart} zone={zone??duty.timeZone} disabled={busy||mutation.isError}/>
   <DutyDateControl label="Окончание дежурства" value={end} onChange={setEnd} zone={zone??duty.timeZone} disabled={busy||mutation.isError}/>
   <Field label="Причина изменения"><textarea aria-label="Причина изменения" maxLength={500} value={reason} onChange={e=>setReason(e.target.value)}/></Field>
   <div className="actions"><button type="button" className="primary" onClick={()=>void submit(duty.status==='void'?'restore':'correct')}>{duty.status==='void'?'Восстановить с исправлением':'Сохранить исправление'}</button>{duty.status!=='void'&&<button type="button" className="secondary" onClick={()=>void submit('void')}>Аннулировать дежурство</button>}{duty.status==='review'&&<button type="button" className="secondary" onClick={()=>void submit('confirm')}>Подтвердить длительность</button>}</div>
  </fieldset>
  {error&&<p role="alert" className="error">{error}</p>}
  {mutation.isError&&<div role="alert"><p>{mutation.error.message} Ввод сохранён.</p><button type="button" className="secondary" disabled={busy} onClick={async()=>{if(!await confirm({message:'Заменить несохранённый ввод сохранённой записью?',confirmLabel:'Загрузить запись'}))return;setRecovering(true);try{const latest=await repository.audit(duty.id);onReload(latest.current);mutation.reset();pending.current=null}catch(e){setError(e instanceof Error?e.message:'Не удалось прочитать запись.')}finally{setRecovering(false)}}}>Загрузить сохранённую запись</button>{(!(mutation.error instanceof CorporateDutyError)||mutation.error.status>=500)&&<button type="button" className="secondary" disabled={busy} onClick={()=>mutation.mutate(pending.current!)}>Повторить тот же запрос</button>}</div>}
  <details><summary>История изменений</summary><AsyncView loading={query.isPending} error={query.error&&!query.isFetchNextPageError?query.error:null} onRetry={()=>void query.refetch()}><ol className="corporate-duty-audit">{query.data?.pages.flatMap(p=>p.records).map(a=><li key={a.id}><strong>{auditAction[a.action]} · {a.actorName}</strong><p>{dutyMoment(a.occurred_at,duty.timeZone)}</p>{a.reason&&<p>Причина: {a.reason}</p>}{a.before_data&&<p>До: {a.before_data.office_city} · {a.before_data.office_name}, {dutyMoment(a.before_data.started_at,a.before_data.time_zone)} — {a.before_data.ended_at?dutyMoment(a.before_data.ended_at,a.before_data.time_zone):'открыто'} · {a.before_data.voided?'аннулировано':a.before_data.long_confirmed?'длительность подтверждена':'длительность не подтверждалась'}</p>}<p>После: {a.after_data.office_city} · {a.after_data.office_name}, {dutyMoment(a.after_data.started_at,a.after_data.time_zone)} — {a.after_data.ended_at?dutyMoment(a.after_data.ended_at,a.after_data.time_zone):'открыто'} · {a.after_data.voided?'аннулировано':a.after_data.long_confirmed?'длительность подтверждена':'длительность не подтверждалась'}</p></li>)}</ol>{query.hasNextPage&&<button type="button" className="secondary" disabled={query.isFetchingNextPage} onClick={()=>void query.fetchNextPage()}>{query.isFetchNextPageError?'Повторить загрузку':'Ещё изменения'}</button>}{query.isFetchNextPageError&&<p role="alert">Не удалось загрузить продолжение истории.</p>}</AsyncView></details>
  {confirmation}
 </section>
}

function DutyDateControl({label,value,onChange,zone,disabled}:{label:string;value:string;onChange:Dispatch<SetStateAction<string>>;zone:string;disabled:boolean}){
 const seed=value||dutyLocalInput(new Date().toISOString(),zone),date=localDate(seed.slice(0,10)),time=seed.slice(11)
 return <div className="corporate-duty-date"><span>{label}</span><FitLimeDatePicker disabled={disabled} value={date} today={todayInTimeZone(zone)} triggerAriaLabel={label}
  triggerLabel={value?`${formatLocalDateShort(localDate(value.slice(0,10)))} · ${value.slice(11)}`:'Выбрать дату и время'}
  time={{start:time,end:''}} showEndTime={false} startLabel="Время"
  onChange={date=>onChange(previous=>`${date}T${(previous||seed).slice(11)}`)}
  onTimeChange={time=>onChange(previous=>`${(previous||seed).slice(0,10)}T${time.start}`)}/></div>
}
