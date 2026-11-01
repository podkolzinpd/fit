import { useEffect, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../app/auth-context'
import { corporateInvitationsRepository as repository } from '../../data/repositories/corporate-invitations.repository'
import { AuthIdentityScreen } from '../auth'
import { FitLogo } from '../../shared/FitLogo'
import { AsyncView, SaveStatus, StatePanel } from '../../shared/ui'
import { captureCorporateInvitation } from './invitation-continuation'

export function CorporateInvitationPage() {
  const {actor,loading,signOut}=useAuth(),navigate=useNavigate()
  const [{token,persisted}]=useState(()=>{
    let storage:Storage|undefined
    try{storage=window.sessionStorage}catch{/* The original link remains usable after login. */}
    return captureCorporateInvitation(window.location.hash,storage)
  })
  const [switchError,setSwitchError]=useState<string|null>(null),[switching,setSwitching]=useState(false)
  useEffect(()=>{if(persisted&&window.location.hash)window.history.replaceState(null,'','/corporate-invite')},[persisted])
  const preview=useQuery({queryKey:['corporate-invitation-preview',token?.slice(0,12)],queryFn:()=>repository.preview(token!),enabled:token!==null,retry:false})
  const claim=useMutation({mutationFn:()=>repository.claim(token!),onSuccess:()=>void preview.refetch()})
  const changeAccount=async()=>{setSwitching(true);setSwitchError(null);try{await signOut();navigate('/auth',{state:{from:'/corporate-invite',mode:'login',inviteRole:'trainer'}})}catch{setSwitchError('Не удалось выйти из аккаунта. Повторите попытку.')}finally{setSwitching(false)}}
  const status=preview.data?.status
  return <AuthIdentityScreen className="invitation-page ym-hide-content">
    <header className="auth-entry-head"><FitLogo/><p className="eyebrow">КАБИНЕТ ЯНДЕКСА</p><h1>Приглашение тренера</h1></header>
    {!token?<StatePanel tone="info" title="Приглашение не найдено" description="Откройте ссылку или QR-код от администратора."/>:<AsyncView loading={preview.isPending||loading} error={preview.error} onRetry={()=>void preview.refetch()}>
      {preview.data&&<>
        <p>{preview.data.offices.map(o=>`${o.city}, ${o.name}`).join('; ')}</p>
        {status==='revoked'||status==='expired'?<StatePanel tone="info" title={status==='revoked'?'Приглашение отменено':'Срок приглашения истёк'} description="Попросите администратора создать новое приглашение."/>:
          status==='approved'||claim.data==='already_member'?<StatePanel tone="info" title={status==='approved'?'Приглашение подтверждено':'Тренер уже добавлен'} description={status==='approved'?'Добавление было подтверждено администратором.':'Аккаунт уже подключён к кабинету Яндекса.'}/>:
          status==='claimed'?<StatePanel tone="info" title="Ожидает подтверждения" description="Приглашение принято. Администратор проверит заявку и подтвердит добавление."/>:<>
            <p>Администратор приглашает вас в кабинет Яндекса. После принятия он подтвердит ваш аккаунт и назначенные офисы.</p>
            {!persisted&&<p>После входа откройте исходную ссылку приглашения ещё раз.</p>}
            {!actor?<div className="stack invitation-actions"><button type="button" className="primary" onClick={()=>navigate('/auth',{state:{from:'/corporate-invite',mode:'login',inviteRole:'trainer'}})}>Войти в ФИТ</button><button type="button" className="secondary" onClick={()=>navigate('/auth',{state:{from:'/corporate-invite',mode:'register',inviteRole:'trainer'}})}>Зарегистрироваться тренером</button></div>:<>
              <p className="invitation-account">Текущий аккаунт: <strong>{[actor.firstName,actor.lastName].filter(Boolean).join(' ')||'Без имени'}</strong> · {actor.role==='trainer'?'тренер':'спортсмен'}</p>
              {actor.role==='trainer'?<button type="button" className="primary" disabled={claim.isPending||switching} aria-busy={claim.isPending} onClick={()=>claim.mutate()}>Присоединиться к кабинету Яндекса</button>:<p>Для принятия приглашения войдите в аккаунт тренера.</p>}
              <button type="button" className="secondary" disabled={claim.isPending||switching} onClick={()=>void changeAccount()}>Войти другим аккаунтом</button>
            </>}
          </>}
        <SaveStatus status={claim.isPending?'saving':claim.isError?'error':'idle'} error={claim.error?.message}/>
        {switchError&&<p role="alert">{switchError}</p>}
      </>}
    </AsyncView>}
    {/* A fresh document restores normal analytics after this private entry. */}
    <a className="auth-back-link" href={actor?.role==='trainer'?'/profile/settings':actor?'/me/settings':'/auth'}>Вернуться в ФИТ</a>
  </AuthIdentityScreen>
}
