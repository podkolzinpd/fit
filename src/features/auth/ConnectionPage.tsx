import { InviteAthleteButton } from './InvitationShareActions'
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
  if (/^[A-F0-9]{16}$/.test(value)) return value
  try {
    const url = new URL(input)
    if (![origin, 'https://fit-training.ru', 'https://www.fit-training.ru'].includes(url.origin) || url.pathname !== '/connect') return null
    const code = url.searchParams.get('code')
    return code && /^[A-F0-9]{16}$/.test(code) ? code : null
  } catch { return null }
}

function ConnectionScanner({ onCode }: { onCode: (code: string) => void }) {
  const video = useRef<HTMLVideoElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const callback = useRef(onCode)
  useEffect(() => { callback.current = onCode }, [onCode])
  useEffect(() => {
    let cancelled = false, detected = false
    let controls: { stop(): void } | undefined
    const element = video.current!
    void import('@zxing/browser').then(async ({ BrowserQRCodeReader }) => {
      if (cancelled) return
      const scanner = new BrowserQRCodeReader()
      controls = await scanner.decodeFromConstraints({ video: { facingMode: { ideal: 'environment' } }, audio: false }, element, (result, _error, scannerControls) => {
        if (!result || cancelled || detected) return
        const code = readConnectionCode(result.getText())
        if (!code) { setError('Это не личный QR Fit. Введите почту или попросите показать «Мой QR».'); return }
        detected = true
        scannerControls.stop()
        callback.current(code)
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
    <p>Наведите камеру на личный QR в Fit.</p>
    {error && <><p role="alert" className="error">{error}</p><button className="secondary" onClick={() => { setError(null); setAttempt(x => x + 1) }}>Повторить сканирование</button></>}
  </section>
}

function Consent({ person }: { person: ConnectionPerson }) {
  const { actor } = useAuth()
  return <><strong>{person.name}</strong><p>{person.role === 'trainer' ? 'Тренер' : 'Спортсмен'}</p>
    {actor?.role === 'client' && <>
      {person.currentTrainer && person.currentTrainer.id !== person.id && <p>Сейчас ваш тренер — {person.currentTrainer.name}. После подключения прежний тренер потеряет текущий доступ. История сохранится.</p>}
      <p>После согласия обоих тренер получит доступ к вашим тренировкам и прогрессу.</p>
    </>}
  </>
}

export function ConnectionRequests() {
  const { connectionDirectory: repository } = useDataBackend()
  const queryClient = useQueryClient()
  const [selected, setSelected] = useState<ConnectionRequest | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const previousRequests = useRef<string | null>(null)
  const list = useQuery({ queryKey: ['connection-requests'], queryFn: () => repository!.list(), enabled: !!repository, refetchInterval: 15_000 })
  useEffect(() => {
    if (!list.data) return
    const signature = list.data.map(item => item.id).sort().join(',')
    if (previousRequests.current !== null && previousRequests.current !== signature) {
      void queryClient.invalidateQueries({ predicate: query => query.queryKey[0] !== 'connection-requests' })
    }
    previousRequests.current = signature
  }, [list.data, queryClient])
  const preview = useQuery({ queryKey: ['connection-request-preview', selected?.id], queryFn: () => repository!.preview(selected!.peerId), enabled: !!repository && !!selected, staleTime: 0, retry: false })
  const decide = useMutation({ mutationFn: ({ action, request }: { action: 'accept' | 'decline' | 'cancel'; request: ConnectionRequest }) =>
    repository!.decide(action, request.id, action === 'accept' ? preview.data ?? undefined : undefined),
  onMutate: () => setMessage(null),
  onSuccess: async result => { setSelected(null); setMessage(result.status === 'accepted' ? 'Вы подключены' : result.status === 'declined' ? 'Запрос отклонён' : 'Предложение отменено'); await queryClient.invalidateQueries() } })
  if (!repository) return null
  return <section className="connection-requests" aria-label="Запросы на подключение">
    {list.data && list.data.length > 0 && <><h2>Запросы</h2>{list.data.map(request => <article className="card stack compact" key={request.id}>
      <strong>{request.name}</strong><p>{request.incoming ? 'Хочет подключиться' : 'Ждём подтверждения'}</p>
      {request.incoming ? <button className="primary" disabled={decide.isPending} onClick={() => { decide.reset(); setSelected(request) }}>Посмотреть</button>
        : <button className="secondary" disabled={decide.isPending} onClick={() => decide.mutate({ action: 'cancel', request })}>Отменить предложение</button>}
      {selected?.id === request.id && <div className="stack compact">
        {preview.isFetching && <p role="status">Проверяем подключение…</p>}
        {preview.data && !preview.isFetching && <><Consent person={preview.data} /><button className="primary" disabled={decide.isPending} onClick={() => decide.mutate({ action: 'accept', request })}>Принять</button></>}
        {(preview.error || preview.data === null) && <p className="error" role="alert">Не удалось проверить подключение.</p>}
        <button className="secondary" disabled={decide.isPending} onClick={() => decide.mutate({ action: 'decline', request })}>Отклонить</button>
        <button className="link" disabled={decide.isPending} onClick={() => { decide.reset(); void preview.refetch() }}>Проверить снова</button>
      </div>}
    </article>)}</>}
    {list.error && <p className="error" role="alert">Не удалось загрузить запросы. <button className="link" onClick={() => void list.refetch()}>Повторить</button></p>}
    {decide.error && <p className="error" role="alert">{decide.error.message}</p>}
    {message && <p role="status">{message}</p>}
  </section>
}

export function ConnectionPage() {
  const navigate = useNavigate()
  const { actor } = useAuth()
  const { connectionDirectory: repository } = useDataBackend()
  const queryClient = useQueryClient()
  const [params] = useSearchParams()
  const initialCode = params.get('code')
  const [mode, setMode] = useState<'scan' | 'self' | 'search'>(initialCode ? 'search' : 'scan')
  const [input, setInput] = useState(initialCode ?? '')
  const [lookup, setLookup] = useState<{ kind: 'code' | 'email'; value: string } | null>(initialCode ? { kind: 'code', value: initialCode } : null)
  const [qr, setQr] = useState<string | null>(null)
  const [shareMessage, setShareMessage] = useState<string | null>(null)
  const self = useQuery({ queryKey: ['connection-self'], queryFn: () => repository!.self(), enabled: !!repository && mode === 'self' })
  const person = useQuery({ queryKey: ['connection-resolve', lookup], queryFn: () => repository!.resolve(lookup!.kind, lookup!.value), enabled: !!repository && !!lookup, retry: false, staleTime: 0 })
  const send = useMutation({ mutationFn: () => repository!.send(person.data!), onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ['connection-requests'] }) } })
  const requestStatus = useQuery({ queryKey: ['connection-request-status', send.data?.id], queryFn: () => repository!.status(send.data!.id!), enabled: !!repository && !!send.data?.id,
    refetchInterval: query => !query.state.data || query.state.data.status === 'pending' ? 5_000 : false })
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
  function search(kind: 'email' | 'code', value: string) { send.reset(); setMode('search'); setLookup({ kind, value }) }
  async function share() {
    if (!url) return
    try {
      if (navigator.share) await navigator.share({ title: 'Подключиться в Fit', url })
      else { await navigator.clipboard.writeText(url); setShareMessage('Ссылка скопирована') }
    } catch (error) { if (!(error instanceof Error && error.name === 'AbortError')) setShareMessage('Не удалось отправить ссылку. Скопируйте её из поля ниже.') }
  }
  return <Page title={actor?.role === 'trainer' ? 'Добавить спортсмена' : 'Добавить тренера'} back={actor?.role === 'trainer' ? '/clients' : '/me/profile'}
    onBack={actor?.role === 'trainer' ? () => navigate('/clients', { state: { connectionFocus: true } }) : undefined} className="connection-page">
    {!repository ? <p role="alert">Подключение недоступно. Повторите вход.</p> : <>
      <div className="connection-modes"><button className={mode === 'scan' ? 'primary' : 'secondary'} onClick={() => setMode('scan')}>Сканировать QR</button><button className={mode === 'self' ? 'primary' : 'secondary'} onClick={() => setMode('self')}>Мой QR</button></div>
      {mode === 'scan' && <ConnectionScanner onCode={code => { setInput(code); search('code', code) }} />}
      {mode === 'self' && <section className="stack connection-self" aria-label="Мой QR">
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
      <button className="link" disabled={send.isPending} onClick={() => { setMode('search'); send.reset(); setLookup(null) }}>Найти по почте или ввести код</button>
      {mode === 'search' && <section className="stack">
        {!send.isSuccess && <form className="stack compact" onSubmit={event => { event.preventDefault(); const code = readConnectionCode(input); search(code ? 'code' : 'email', code ?? input.trim()) }}>
          <Field label="Почта или Fit-код"><input value={input} disabled={send.isPending} onChange={event => { setInput(event.target.value); setLookup(null); send.reset() }} required maxLength={254} autoCapitalize="none" autoComplete="off" spellCheck={false} /></Field>
          <button className="primary" disabled={person.isFetching || send.isPending}>Найти</button>
        </form>}
        {send.isSuccess && <p role="status">{finalStatus === 'accepted' ? 'Вы подключены' : finalStatus === 'declined' ? 'Запрос отклонён' : finalStatus === 'cancelled' ? 'Предложение отменено' : finalStatus === 'expired' ? 'Срок запроса истёк. Отправьте новый запрос.' : 'Запрос отправлен. Ждём подтверждения.'}</p>}
        {requestStatus.error && <p className="error" role="alert">Не удалось обновить статус подключения. <button className="link" onClick={() => void requestStatus.refetch()}>Проверить снова</button></p>}
        {person.isFetching && <p role="status">Ищем аккаунт…</p>}
        {person.error && <p role="alert" className="error">{person.error.message}</p>}
        {person.data === null && <p role="status">Аккаунт не найден. Проверьте почту или попросите человека показать личный QR в Fit.</p>}
        {person.data && !person.isFetching && !send.isSuccess && <article className="card stack"><Consent person={person.data} />
          {person.data.connected ? <p role="status">Вы уже подключены</p> : <button className="primary" disabled={send.isPending} onClick={() => send.mutate()}>{person.data.role === 'trainer' ? person.data.currentTrainer && person.data.currentTrainer.id !== person.data.id ? 'Запросить смену тренера' : 'Хочу заниматься' : 'Предложить подключение'}</button>}
          {send.error && <><p role="alert" className="error">{send.error.message}</p><button className="secondary" onClick={() => { send.reset(); void person.refetch() }}>Проверить снова</button></>}
        </article>}
      </section>}
      <ConnectionRequests />
      {actor?.role === 'trainer' && <details><summary>Новый спортсмен ещё не зарегистрирован?</summary><div className="stack compact"><InviteAthleteButton className="secondary" label="Пригласить нового спортсмена" /><Link to="/clients/new">Создать карточку вручную</Link></div></details>}
      <Link to="/join">Есть старый код приглашения?</Link>
    </>}
  </Page>
}
