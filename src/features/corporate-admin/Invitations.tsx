import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import QRCode from 'qrcode'
import { useAuth } from '../../app/auth-context'
import { corporateInvitationsRepository as repository } from '../../data/repositories/corporate-invitations.repository'
import type { CorporateAdminBundle } from '../../shared/corporate-admin'
import { copyText } from '../../shared/clipboard'
import { corporateInvitationShareUrl } from '../../shared/invitation-share'
import { AsyncView, EmptyState, Field, SaveStatus, useConfirm } from '../../shared/ui'

const labels={active:'Ожидает тренера',claimed:'Ожидает подтверждения',approved:'Приглашение подтверждено',revoked:'Отменено',expired:'Срок истёк'}
export function CorporateInvitations({data,initialCreate=false}:{data:CorporateAdminBundle;initialCreate?:boolean}) {
  const {actor}=useAuth(), client=useQueryClient()
  const [creating,setCreating]=useState(initialCreate),[officeIds,setOfficeIds]=useState<string[]>([])
  const [operationId,setOperationId]=useState(()=>crypto.randomUUID())
  const [share,setShare]=useState<{id:string;token:string}|null>(null)
  const [confirm,confirmation]=useConfirm()
  const refresh=async()=>{await Promise.all([client.invalidateQueries({queryKey:['corporate-invitations',actor?.userId]}),client.invalidateQueries({queryKey:['corporate-admin-bundle',actor?.userId]})])}
  const query=useQuery({queryKey:['corporate-invitations',actor?.userId],queryFn:()=>repository.list(),retry:false})
  const create=useMutation({mutationFn:()=>repository.create(operationId,officeIds),onSuccess:async value=>{setShare(value);setCreating(false);setOfficeIds([]);setOperationId(crypto.randomUUID());await refresh()}})
  const decide=useMutation({mutationFn:({id,approve}:{id:string;approve:boolean})=>repository.decide(id,approve),onSuccess:refresh})
  const open=()=>{create.reset();setShare(null);setOfficeIds([]);setOperationId(crypto.randomUUID());setCreating(true)}
  return <section className="corporate-admin-workspace ym-hide-content">
    <div className="corporate-admin-toolbar"><h2>Приглашения</h2><button type="button" className="primary" disabled={create.isPending} onClick={open}>Пригласить тренера</button></div>
    {creating&&<form className="corporate-admin-editor" aria-label="Новое приглашение" onSubmit={e=>{e.preventDefault();create.mutate()}}>
      <h3>Офисы тренера</h3>
      <fieldset disabled={create.isPending}>
        {data.offices.filter(o=>!o.archived).map(o=><label className="corporate-admin-checkbox" key={o.id}><input type="checkbox" checked={officeIds.includes(o.id)} onChange={e=>setOfficeIds(old=>e.target.checked?[...old,o.id]:old.filter(id=>id!==o.id))}/>{o.city} · {o.name}</label>)}
        {!data.offices.some(o=>!o.archived)&&<p>Сначала добавьте активный офис.</p>}
        <div className="actions"><button type="submit" className="primary" disabled={!officeIds.length} aria-busy={create.isPending}>{create.isPending?'Создаём…':'Создать приглашение'}</button><button type="button" className="secondary" onClick={()=>setCreating(false)}>Отмена</button></div>
      </fieldset>
      <SaveStatus status={create.isError?'error':create.isPending?'saving':'idle'} error={create.error?.message}/>
    </form>}
    {share&&<CorporateInvitationShare token={share.token} onClose={()=>setShare(null)}/>}
    <SaveStatus status={decide.isError?'error':decide.isPending?'saving':'idle'} error={decide.error?.message}/>
    <AsyncView loading={query.isPending} error={query.error} onRetry={()=>void query.refetch()}>
      {query.data?.length?<ul className="corporate-admin-list">{query.data.map(i=><li key={i.id}><div><strong>{i.trainerName??'Приглашение тренеру'}</strong><p>{labels[i.status]}</p><p>{i.officeIds.map(id=>data.offices.find(o=>o.id===id)).filter(o=>o!==undefined).map(o=>`${o.city}, ${o.name}${o.archived?' (архив)':''}`).join('; ')}</p><p>Действует до {new Date(i.expiresAt).toLocaleDateString('ru-RU')}</p></div><div className="actions">
        {i.status==='claimed'&&<button type="button" className="primary" disabled={decide.isPending} onClick={async()=>{if(await confirm({message:`Добавить тренера «${i.trainerName}» в кабинет Яндекса с указанными офисами?`,confirmLabel:'Добавить тренера'}))decide.mutate({id:i.id,approve:true})}}>Подтвердить тренера</button>}
        {['active','claimed'].includes(i.status)&&<button type="button" className="secondary" disabled={decide.isPending} onClick={async()=>{if(await confirm({message:'Отменить приглашение? Ссылка перестанет работать.',confirmLabel:'Отменить приглашение'}))decide.mutate({id:i.id,approve:false})}}>Отменить приглашение</button>}
      </div></li>)}</ul>:query.data&&<EmptyState title="Приглашений пока нет" description="Пригласите тренера по ссылке или QR-коду."/>}
    </AsyncView>{confirmation}
  </section>
}
function CorporateInvitationShare({token,onClose}:{token:string;onClose:()=>void}) {
  const url=corporateInvitationShareUrl(token)
  const [copied,setCopied]=useState(false),[copyError,setCopyError]=useState(false),[showQr,setShowQr]=useState(false),[qr,setQr]=useState<string|null>(null),[qrError,setQrError]=useState(false)
  useEffect(()=>{
    if(!showQr)return
    let active=true
    void QRCode.toDataURL(url,{width:480,margin:2,errorCorrectionLevel:'M'}).then(image=>{if(active)setQr(image)}).catch(()=>{if(active)setQrError(true)})
    return()=>{active=false}
  },[showQr,url])
  return <section className="corporate-admin-editor corporate-invitation-share ym-hide-content" aria-label="Ссылка приглашения"><h3>Приглашение готово</h3><p>Отправьте ссылку тренеру. Срок — 7 дней. После принятия подтвердите заявку.</p><p>Если ссылка потеряется, отмените приглашение и создайте новое.</p>
    <div className="actions"><button type="button" className="primary" onClick={async()=>{try{await copyText(url);setCopied(true);setCopyError(false)}catch{setCopyError(true)}}}>{copied?'Ссылка скопирована':'Скопировать ссылку'}</button><button type="button" className="secondary" onClick={()=>setShowQr(true)}>Показать QR</button><button type="button" className="secondary" onClick={onClose}>Закрыть</button></div>
    {copyError&&<p role="alert">Не удалось скопировать. Выделите ссылку ниже.</p>}<Field label="Ссылка приглашения"><input className="ym-disable-keys" readOnly value={url} onFocus={e=>e.target.select()}/></Field>
    {showQr&&(qr?<img className="corporate-invitation-qr" src={qr} alt="QR-код приглашения тренера"/>:qrError?<p role="alert">Не удалось создать QR. Используйте ссылку.</p>:<p role="status">Создаём QR…</p>)}
  </section>
}
