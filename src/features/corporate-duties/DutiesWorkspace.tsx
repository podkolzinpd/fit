import { useRef, useState } from 'react'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../../app/auth-context'
import { CorporateDutyError, corporateDutiesRepository as repository, type DutyAccess, type DutyCommand } from '../../data/repositories/corporate-duties.repository'
import type { ServiceCursor } from '../../data/repositories/corporate-services.repository'
import { AsyncView, EmptyState, Field } from '../../shared/ui'
import { ServicePeriod } from '../corporate-services/ServicePeriod'
import { servicePeriod } from '../corporate-services/service-time'
import { dutyDuration, dutyMoment, dutyStatus } from './duty-time'
import './duties.css'
export const dutyAccessKey=(userId?:string)=>['corporate-duty-access',userId]
export function useDutyAccess(){
 const {actor}=useAuth()
 return useQuery({queryKey:dutyAccessKey(actor?.userId),queryFn:()=>repository.access(),enabled:actor?.role==='trainer',retry:false,staleTime:0,gcTime:0,refetchOnMount:'always'})
}
export function hasDutyAccess(value?:DutyAccess){return value?.allowed===true||value?.hasHistory===true}
export function CorporateDutiesWorkspace({access}:{access:DutyAccess}){
 const {actor}=useAuth(),cache=useQueryClient(),key=dutyAccessKey(actor!.userId)
 const [range,setRange]=useState(()=>servicePeriod(actor!.timezone,'month'))
 const [office,setOffice]=useState(''),[checking,setChecking]=useState(false),[checkError,setCheckError]=useState<string|null>(null)
 const pending=useRef<DutyCommand|null>(null)
 const history=useInfiniteQuery({queryKey:['corporate-duties',actor!.userId,range],initialPageParam:undefined as ServiceCursor|undefined,
  queryFn:({pageParam})=>repository.list(range,false,'','',pageParam),getNextPageParam:last=>last.nextCursor??undefined,retry:false,staleTime:0})
 const current=access.active
 const officeId=office||(access.offices.length===1?access.offices[0]!.id:'')
 const selected=access.offices.find(o=>o.id===officeId)
 const command=useMutation({mutationFn:(value:DutyCommand)=>repository.command(value),onSuccess:async()=>{
  await refresh();pending.current=null
 }})
 async function refresh(){
  await cache.cancelQueries({queryKey:key,exact:true})
  // Read back current state; an old replay receipt must not replace a newer stop.
  await cache.fetchQuery({queryKey:key,queryFn:()=>repository.access(),staleTime:0})
  await cache.cancelQueries({queryKey:['corporate-duties',actor!.userId]})
  await cache.invalidateQueries({queryKey:['corporate-duties',actor!.userId]})
 }
 async function recover(){
  setChecking(true);setCheckError(null)
  try{await refresh();command.reset();pending.current=null}catch(e){setCheckError(e instanceof Error?e.message:'Не удалось обновить состояние.')}
  finally{setChecking(false)}
 }
 const busy=command.isPending||checking
 const blocked=busy||command.isError
 const rows=history.data?.pages.flatMap(p=>p.records).filter((r,i,all)=>all.findIndex(x=>x.id===r.id)===i)
 return <section className="corporate-duty-workspace ym-hide-content" aria-label="Учёт дежурств">
  <div className="corporate-service-heading"><h2>Дежурство</h2><button type="button" className="secondary" disabled={busy} onClick={()=>void recover()}>Обновить состояние</button></div>
  {current?<div className="corporate-duty-current"><strong>Дежурство открыто</strong><p>{current.officeCity} · {current.officeName}</p><p>Начало: {dutyMoment(current.startedAt,current.timeZone)} · {current.timeZone}</p><p className="corporate-duty-note">Закрытие приложения не завершает дежурство.</p>
   <button type="button" className="primary" disabled={blocked} aria-busy={command.isPending} onClick={()=>{pending.current={commandId:crypto.randomUUID(),id:current.id,action:'stop',version:current.version};command.mutate(pending.current)}}>Закончить дежурство</button>
  </div>:access.allowed?<div className="corporate-duty-current">
   <Field label="Офис дежурства"><select aria-label="Офис дежурства" disabled={blocked} value={officeId} onChange={e=>setOffice(e.target.value)}><option value="">Выберите офис</option>{access.offices.map(o=><option key={o.id} value={o.id}>{o.city} · {o.name}</option>)}</select></Field>
   {!access.offices.length&&<p role="status">Нет действующего назначенного офиса. Обратитесь к администратору.</p>}
   {selected&&!selected.timeZone&&<p role="status">Администратор должен указать часовой пояс этого офиса.</p>}
   <button type="button" className="primary" disabled={blocked||!selected?.timeZone} aria-busy={command.isPending} onClick={()=>{pending.current={commandId:crypto.randomUUID(),id:crypto.randomUUID(),action:'start',officeId,version:0};command.mutate(pending.current)}}>Начать дежурство</button>
   <p className="corporate-duty-note">Начало и окончание сохраняются по времени сервера.</p>
  </div>:<p role="status">Новые дежурства недоступны. Сохранённая история остаётся доступной.</p>}
  {command.isError&&<div role="alert"><p>{command.error.message}</p><p>Сначала проверьте состояние. Запрос мог сохраниться.</p><button type="button" className="secondary" disabled={busy} onClick={()=>void recover()}>Проверить сохранённое состояние</button>{(!(command.error instanceof CorporateDutyError)||command.error.status>=500)&&<button type="button" className="secondary" disabled={busy} onClick={()=>command.mutate(pending.current!)}>Повторить тот же запрос</button>}</div>}
  {checkError&&<p role="alert" className="error">{checkError}</p>}
  <section className="corporate-service-history"><h2>Мои дежурства</h2><ServicePeriod key={`${range.from}:${range.until}`} range={range} zone={actor!.timezone} onChange={setRange}/>
   <AsyncView loading={history.isPending} error={history.error&&!history.isFetchNextPageError?history.error:null} onRetry={()=>void history.refetch()}>
    {history.data&&<p aria-label="Итоги моих дежурств">{dutyDuration(history.data.pages[0]!.seconds)} · дней: {history.data.pages[0]!.days} · смен: {history.data.pages[0]!.completed}</p>}
    {rows?.length?<ul className="corporate-service-list">{rows.map(d=><li key={d.id}><div><strong>{d.officeCity} · {d.officeName}</strong><p>{dutyMoment(d.startedAt,d.timeZone)} — {d.endedAt?dutyMoment(d.endedAt,d.timeZone):'ещё идёт'}</p><p>{d.timeZone} · {dutyStatus[d.status]}{d.seconds!==null?` · ${dutyDuration(d.seconds)}`:''}</p>{d.status==='review'&&<p>Больше 24 часов. В итог попадёт после проверки администратором.</p>}</div></li>)}</ul>:rows&&<EmptyState title="За этот период дежурств нет" description="Здесь сохранятся начатые и завершённые дежурства."/>}
   </AsyncView>
   {history.hasNextPage&&<button type="button" className="secondary" disabled={history.isFetchingNextPage} onClick={()=>void history.fetchNextPage()}>{history.isFetchNextPageError?'Повторить загрузку':'Показать ещё'}</button>}
   {history.isFetchNextPageError&&<p role="alert">Не удалось загрузить продолжение. Уже загруженные записи сохранены.</p>}
  </section>
 </section>
}
