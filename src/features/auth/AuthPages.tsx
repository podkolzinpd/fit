import { useEffect, useRef, useState, type FormEvent, type PropsWithChildren } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { authRepository } from '../../data/repositories/auth.repository'
import {
  yandexPilotRepository,
  type YandexPilotClient,
  type YandexPilotConnections as YandexPilotConnectionsData,
  type YandexPilotSession,
  type YandexPilotTrainingData as YandexPilotTrainingDataState,
} from '../../data/repositories/yandex-pilot.repository'
import { useAuth } from '../../app/auth-context'
import { getYandexIdPilotConfig, getYandexSessionLinkingConfig, trainerHomePath } from '../../app/feature-flags'
import { applyThemeVariant, resolveThemeVariant, themeVariantClass, useAppTheme } from '../../app/theme'
import { ProfileIcon } from '../../shared/icons'
import { AsyncView, Field, StatePanel } from '../../shared/ui'
import type { AccountRole } from '../../shared/domain'
import {
  clearPendingYandexAuthorization,
  consumeYandexAuthorizationCallback,
  createYandexAuthorizationUrl,
  peekPendingYandexAuthorizationIntent,
} from './yandex-pilot-oauth'
import { YandexPilotConnections } from './YandexPilotConnections'
import { YandexPilotTrainingData } from './YandexPilotTrainingData'
import { useYandexPilotPolling } from './use-yandex-pilot-polling'

type Mode = 'login' | 'register'

function AuthIdentityScreen({ children, className }: PropsWithChildren<{ className?: string }>) {
  const theme = useAppTheme()
  const themeVariant = resolveThemeVariant(theme)

  useEffect(() => {
    applyThemeVariant(themeVariant)
    const root = document.documentElement
    root.classList.add('ui-identity')
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'light' ? '#FBFAF7' : '#111214')
    return () => {
      root.classList.remove('ui-identity')
      applyThemeVariant(resolveThemeVariant(theme))
    }
  }, [theme, themeVariant])

  return <main className={[
    'auth-screen',
    'auth-entry',
    'ui-identity auth-flow-identity',
    themeVariantClass(themeVariant),
    className,
  ].filter(Boolean).join(' ')}>{children}</main>
}

export function AuthPage() {
  const location = useLocation()
  const returnTo = (location.state as { from?: string } | null)?.from
  const [mode, setMode] = useState<Mode>('login')
  const [busy, setBusy] = useState(false)
  const [yandexBusy, setYandexBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [role, setRole] = useState<AccountRole>(returnTo?.startsWith('/join') ? 'client' : 'trainer')
  const { actor } = useAuth()
  const yandexPilotConfig = getYandexIdPilotConfig()
  if (actor) return <Navigate to={returnTo ?? (actor.role === 'client' ? '/me' : trainerHomePath())} replace />

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(null)
    const values = new FormData(event.currentTarget)
    try {
      if (mode === 'login') await authRepository.signIn(String(values.get('email')), String(values.get('password')))
      else {
        await authRepository.signUp(String(values.get('email')), String(values.get('password')), String(values.get('firstName')), role)
      }
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Не удалось войти') }
    finally { setBusy(false) }
  }

  return <AuthIdentityScreen>
    <header className="auth-entry-head">
      <div className="brand" aria-hidden="true">FIT</div>
      <p className="eyebrow">ВАШ РАБОЧИЙ ПРОЦЕСС</p>
      <h1>{mode === 'login' ? 'Вход' : 'Регистрация'}</h1>
      <p className="muted">{mode === 'register' && role === 'client' ? 'Следите за своими тренировками и прогрессом.' : 'Планируйте тренировки и следите за прогрессом клиентов.'}</p>
    </header>
    <form className="stack auth-form" onSubmit={(event) => void submit(event)}>
      {mode === 'register' && <>
        <Field label="Тип аккаунта"><select value={role} onChange={(event) => setRole(event.target.value as AccountRole)}>
          <option value="trainer">Я тренер</option><option value="client">Я клиент</option>
        </select></Field>
        <Field label="Имя"><input name="firstName" minLength={2} autoComplete="given-name" required /></Field>
      </>}
      <Field label="Email"><input name="email" type="email" autoComplete="email" required /></Field>
      <Field label="Пароль"><input name="password" type="password" minLength={8} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required /></Field>
      {error && <p className="error" role="alert">{error}</p>}
      <button className="primary" disabled={busy}>{busy ? 'Подождите…' : mode === 'login' ? 'Войти' : 'Создать аккаунт'}</button>
    </form>
    <button className="secondary auth-google" onClick={() => void authRepository.signInWithGoogle(mode === 'register' ? role : 'trainer')}>Продолжить с Google</button>
    {yandexPilotConfig && <button className="secondary auth-yandex" disabled={yandexBusy} onClick={() => {
      setError(null); setYandexBusy(true)
      const redirectUri = `${window.location.origin}/auth/yandex/callback`
      void createYandexAuthorizationUrl(yandexPilotConfig.clientId, redirectUri)
        .then((url) => window.location.assign(url))
        .catch(() => { setError('Не удалось начать вход через Yandex ID.'); setYandexBusy(false) })
    }}>{yandexBusy ? 'Переходим в Yandex ID…' : 'Проверить Yandex ID'}</button>}
    <div className="auth-links"><button className="link" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>{mode === 'login' ? 'Создать аккаунт' : 'У меня есть аккаунт'}</button>{mode === 'login' && <Link to="/auth/forgot">Забыли пароль?</Link>}</div>
  </AuthIdentityScreen>
}

export function YandexPilotCallbackPage() {
  const [intent] = useState(() => peekPendingYandexAuthorizationIntent())
  return intent === 'link'
    ? <YandexAccountLinkingCallbackPage />
    : <YandexReadOnlyPilotCallbackPage />
}

function YandexReadOnlyPilotCallbackPage() {
  const config = getYandexIdPilotConfig()
  const apiBaseUrl = config?.apiBaseUrl ?? null
  const [session, setSession] = useState<YandexPilotSession | null>(null)
  const [clients, setClients] = useState<YandexPilotClient[] | null>(null)
  const [clientsLoading, setClientsLoading] = useState(false)
  const [clientsError, setClientsError] = useState<Error | null>(null)
  const [connections, setConnections] = useState<YandexPilotConnectionsData | null>(null)
  const [connectionsLoading, setConnectionsLoading] = useState(false)
  const [connectionsError, setConnectionsError] = useState<Error | null>(null)
  const [trainingData, setTrainingData] = useState<YandexPilotTrainingDataState | null>(null)
  const [trainingDataLoading, setTrainingDataLoading] = useState(false)
  const [trainingDataError, setTrainingDataError] = useState<Error | null>(null)
  const [error, setError] = useState<string | null>(null)
  const sessionRequest = useRef<Promise<YandexPilotSession> | null>(null)

  async function loadClients(targetApiBaseUrl: string, sessionToken: string): Promise<void> {
    setClientsLoading(true)
    setClientsError(null)
    try {
      setClients(await yandexPilotRepository.listClients(targetApiBaseUrl, sessionToken))
    } catch (caught) {
      setClientsError(caught instanceof Error ? caught : new Error('Не удалось загрузить клиентов.'))
    } finally {
      setClientsLoading(false)
    }
  }

  async function loadConnections(targetApiBaseUrl: string, sessionToken: string): Promise<void> {
    setConnectionsLoading(true)
    setConnectionsError(null)
    try {
      setConnections(await yandexPilotRepository.listConnections(targetApiBaseUrl, sessionToken))
    } catch (caught) {
      setConnectionsError(caught instanceof Error ? caught : new Error('Не удалось загрузить связи.'))
    } finally {
      setConnectionsLoading(false)
    }
  }

  async function loadTrainingData(targetApiBaseUrl: string, sessionToken: string): Promise<void> {
    setTrainingDataLoading(true)
    setTrainingDataError(null)
    try {
      setTrainingData(await yandexPilotRepository.listTrainingData(targetApiBaseUrl, sessionToken))
    } catch (caught) {
      setTrainingDataError(caught instanceof Error ? caught : new Error('Не удалось загрузить тренировки.'))
    } finally {
      setTrainingDataLoading(false)
    }
  }

  async function refreshPilotData(): Promise<void> {
    if (session === null || apiBaseUrl === null) return
    await Promise.all([
      loadClients(apiBaseUrl, session.session.token),
      loadConnections(apiBaseUrl, session.session.token),
      loadTrainingData(apiBaseUrl, session.session.token),
    ])
  }

  async function refreshPilotDataInBackground(): Promise<void> {
    if (session === null || apiBaseUrl === null) return
    const [clientsResult, connectionsResult, trainingDataResult] = await Promise.allSettled([
      yandexPilotRepository.listClients(apiBaseUrl, session.session.token),
      yandexPilotRepository.listConnections(apiBaseUrl, session.session.token),
      yandexPilotRepository.listTrainingData(apiBaseUrl, session.session.token),
    ])
    if (clientsResult.status === 'fulfilled') {
      setClients(clientsResult.value)
      setClientsError(null)
    }
    if (connectionsResult.status === 'fulfilled') {
      setConnections(connectionsResult.value)
      setConnectionsError(null)
    }
    if (trainingDataResult.status === 'fulfilled') {
      setTrainingData(trainingDataResult.value)
      setTrainingDataError(null)
    }
  }

  useYandexPilotPolling(session !== null && apiBaseUrl !== null, refreshPilotDataInBackground)

  useEffect(() => {
    if (apiBaseUrl === null) return
    const targetApiBaseUrl = apiBaseUrl
    const search = window.location.search
    window.history.replaceState(null, '', window.location.pathname)
    let cancelled = false
    async function verify() {
      try {
        sessionRequest.current ??= Promise.resolve().then(() => {
          const authorization = consumeYandexAuthorizationCallback(search)
          return yandexPilotRepository.exchangeCodeForSession(
            targetApiBaseUrl,
            authorization.code,
            authorization.codeVerifier,
          )
        })
        const result = await sessionRequest.current
        if (cancelled) return
        setSession(result)
        setClientsLoading(true)
        setConnectionsLoading(true)
        setTrainingDataLoading(true)
        const [clientsResult, connectionsResult, trainingDataResult] = await Promise.allSettled([
          yandexPilotRepository.listClients(targetApiBaseUrl, result.session.token),
          yandexPilotRepository.listConnections(targetApiBaseUrl, result.session.token),
          yandexPilotRepository.listTrainingData(targetApiBaseUrl, result.session.token),
        ])
        if (cancelled) return
        if (clientsResult.status === 'fulfilled') setClients(clientsResult.value)
        else setClientsError(clientsResult.reason instanceof Error
          ? clientsResult.reason
          : new Error('Не удалось загрузить клиентов.'))
        if (connectionsResult.status === 'fulfilled') setConnections(connectionsResult.value)
        else setConnectionsError(connectionsResult.reason instanceof Error
          ? connectionsResult.reason
          : new Error('Не удалось загрузить связи.'))
        if (trainingDataResult.status === 'fulfilled') setTrainingData(trainingDataResult.value)
        else setTrainingDataError(trainingDataResult.reason instanceof Error
          ? trainingDataResult.reason
          : new Error('Не удалось загрузить тренировки.'))
        setClientsLoading(false)
        setConnectionsLoading(false)
        setTrainingDataLoading(false)
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : 'Не удалось проверить Yandex ID.')
      }
    }
    void verify()
    return () => { cancelled = true }
  }, [apiBaseUrl])

  if (config === null) return <Navigate to="/auth" replace />
  const fullName = session === null
    ? ''
    : [session.profile.firstName, session.profile.lastName].filter(Boolean).join(' ') || 'Пользователь FIT'
  return <AuthIdentityScreen className="auth-pilot-flow">
    <header className="auth-entry-head">
      <div className="brand" aria-hidden="true">FIT</div>
      <p className="eyebrow">YANDEX ID · ПИЛОТ</p>
      <h1>{session ? 'Доступ подтверждён' : error ? 'Не удалось войти' : 'Проверяем доступ'}</h1>
      <p className="muted">{session
        ? 'Yandex ID связан с тестовым профилем. В пилоте можно управлять связями и приглашениями.'
        : error ?? 'Проверяем Yandex ID и доступ к изолированному stage…'}</p>
    </header>
    {session && <section className="compact stack yandex-pilot-profile" aria-label="Профиль пилота">
      <div><span>Профиль</span><strong>{fullName}</strong></div>
      <div><span>Роль</span><strong>{session.profile.accountRole === 'trainer' ? 'Тренер' : 'Клиент'}</strong></div>
      <div><span>Режим</span><strong>Ограниченный пилот</strong></div>
    </section>}
    {session?.profile.accountRole === 'trainer' && <section className="yandex-pilot-clients" aria-labelledby="yandex-pilot-clients-title">
      <div className="yandex-pilot-section-head">
        <h2 id="yandex-pilot-clients-title">Клиенты</h2>
      </div>
      <AsyncView
        loading={clientsLoading}
        error={clientsError}
        empty={clients !== null && clients.length === 0}
        onRetry={() => void loadClients(config.apiBaseUrl, session.session.token)}
        emptyTitle="В stage пока нет клиентов"
        emptyDescription="Список появится после переноса данных этого тренера."
      >
        <div className="cards yandex-pilot-clients-list">
          {clients?.map((client) => <article className="card yandex-pilot-client" key={client.id}>
            <span className="client-avatar" aria-hidden="true"><ProfileIcon /></span>
            <div>
              <strong>{client.fullName}</strong>
              <p>{pilotClientSummary(client)}</p>
            </div>
          </article>)}
        </div>
      </AsyncView>
    </section>}
    {session && <YandexPilotTrainingData
      data={trainingData}
      error={trainingDataError}
      loading={trainingDataLoading}
      onRetry={() => void loadTrainingData(config.apiBaseUrl, session.session.token)}
    />}
    {session && <YandexPilotConnections
      apiBaseUrl={config.apiBaseUrl}
      clients={clients}
      connections={connections}
      error={connectionsError}
      loading={connectionsLoading}
      onRefresh={refreshPilotData}
      session={session}
    />}
    <Link className="auth-back-link" to="/auth">Вернуться ко входу</Link>
  </AuthIdentityScreen>
}

function YandexAccountLinkingCallbackPage() {
  const { actor, loading } = useAuth()
  const config = actor === null ? null : getYandexSessionLinkingConfig(actor.userId)
  const apiBaseUrl = config?.apiBaseUrl ?? null
  const clientId = config?.clientId ?? null
  const [linked, setLinked] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [restartBusy, setRestartBusy] = useState(false)
  const linkRequest = useRef<Promise<void> | null>(null)
  const profilePath = actor?.role === 'client' ? '/me/profile' : '/profile'

  async function restartLinking(): Promise<void> {
    if (clientId === null) return
    setRestartBusy(true)
    setError(null)
    try {
      const redirectUri = `${window.location.origin}/auth/yandex/callback`
      const url = await createYandexAuthorizationUrl(clientId, redirectUri, sessionStorage, 'link')
      window.location.assign(url)
    } catch {
      setError('Не удалось начать привязку Yandex ID. Попробуйте ещё раз из профиля.')
      setRestartBusy(false)
    }
  }

  useEffect(() => {
    if (loading) return
    const search = window.location.search
    window.history.replaceState(null, '', window.location.pathname)
    let cancelled = false

    async function linkAccount(): Promise<void> {
      try {
        if (actor === null) {
          clearPendingYandexAuthorization()
          throw new Error('Войдите в FIT по email, паролю или Google, затем начните привязку Yandex ID из профиля.')
        }
        if (apiBaseUrl === null) {
          clearPendingYandexAuthorization()
          throw new Error('Привязка Yandex ID пока недоступна для этого аккаунта.')
        }
        linkRequest.current ??= Promise.resolve().then(async () => {
          const authorization = consumeYandexAuthorizationCallback(search)
          if (authorization.intent !== 'link') {
            throw new Error('Начните привязку Yandex ID из профиля FIT.')
          }
          const supabaseSession = await authRepository.getSession()
          if (supabaseSession.error) throw supabaseSession.error
          const supabaseAccessToken = supabaseSession.data.session?.access_token
          if (!supabaseAccessToken) {
            throw new Error('Войдите в FIT заново и повторите привязку Yandex ID.')
          }
          await yandexPilotRepository.linkYandexAccount(
            apiBaseUrl,
            supabaseAccessToken,
            authorization.code,
            authorization.codeVerifier,
          )
        })
        await linkRequest.current
        if (!cancelled) setLinked(true)
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : 'Не удалось привязать Yandex ID.')
      }
    }

    void linkAccount()
    return () => { cancelled = true }
  }, [actor, apiBaseUrl, loading])

  return <AuthIdentityScreen className="auth-yandex-link-flow">
    <header className="auth-entry-head">
      <div className="brand" aria-hidden="true">FIT</div>
      <p className="eyebrow">YANDEX ID · ПРИВЯЗКА</p>
      <h1>{linked ? 'Yandex ID привязан' : error ? 'Не удалось привязать' : 'Завершаем привязку'}</h1>
      <p className="muted">{linked
        ? 'Теперь этот Yandex ID связан с текущим FIT-профилем. Основной вход пока остаётся прежним.'
        : error ?? 'Проверяем текущую FIT-сессию и подтверждение от Yandex ID…'}</p>
    </header>
    {linked && <section className="compact stack yandex-pilot-profile yandex-link-result" aria-label="Результат привязки">
      <div><span>Статус</span><strong>Готово</strong></div>
      <div><span>Доступ</span><strong>Через rollout</strong></div>
      <p>Следующий шаг — включить полноценную Yandex ID-сессию для выбранных пользователей отдельным флагом.</p>
    </section>}
    {error && <StatePanel
      tone="error"
      title="Привязка не завершена"
      description={error}
      action={clientId === null
        ? <Link className="button secondary" to={actor ? profilePath : '/auth'}>{actor ? 'Вернуться в профиль' : 'Вернуться ко входу'}</Link>
        : <button type="button" className="secondary" aria-busy={restartBusy} disabled={restartBusy} onClick={() => void restartLinking()}>
          {restartBusy ? 'Переходим в Yandex ID…' : 'Начать заново'}
        </button>}
    />}
    <Link className="auth-back-link" to={actor ? profilePath : '/auth'}>{actor ? 'Вернуться в профиль' : 'Вернуться ко входу'}</Link>
  </AuthIdentityScreen>
}

function pilotClientSummary(client: YandexPilotClient): string {
  const details = [
    client.ageYears === null ? null : `${client.ageYears} лет`,
    client.heightCm === null ? null : `${client.heightCm} см`,
    client.goal,
  ].filter((value): value is string => value !== null && value !== '')
  return details.length > 0 ? details.join(' · ') : 'Профиль без дополнительных данных'
}

export function ForgotPasswordPage() {
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(null)
    try { await authRepository.resetPassword(String(new FormData(event.currentTarget).get('email'))); setMessage('Ссылка отправлена, если такой аккаунт существует.') }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Ошибка') }
  }
  return <AuthIdentityScreen><header className="auth-entry-head"><div className="brand" aria-hidden="true">FIT</div><p className="eyebrow">ДОСТУП К АККАУНТУ</p><h1>Восстановление пароля</h1><p className="muted">Отправим ссылку на ваш email.</p></header><form className="stack auth-form" onSubmit={(e) => void submit(e)}><Field label="Email"><input name="email" type="email" autoComplete="email" required /></Field>{error && <p className="error" role="alert">{error}</p>}{message && <p className="success" role="status">{message}</p>}<button className="primary">Отправить ссылку</button></form><Link className="auth-back-link" to="/auth">Вернуться ко входу</Link></AuthIdentityScreen>
}

export function ResetPasswordPage() {
  const navigate = useNavigate(); const [error, setError] = useState<string | null>(null)
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    try { await authRepository.updatePassword(String(new FormData(event.currentTarget).get('password'))); navigate('/') }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Ошибка') }
  }
  return <AuthIdentityScreen><header className="auth-entry-head"><div className="brand" aria-hidden="true">FIT</div><p className="eyebrow">БЕЗОПАСНОСТЬ</p><h1>Новый пароль</h1><p className="muted">Выберите новый пароль для входа в FIT.</p></header><form className="stack auth-form" onSubmit={(e) => void submit(e)}><Field label="Пароль"><input name="password" type="password" minLength={8} autoComplete="new-password" required /></Field>{error && <p className="error" role="alert">{error}</p>}<button className="primary">Сохранить</button></form></AuthIdentityScreen>
}

export function AuthCallbackPage() {
  const { loading, error, actor } = useAuth()
  if (actor) return <Navigate to={actor.role === 'client' ? '/me' : trainerHomePath()} replace />
  return <AuthIdentityScreen><header className="auth-entry-head"><div className="brand" aria-hidden="true">FIT</div><p className="eyebrow">ВХОД В АККАУНТ</p><h1>Завершаем вход</h1><p className="muted">{loading ? 'Проверяем сессию…' : error ?? 'Не удалось получить сессию.'}</p></header><Link className="auth-back-link" to="/auth">Вернуться</Link></AuthIdentityScreen>
}
