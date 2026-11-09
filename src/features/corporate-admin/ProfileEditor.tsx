import {useBlocker} from 'react-router-dom'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../../app/auth-context'
import { corporateProfilesRepository as repository, type CorporateProfileAuditEntry } from '../../data/repositories/corporate-profile.repository'
import type { CorporateTrainer } from '../../shared/corporate-admin'
import { AsyncView, Switch, useConfirm } from '../../shared/ui'
import { TrainerProfessionalProfileSection } from '../profile'

const labels: Record<string,string> = { displayName:'Имя в анкете',bio:'О себе',specialties:'Направления',city:'Город',metroStationIds:'Метро',customLocations:'Места занятий',trainingModes:'Формат',experienceStartYear:'Начало практики',education:'Образование',formats:'Как проходят занятия',price:'Стоимость',acceptingClients:'Беру новых клиентов',certificates:'Сертификаты' }
const object = (value:unknown):Record<string,unknown> => typeof value==='object' && value!==null && !Array.isArray(value) ? value as Record<string,unknown> : {}
const text = (value:unknown):string => value===undefined || value===null || value==='' ? '—' : typeof value==='boolean' ? value?'Да':'Нет' : Array.isArray(value) ? value.map(item=>typeof item==='string'?item:JSON.stringify(item)).join(', ') || '—' : String(value)
export function profileAuditChanges(entry:CorporateProfileAuditEntry) {
 const before=object(entry.before_data),after=object(entry.after_data)
 if(entry.action==='management'||entry.action==='status_removed')return [{label:'Управление администратором',before:(before.managedByAdmin??before.managed)?'Включено':'Выключено',after:(after.managedByAdmin??after.managed)?'Включено':'Выключено'}]
 const a=object(before.draft_data),b=object(after.draft_data)
 const changes=Object.entries(labels).filter(([key])=>JSON.stringify(a[key])!==JSON.stringify(b[key])).map(([key,label])=>({label,before:text(a[key]),after:text(b[key])}))
 if(JSON.stringify(a.photos)!==JSON.stringify(b.photos)||a.avatarDataUrl!==b.avatarDataUrl)changes.push({label:'Фотографии и обложка',before:`Фото: ${Array.isArray(a.photos)?a.photos.length:a.avatarDataUrl?1:0}`,after:`Фото: ${Array.isArray(b.photos)?b.photos.length:b.avatarDataUrl?1:0}; порядок и обложка сохранены в истории`})
 if(JSON.stringify(before.published_data)!==JSON.stringify(after.published_data))changes.push({label:'Публикация',before:before.published_data?'Опубликована':'Не опубликована',after:after.published_data?'Опубликована новая версия':'Не опубликована'})
 if(before.listed_in_catalog!==after.listed_in_catalog)changes.push({label:'Видимость в каталоге',before:text(before.listed_in_catalog),after:text(after.listed_in_catalog)})
 return changes
}

function History({target,actorId}:{target:string;actorId:string|undefined}) {
 const query=useInfiniteQuery({queryKey:['corporate-profile-history',actorId,target],initialPageParam:0,queryFn:({pageParam})=>repository.history(target,pageParam),getNextPageParam:(last,pages)=>last.length===50?pages.length*50:undefined,retry:false})
 return <AsyncView loading={query.isPending} error={query.isFetchNextPageError?null:query.error} onRetry={()=>void query.refetch()}>
   {!query.data?.pages.flat().length?<p>Изменений анкеты пока нет.</p>:<ol className="corporate-profile-history">{query.data.pages.flat().map(entry=><li key={entry.id}>
    <strong>{entry.actor_name}</strong><time dateTime={entry.occurred_at}>{new Date(entry.occurred_at).toLocaleString('ru-RU')}</time>
    <dl>{profileAuditChanges(entry).map((change,i)=><div key={i}><dt>{change.label}</dt><dd><span>{change.before}</span><span aria-hidden="true"> → </span><span>{change.after}</span></dd></div>)}</dl>
   </li>)}</ol>}
   {query.isFetchNextPageError&&<p role="alert">Не удалось загрузить следующую часть истории. Уже загруженные записи сохранены.</p>}
   {query.hasNextPage&&<button type="button" className="secondary" disabled={query.isFetchingNextPage} onClick={()=>void query.fetchNextPage()}>{query.isFetchingNextPage?'Загружаем…':query.isFetchNextPageError?'Повторить загрузку':'Ещё изменения'}</button>}
 </AsyncView>
}

export function AdminProfileEditor({trainer,onClose}:{trainer:CorporateTrainer;onClose:()=>void}) {
 const {actor}=useAuth(),client=useQueryClient()
 const [dirty,setDirty]=useState(false),[history,setHistory]=useState(false)
 const [confirm,dialog]=useConfirm()
 const blocker=useBlocker(dirty)
 useEffect(()=>{
  if(blocker.state!=='blocked')return
  let active=true
  void confirm({message:'Покинуть редактор? Несохранённый текст будет потерян.',confirmLabel:'Уйти',cancelLabel:'Остаться'}).then(leave=>{if(active){if(leave)blocker.proceed();else blocker.reset()}})
  return()=>{active=false}
 },[blocker,confirm])
 const viewKey=useMemo(()=>['corporate-profile-view',actor?.userId,trainer.id],[actor?.userId,trainer.id])
 const query=useQuery({queryKey:viewKey,queryFn:()=>repository.read(trainer.id),retry:false,staleTime:0})
 const editor=useMemo(()=>{
   const read=()=>client.fetchQuery({queryKey:viewKey,queryFn:()=>repository.read(trainer.id),staleTime:1000})
   return {...repository.editor(trainer.id),getOwn:async()=>(await read()).profile,getManagement:async()=>(await read()).management}
 },[client,trainer.id,viewKey])
 const updated=useCallback(()=>{void client.invalidateQueries({queryKey:['corporate-profile-history',actor?.userId,trainer.id]})},[actor?.userId,client,trainer.id])
 const saveMode=useMutation({mutationFn:({managed,version,commandId}:{managed:boolean;version:number;commandId:string})=>repository.setManagement(trainer.id,managed,version,commandId),onSuccess:async()=>{
  updated();await Promise.all([client.invalidateQueries({queryKey:viewKey}),client.invalidateQueries({queryKey:['trainer-professional-profile',actor?.userId,`admin:${trainer.id}`,'management']})])
 },onError:()=>{void query.refetch()}})
 async function changeMode(managed:boolean) {
  if(!query.data)return
  const message=managed?'Тренер сможет только просматривать профессиональную анкету. Редактировать и публиковать её будет администратор. Продолжить?':'Разрешить тренеру снова редактировать и публиковать анкету? Содержимое и текущая публикация сохранятся.'
  if(!await confirm({message,confirmLabel:managed?'Передать управление':'Разрешить редактирование'}))return
  saveMode.mutate({managed,version:query.data.management.version,commandId:crypto.randomUUID()})
 }
 async function close(){if(!dirty||await confirm({message:'Закрыть редактор? Несохранённый текст будет потерян.',confirmLabel:'Закрыть'}))onClose()}
 return <section className="corporate-admin-editor corporate-profile-editor trainer-profile-identity" aria-label={`Анкета ${trainer.name}`}>
  {dialog}<header className="corporate-admin-toolbar"><h3>Анкета: {trainer.name}</h3><button type="button" className="secondary" disabled={saveMode.isPending} onClick={()=>void close()}>Закрыть анкету</button></header>
  <AsyncView loading={query.isPending} error={query.data?null:query.error} onRetry={()=>void query.refetch()}>
   {query.data&&<>
    {query.error&&<p role="alert" className="error">{query.error.message} Введённый текст остался в открытой форме.</p>}
    <div className="corporate-profile-control"><Switch label="Анкетой управляет администратор" checked={query.data.management.managedByAdmin} disabled={saveMode.isPending} onChange={value=>void changeMode(value)}/><p>{query.data.management.managedByAdmin?'Тренеру доступен только просмотр анкеты.':'Тренер и администратор могут редактировать анкету.'} Переключение само ничего не публикует.</p></div>
    {saveMode.error&&<p role="alert" className="error">{saveMode.error.message}</p>}
    <TrainerProfessionalProfileSection repositoryOverride={editor} scope={`admin:${trainer.id}`} displayName={trainer.name} adminMode onDirtyChange={setDirty} onSaved={updated}/>
    <details open={history} onToggle={event=>setHistory(event.currentTarget.open)}><summary>История изменений анкеты</summary>{history&&<History target={trainer.id} actorId={actor?.userId}/>}</details>
   </>}
  </AsyncView>
 </section>
}
