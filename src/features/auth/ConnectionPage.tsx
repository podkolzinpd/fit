import { TrainerHistoryConsent } from '../../shared/TrainerHistoryConsent'
import { parseInvitationLocation } from './invitation-link-continuation'
import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import QRCode from 'qrcode'
import { useAuth } from '../../app/auth-context'
import { useDataBackend } from '../../app/data-backend-context'
import type { ConnectionPerson, ConnectionRequest } from '../../shared/connection-directory'
import { Field, Page } from '../../shared/ui'
import { connectionShareUrl } from '../../shared/invitation-share'
import './connection-page.css'

export function readConnectionCode(input: string, origin = window.location.origin): string | null {
  const value = input.trim().toUpperCase().replaceAll('-', '')
  if (/^(?:[A-F0-9]{16}|[A-F0-9]{32})$/.test(value)) return value
  try {
    const url = new URL(input)
    if (![origin, 'https://fit-training.ru', 'https://www.fit-training.ru'].includes(url.origin) || url.pathname !== '/connect') return null
    const code = url.searchParams.get('code')
    return code && /^(?:[A-F0-9]{16}|[A-F0-9]{32})$/.test(code) ? code : null
  } catch { return null }
}

export function readFitConnectionTarget(input: string, origin = window.location.origin): { code: string } | { path: string } | null {
  const code = readConnectionCode(input, origin)
  if (code) return { code }
  const raw = input.trim().toUpperCase()
  if (/^[A-Z0-9]{12}$/.test(raw)) return { path: `/join?code=${raw}` }
  try {
    const url = new URL(input)
    if (![origin, 'https://fit-training.ru', 'https://www.fit-training.ru'].includes(url.origin) || url.username || url.password) return null
    if (url.pathname === '/join' && [...url.searchParams.keys()].length === 1 && /^[A-Z0-9]{12}$/.test(url.searchParams.get('code') ?? '')) return { path: `/join${url.search}` }
    if (url.pathname === '/invite' && parseInvitationLocation(url.search, url.hash)) return { path: `/invite${url.search}${url.hash}` }
    return null
  } catch { return null }
}

function ConnectionScanner({ onTarget }: { onTarget: (target: { code: string } | { path: string }) => void }) {
  const video = useRef<HTMLVideoElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const callback = useRef(onTarget)
  useEffect(() => { callback.current = onTarget }, [onTarget])
  useEffect(() => {
    let cancelled = false, detected = false
    let controls: { stop(): void } | undefined
    const element = video.current!
    void import('@zxing/browser').then(async ({ BrowserQRCodeReader }) => {
      if (cancelled) return
      const scanner = new BrowserQRCodeReader()
      controls = await scanner.decodeFromConstraints({ video: { facingMode: { ideal: 'environment' } }, audio: false }, element, (result, _error, scannerControls) => {
        if (!result || cancelled || detected) return
        const target = readFitConnectionTarget(result.getText())
        if (!target) { setError('QR не распознан как приглашение Fit. Попросите отправить ссылку или найдите человека по почте.'); return }
        detected = true
        scannerControls.stop()
        callback.current(target)
      })
      if (cancelled) controls.stop()
    }).catch(() => { if (!cancelled) setError('Камера недоступна. Разрешите доступ или найдите человека по почте или коду.') })
    return () => {
      cancelled = true
      controls?.stop()
      const stream = element.srcObject
      if (typeof MediaStream !== 'undefined' && stream instanceof MediaStream) stream.getTracks().forEach(track => track.stop())
      element.srcObject = null
    }
  }, [attempt])
  return <section aria-label="Сканирование QR"><video ref={video} autoPlay muted playsInline className="connection-camera" aria-label="Камера для QR-кода" />
    <p>Наведите камеру на QR человека или приглашения Fit.</p>
    {error && <><p role="alert" className="error">{error}</p><button className="secondary" onClick={() => { setError(null); setAttempt(x => x + 1) }}>Повторить сканирование</button></>}
  </section>
}

function Consent({ person }: { person: ConnectionPerson }) {
  const { actor } = useAuth()
  return <><strong>{person.name}</strong><p>{person.role === 'trainer' ? 'Тренер' : 'Спортсмен'}</p>
    {actor?.role === 'client' && <>
      {person.currentTrainer && person.currentTrainer.id !== person.id && <p>Сейчас ваш тренер — {person.currentTrainer.name}. После подключения прежний тренер потеряет текущий доступ. История сохранится.</p>}
      <p>Тренер сможет назначать занятия и видеть тренировки, которые вы ведёте вместе, и ваш прогресс. Доступ к прошлым занятиям с другими тренерами разрешаете вы.</p>
    </>}
  </>
}

export function connectionStatusText(status: string, incoming: boolean): string {
  switch (status) {
    case 'accepted': return 'Вы подключены'
    case 'disconnected': return 'Подключение завершено. История сохранена.'
    case 'declined': return 'Запрос отклонён'
    case 'cancelled': return 'Предложение отменено'
    case 'expired': return 'Срок запроса истёк. Можно отправить новый.'
    case 'needs_confirmation': return incoming ? 'Спортсмену нужно подтвердить подключение заново.' : 'Связь с тренером изменилась. Подтвердите подключение заново.'
    default: return incoming ? 'Приглашает вас подключиться' : 'Ждём подтверждения'
  }
}

export function ConnectionRequests({ excludeRequestId }: { excludeRequestId?: string } = {}) {
  const { actor } = useAuth()
  const { connectionDirectory: repository } = useDataBackend()
  const queryClient = useQueryClient()
  const [shareSoloHistory, setShareSoloHistory] = useState(false)
  const [shareHistory, setShareHistory] = useState(false)
  const [selected, setSelected] = useState<ConnectionRequest | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const previousRequests = useRef<string | null>(null)
  const list = useQuery({ queryKey: ['connection-requests'], queryFn: () => repository!.list(), enabled: !!repository, refetchInterval: 15_000 })
  useEffect(() => {
    if (!list.data) return
    const signature = list.data.map(item => `${item.id}:${item.status}`).sort().join(',')
    if (previousRequests.current !== null && previousRequests.current !== signature) {
      void queryClient.invalidateQueries({ predicate: query => query.queryKey[0] !== 'connection-requests' })
    }
    previousRequests.current = signature
  }, [list.data, queryClient])
  const preview = useQuery({ queryKey: ['connection-request-preview', selected?.id], queryFn: () => repository!.preview(selected!.peerId), enabled: !!repository && !!selected, staleTime: 0, retry: false })
  const decide = useMutation({ mutationFn: ({ action, request, consent }: { action: 'accept' | 'decline' | 'cancel'; request: ConnectionRequest; consent?: ConnectionPerson }) =>
    request.status === 'needs_confirmation' && !request.incoming && action === 'accept'
      ? repository!.send({ ...(consent ?? preview.data!), shareHistory, shareSoloHistory })
      : repository!.decide(action, request.id, action === 'accept' ? { ...(consent ?? preview.data!), shareHistory, shareSoloHistory } : undefined),
  onMutate: () => setMessage(null),
  onError: () => { void list.refetch() },
  onSuccess: async result => { setSelected(null); setMessage(result.status === 'accepted' ? 'Подключение подтверждено' : result.status === 'pending' ? 'Согласие обновлено. Ждём тренера.' : result.status === 'declined' ? 'Запрос отклонён' : 'Предложение отменено'); await queryClient.invalidateQueries() } })
  const accept = useMutation({
    mutationFn: async (request: ConnectionRequest) => {
      const consent = await repository!.preview(request.peerId)
      if (!consent) throw new Error('Не удалось проверить подключение. Попробуйте ещё раз.')
      return { request, consent }
    },
    onMutate: () => { decide.reset(); setMessage(null); setShareHistory(false); setShareSoloHistory(false) },
    onSuccess: ({ request, consent }) => {
      if (actor?.role === 'client') {
        queryClient.setQueryData(['connection-request-preview', request.id], consent)
        setSelected(request)
      } else decide.mutate({ action: 'accept', request, consent })
    },
  })
  const busy = decide.isPending || accept.isPending
  if (!repository) return null
  return <section className="connection-requests" aria-label="Запросы на подключение">
    {list.data && list.data.length > 0 && <><h2>Запросы</h2>{list.data.filter(request => request.id !== excludeRequestId).map(request => <article className="card stack compact" key={request.id}>
      <strong>{request.name}</strong><p>{request.status === 'pending' && request.incoming ? request.role === 'trainer' ? 'Хочет стать вашим тренером' : 'Хочет заниматься с вами' : connectionStatusText(request.status, request.incoming)}</p>
      {(request.status === 'pending' || request.status === 'needs_confirmation') && <>
        {selected?.id !== request.id && (request.status === 'pending' && request.incoming || request.status === 'needs_confirmation' && !request.incoming) && <button className="primary" disabled={busy} onClick={() => accept.mutate(request)}>{request.status === 'needs_confirmation' ? 'Подтвердить заново' : 'Принять'}</button>}
        {!request.incoming && <button className="secondary" disabled={busy} onClick={() => decide.mutate({ action: 'cancel', request })}>Отменить предложение</button>}
        {request.incoming && selected?.id !== request.id && <button className="secondary" disabled={busy} onClick={() => decide.mutate({ action: 'decline', request })}>Отклонить</button>}
      </>}
      {selected?.id === request.id && (request.status === 'pending' || request.status === 'needs_confirmation' && !request.incoming) && <div className="stack compact">
        {preview.isFetching && <p role="status">Проверяем подключение…</p>}
        {preview.data && !preview.isFetching && <><Consent person={preview.data} /><TrainerHistoryConsent checked={shareHistory} soloChecked={shareSoloHistory} onSoloChange={setShareSoloHistory} disabled={busy} onChange={setShareHistory} /><button className="primary" disabled={busy} onClick={() => decide.mutate({ action: 'accept', request })}>{preview.data.currentTrainer && preview.data.currentTrainer.id !== preview.data.id ? 'Сменить тренера' : 'Подключить тренера'}</button></>}
        {(preview.error || preview.data === null) && <p className="error" role="alert">Не удалось проверить подключение.</p>}
        {request.incoming && <button className="secondary" disabled={busy} onClick={() => decide.mutate({ action: 'decline', request })}>Отклонить</button>}
        <button className="link" disabled={busy} onClick={() => { decide.reset(); void preview.refetch() }}>Проверить снова</button>
      </div>}
    </article>)}</>}
    {list.error && <p className="error" role="alert">Не удалось загрузить запросы. <button className="link" onClick={() => void list.refetch()}>Повторить</button></p>}
    {decide.error && <p className="error" role="alert">{decide.error.message}</p>}
    {accept.error && <p className="error" role="alert">{accept.error.message}</p>}
    {message && <p role="status">{message}</p>}
  </section>
}

export function ConnectionPage() {
  const navigate = useNavigate()
  const { actor } = useAuth()
  const { connectionDirectory: repository } = useDataBackend()
  const queryClient = useQueryClient()
  const [shareSoloHistory, setShareSoloHistory] = useState(false)
  const [shareHistory, setShareHistory] = useState(false)
  const [params] = useSearchParams()
  const initialCode = params.get('code')
  const [mode, setMode] = useState<'scan' | 'self' | 'search'>('search')
  const [input, setInput] = useState(initialCode ?? '')
  const [lookup, setLookup] = useState<{ kind: 'code' | 'email'; value: string } | null>(initialCode ? { kind: 'code', value: initialCode } : null)
  const [qr, setQr] = useState<string | null>(null)
  const [shareMessage, setShareMessage] = useState<string | null>(null)
  const self = useQuery({ queryKey: ['connection-self'], queryFn: () => repository!.self(), enabled: !!repository && mode === 'self' })
  const person = useQuery({ queryKey: ['connection-resolve', lookup], queryFn: () => repository!.resolve(lookup!.kind, lookup!.value), enabled: !!repository && !!lookup, retry: false, staleTime: 0 })
  const send = useMutation({ mutationFn: () => repository!.send({ ...person.data!, shareHistory, shareSoloHistory }), onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ['connection-requests'] }) } })
  const requestStatus = useQuery({ queryKey: ['connection-request-status', send.data?.id], queryFn: () => repository!.status(send.data!.id!), enabled: !!repository && !!send.data?.id,
    refetchInterval: 5_000 })
  const finalStatus = requestStatus.data?.status ?? send.data?.status
  useEffect(() => {
    if (requestStatus.data?.status && requestStatus.data.status !== 'pending') {
      void queryClient.invalidateQueries({ predicate: query => query.queryKey[0] !== 'connection-request-status' })
    }
  }, [requestStatus.data?.status, queryClient])
  const rotate = useMutation({ mutationFn: () => repository!.rotate(), onSuccess: data => { queryClient.setQueryData(['connection-self'], data); setShareMessage('Прежние QR, код и ссылка больше не действуют.') } })
  const url = self.data ? connectionShareUrl(self.data.code) : null
  useEffect(() => {
    let active = true
    if (url) void QRCode.toDataURL(url, { width: 280, margin: 2 }).then(value => { if (active) setQr(value) }).catch(() => { if (active) setShareMessage('Не удалось создать QR. Можно отправить ссылку.') })
    return () => { active = false; setQr(null) }
  }, [url])
  function search(kind: 'email' | 'code', value: string) { send.reset(); setShareHistory(false); setShareSoloHistory(false); setMode('search'); setLookup({ kind, value }) }
  const focused = !!person.data || send.isSuccess || (!!initialCode && !!lookup)
  async function share() {
    if (!url) return
    try {
      if (navigator.share) await navigator.share({ title: 'Подключиться в Fit', url })
      else { await navigator.clipboard.writeText(url); setShareMessage('Ссылка скопирована') }
    } catch (error) { if (!(error instanceof Error && error.name === 'AbortError')) setShareMessage('Не удалось отправить ссылку. Скопируйте её из поля ниже.') }
  }
  return <Page title={initialCode?.length === 32 && lookup?.value === initialCode ? 'Приглашение' : actor?.role === 'trainer' ? 'Добавить спортсмена' : 'Добавить тренера'} back={actor?.role === 'trainer' ? '/clients' : '/me/profile'}
    onBack={actor?.role === 'trainer' ? () => navigate('/clients', { state: { connectionFocus: true } }) : undefined} className="connection-page">
    {!repository ? <p role="alert">Подключение недоступно. Повторите вход.</p> : <>
      {!focused && <div className="connection-modes"><button className={mode === 'scan' ? 'primary' : 'secondary'} onClick={() => setMode('scan')}>Сканировать QR</button><button className={mode === 'self' ? 'primary' : 'secondary'} onClick={() => setMode('self')}>Мой QR</button></div>}
      {!focused && mode === 'scan' && <ConnectionScanner onTarget={target => { if ('path' in target) navigate(target.path); else { setInput(target.code); search('code', target.code) } }} />}
      {!focused && mode === 'self' && <section className="stack connection-self" aria-label="Мой QR">
        <strong>{[actor?.firstName, actor?.lastName].filter(Boolean).join(' ')}</strong>
        {qr && <img src={qr} width={280} height={280} alt="Мой QR для подключения в Fit" />}
        {self.isLoading && <p role="status">Загружаем QR…</p>}
        {self.error && <p role="alert" className="error">Не удалось загрузить QR. <button className="link" onClick={() => void self.refetch()}>Повторить</button></p>}
        {self.data && <><p>Fit-код: <strong>{self.data.code}</strong></p><button className="primary" onClick={() => void share()}>Отправить ссылку</button>
          <Field label="Ссылка для подключения"><input value={url ?? ''} readOnly onFocus={event => event.target.select()} /></Field>
          <details><summary>Настройки QR и помощь</summary><p>Fit ID: {self.data.fitId}</p>
            {!self.data.emailSearchReady && <p>Чтобы вас находили по почте, повторите вход через Яндекс ID с доступом к адресу почты.</p>}
            <button className="secondary" disabled={rotate.isPending} onClick={() => rotate.mutate()}>Заменить QR и код</button><p>Прежние QR и ссылки перестанут действовать. Подключения сохранятся.</p>
          </details></>}
        {(shareMessage || rotate.error) && <p role="status">{shareMessage ?? rotate.error?.message}</p>}
      </section>}
      {!focused && mode !== 'search' && <button className="link" disabled={send.isPending} onClick={() => { setMode('search'); send.reset(); setLookup(null) }}>Найти по почте или ввести код</button>}
      {mode === 'search' && <section className="stack">
        {!send.isSuccess && !person.data && (!initialCode || !lookup) && <form className="stack compact" onSubmit={event => { event.preventDefault(); const target = readFitConnectionTarget(input); if (target && 'path' in target) navigate(target.path); else search(target ? 'code' : 'email', target?.code ?? input.trim()) }}>
          <Field label="Почта или Fit-код"><input value={input} disabled={send.isPending} onChange={event => { setInput(event.target.value); setLookup(null); send.reset() }} required maxLength={254} autoCapitalize="none" autoComplete="off" spellCheck={false} /></Field>
          <button className="primary" disabled={person.isFetching || send.isPending}>Найти</button>
        </form>}
        {send.isSuccess && <><strong>{person.data?.name}</strong><p role="status">{finalStatus === 'pending' && !send.data?.incoming ? 'Запрос отправлен. Ждём подтверждения.' : connectionStatusText(finalStatus ?? 'pending', send.data?.incoming ?? false)}</p></>}
        {requestStatus.error && <p className="error" role="alert">Не удалось обновить статус подключения. <button className="link" onClick={() => void requestStatus.refetch()}>Проверить снова</button></p>}
        {person.isFetching && <p role="status">Ищем аккаунт…</p>}
        {person.error && <p role="alert" className="error">{person.error.message}</p>}
        {person.data === null && <p role="status">{lookup?.kind === 'code' && lookup.value.length === 32 ? actor?.role === 'trainer' ? 'Это приглашение для спортсмена. Вы вошли как тренер.' : 'Приглашение недействительно или уже использовано. Попросите тренера отправить новое.' : 'Не нашли человека. Проверьте почту или попросите его показать «Мой QR». Если аккаунта ещё нет — отправьте ссылку из «Мой QR».'}</p>}
        {person.data && !person.isFetching && !send.isSuccess && <article className="card stack"><Consent person={person.data} />
          {actor?.role === 'client' && !person.data.connected && <TrainerHistoryConsent checked={shareHistory} soloChecked={shareSoloHistory} onSoloChange={setShareSoloHistory} disabled={send.isPending} onChange={setShareHistory} />}
          {person.data.connected ? <p role="status">Вы уже подключены</p> : <button className="primary" disabled={send.isPending} onClick={() => send.mutate()}>{person.data.invitationCode ? 'Принять приглашение' : person.data.currentTrainer && person.data.currentTrainer.id !== person.data.id ? 'Сменить тренера' : 'Добавить'}</button>}
          {send.error && <><p role="alert" className="error">{send.error.message}</p><button className="secondary" onClick={() => { send.reset(); void person.refetch() }}>Проверить снова</button></>}
        </article>}
      </section>}
      {(!focused || send.data?.incoming || finalStatus === 'needs_confirmation') && <ConnectionRequests excludeRequestId={finalStatus !== 'pending' && finalStatus !== 'needs_confirmation' ? send.data?.id : undefined} />}
      {!focused && actor?.role === 'trainer' && <Link className="link connection-manual-card" to="/clients/new">Создать карточку без регистрации</Link>}
      {focused && <button className="link" disabled={send.isPending} onClick={() => { send.reset(); setLookup(null); setInput(''); setMode('search') }}>Найти другого человека</button>}

    </>}
  </Page>
}
