import { useEffect, useMemo, useRef, useState, type FormEvent, type PropsWithChildren } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { authRepository } from '../../data/repositories/auth.repository'
import {
  yandexPilotRepository,
  type YandexPilotClient,
  type YandexPilotConnections as YandexPilotConnectionsData,
  type YandexAppSession,
  type YandexPilotSession,
  type YandexPilotTrainingData as YandexPilotTrainingDataState,
} from '../../data/repositories/yandex-pilot.repository'
import { useAuth } from '../../app/auth-context'
import {
  getYandexAppSessionEntryConfig,
  getYandexIdPilotConfig,
  getYandexNativeRegistrationConfig,
  getYandexSessionLinkingConfig,
  isYandexAppSessionEnabled,
  trainerHomePath,
} from '../../app/feature-flags'
import { useYandexAppSession } from '../../app/yandex-app-session-context'
import { applyThemeVariant, resolveThemeVariant, themeVariantClass, useAppTheme } from '../../app/theme'
import { ProfileIcon } from '../../shared/icons'
import { AsyncView, Field, StatePanel } from '../../shared/ui'
import type { AccountRole } from '../../shared/domain'
import { LEGAL_PATHS, PRIVACY_VERSION, TERMS_VERSION } from '../../shared/legal'
import { systemTimeZone } from '../../shared/local-date'
import {
  clearPendingYandexNativeRegistration,
  clearPendingYandexAuthorization,
  consumeYandexAuthorizationCallback,
  createYandexAuthorizationUrl,
  peekPendingYandexAuthorizationIntent,
  readPendingYandexNativeRegistration,
  savePendingYandexNativeRegistration,
} from './yandex-pilot-oauth'
import { YandexPilotConnections } from './YandexPilotConnections'
import { YandexPilotTrainingData } from './YandexPilotTrainingData'
import { useYandexPilotPolling } from './use-yandex-pilot-polling'

type Mode = 'login' | 'register'
type RegistrationMethod = 'yandex' | 'email'

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
  const nativeRegistrationConfig = getYandexNativeRegistrationConfig()
  const [mode, setMode] = useState<Mode>('login')
  const [registrationMethod, setRegistrationMethod] = useState<RegistrationMethod>(
    nativeRegistrationConfig === null ? 'email' : 'yandex',
  )
  const [firstName, setFirstName] = useState('')
  const [busy, setBusy] = useState(false)
  const [yandexBusy, setYandexBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [role, setRole] = useState<AccountRole>(returnTo?.startsWith('/join') ? 'client' : 'trainer')
  const { actor } = useAuth()
  const yandexAppSession = useYandexAppSession()
  const yandexAppSessionConfig = getYandexAppSessionEntryConfig()
  const yandexPilotConfig = getYandexIdPilotConfig()
  if (actor) return <Navigate to={returnTo ?? (actor.role === 'client' ? '/me' : trainerHomePath())} replace />
  if (yandexAppSession.loading) return <AuthIdentityScreen>
    <StatePanel tone="info" title="Восстанавливаем сессию" description="Проверяем действующую сессию Yandex ID…" />
  </AuthIdentityScreen>
  if (yandexAppSession.session) return <Navigate to="/auth/yandex/session" replace />

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(null)
    const values = new FormData(event.currentTarget)
    if (mode === 'register' && registrationMethod === 'yandex') {
      if (nativeRegistrationConfig === null) {
        setError('Регистрация через Yandex ID пока недоступна.')
        return
      }
      setYandexBusy(true)
      savePendingYandexNativeRegistration({
        accountRole: role,
        firstName,
        timezone: systemTimeZone(),
        termsVersion: TERMS_VERSION,
        privacyVersion: PRIVACY_VERSION,
      })
      try {
        const url = await createYandexAuthorizationUrl(
          nativeRegistrationConfig.clientId,
          `${window.location.origin}/auth/yandex/callback`,
          sessionStorage,
          'register',
        )
        window.location.assign(url)
      } catch {
        setError('Не удалось начать регистрацию через Yandex ID.')
        setYandexBusy(false)
      }
      return
    }
    setBusy(true)
    try {
      if (mode === 'login') await authRepository.signIn(String(values.get('email')), String(values.get('password')))
      else await authRepository.signUp(String(values.get('email')), String(values.get('password')), firstName, role)
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
        <Field label="Имя"><input name="firstName" minLength={2} maxLength={120} autoComplete="given-name" required value={firstName} onChange={(event) => setFirstName(event.target.value)} /></Field>
      </>}
      {(mode === 'login' || registrationMethod === 'email') && <>
        <Field label="Email"><input name="email" type="email" autoComplete="email" required /></Field>
        <Field label="Пароль"><input name="password" type="password" minLength={8} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required /></Field>
      </>}
      {error && <p className="error" role="alert">{error}</p>}
      <button className="primary" disabled={busy || yandexBusy} aria-busy={busy || yandexBusy}>{busy || yandexBusy
        ? 'Подождите…'
        : mode === 'login'
          ? 'Войти'
          : registrationMethod === 'yandex'
            ? 'Создать через Yandex ID'
            : 'Создать аккаунт'}</button>
    </form>
    {mode === 'register' && <p className="auth-consent">Создавая аккаунт, вы принимаете <Link to={LEGAL_PATHS.terms}>Условия использования</Link> и <Link to={LEGAL_PATHS.privacy}>Политику конфиденциальности</Link>.</p>}
    {mode === 'login' && (yandexAppSessionConfig ?? yandexPilotConfig) && <button className="secondary auth-yandex" disabled={yandexBusy} onClick={() => {
      setError(null); setYandexBusy(true)
      const redirectUri = `${window.location.origin}/auth/yandex/callback`
      const config = yandexAppSessionConfig ?? yandexPilotConfig
      if (config === null) return
      void createYandexAuthorizationUrl(
        config.clientId,
        redirectUri,
        sessionStorage,
        yandexAppSessionConfig === null ? 'pilot' : 'app',
      )
        .then((url) => window.location.assign(url))
        .catch(() => { setError('Не удалось начать вход через Yandex ID.'); setYandexBusy(false) })
    }}>{yandexBusy
        ? 'Переходим в Yandex ID…'
        : yandexAppSessionConfig === null ? 'Проверить Yandex ID' : 'Войти через Yandex ID'}</button>}
    {yandexAppSession.error && <div className="stack" role="alert">
      <p className="error">{yandexAppSession.error}</p>
      <div className="stack">
        <button className="secondary" type="button" onClick={() => void yandexAppSession.retry()}>Повторить проверку</button>
        <button className="link" type="button" onClick={yandexAppSession.reset}>Сбросить сессию Yandex ID</button>
      </div>
    </div>}
    <div className="auth-links">
      <button className="link" onClick={() => {
        const nextMode = mode === 'login' ? 'register' : 'login'
        setMode(nextMode)
        setError(null)
        if (nextMode === 'register') {
          setRegistrationMethod(nativeRegistrationConfig === null ? 'email' : 'yandex')
        }
      }}>{mode === 'login' ? 'Создать аккаунт' : 'У меня есть аккаунт'}</button>
      {mode === 'register' && nativeRegistrationConfig !== null && <button className="link" type="button" onClick={() => {
        setRegistrationMethod(registrationMethod === 'yandex' ? 'email' : 'yandex')
        setError(null)
      }}>{registrationMethod === 'yandex' ? 'Создать по email' : 'Создать через Yandex ID'}</button>}
      {mode === 'login' && <Link to="/auth/forgot">Забыли пароль?</Link>}
    </div>
    <nav className="auth-legal-links" aria-label="Юридическая информация"><Link to={LEGAL_PATHS.terms}>Условия использования</Link><Link to={LEGAL_PATHS.privacy}>Конфиденциальность</Link></nav>
  </AuthIdentityScreen>
}

export function YandexPilotCallbackPage() {
  const [intent] = useState(() => peekPendingYandexAuthorizationIntent())
  return intent === 'link'
    ? <YandexAccountLinkingCallbackPage />
    : intent === 'app'
      ? <YandexAppSessionCallbackPage />
      : intent === 'register'
        ? <YandexNativeRegistrationCallbackPage />
        : <YandexReadOnlyPilotCallbackPage />
}

function YandexNativeRegistrationCallbackPage() {
  const navigate = useNavigate()
  const { establish } = useYandexAppSession()
  const config = useMemo(() => getYandexNativeRegistrationConfig(), [])
  const [registration] = useState(() => readPendingYandexNativeRegistration())
  const [callbackSearch] = useState(() => window.location.search)
  const [error, setError] = useState<string | null>(null)
  const [refreshRegistration, setRefreshRegistration] = useState(false)
  const [restartBusy, setRestartBusy] = useState(false)
  const registrationRequest = useRef<Promise<YandexAppSession> | null>(null)

  useEffect(() => {
    window.history.replaceState(null, '', window.location.pathname)
  }, [])

  useEffect(() => {
    if (config === null || registration === null) return
    const registrationConfig = config
    const registrationDraft = registration
    let cancelled = false

    async function register(): Promise<void> {
      try {
        registrationRequest.current ??= Promise.resolve().then(() => {
          const authorization = consumeYandexAuthorizationCallback(callbackSearch)
          if (authorization.intent !== 'register') {
            throw new Error('Начните регистрацию через Yandex ID заново.')
          }
          return yandexPilotRepository.registerYandexAccount(
            registrationConfig.apiBaseUrl,
            authorization.code,
            authorization.codeVerifier,
            registrationDraft,
          )
        })
        const result = await registrationRequest.current
        if (cancelled) return
        clearPendingYandexNativeRegistration()
        establish(result)
        navigate('/auth/yandex/session', { replace: true })
      } catch (caught) {
        if (!cancelled) {
          if (caught instanceof Error
            && caught.name === 'YandexNativeRegistrationRefreshRequiredError') {
            clearPendingYandexNativeRegistration()
            setRefreshRegistration(true)
          }
          setError(caught instanceof Error ? caught.message : 'Не удалось создать аккаунт через Yandex ID.')
        }
      }
    }

    void register()
    return () => { cancelled = true }
  }, [callbackSearch, config, establish, navigate, registration])

  async function restart(): Promise<void> {
    if (config === null || registration === null) return
    setRestartBusy(true)
    setError(null)
    clearPendingYandexAuthorization()
    savePendingYandexNativeRegistration(registration)
    try {
      const url = await createYandexAuthorizationUrl(
        config.clientId,
        `${window.location.origin}/auth/yandex/callback`,
        sessionStorage,
        'register',
      )
      window.location.assign(url)
    } catch {
      setError('Не удалось начать регистрацию через Yandex ID.')
      setRestartBusy(false)
    }
  }

  if (config === null) return <Navigate to="/auth" replace />
  const visibleError = registration === null
    ? 'Данные регистрации не найдены. Заполните форму заново.'
    : error
  return <AuthIdentityScreen>
    <header className="auth-entry-head">
      <div className="brand" aria-hidden="true">FIT</div>
      <p className="eyebrow">YANDEX ID</p>
      <h1>{visibleError ? 'Не удалось зарегистрироваться' : 'Создаём аккаунт'}</h1>
      <p className="muted">{visibleError ?? 'Подтверждаем Yandex ID и готовим защищённый профиль FIT…'}</p>
    </header>
    {visibleError && <StatePanel
      tone="error"
      title="Аккаунт не создан"
      description={visibleError}
      action={registration === null || refreshRegistration
        ? <Link reloadDocument to="/auth">Обновить регистрацию</Link>
        : <button type="button" className="primary" aria-busy={restartBusy} disabled={restartBusy} onClick={() => void restart()}>
          {restartBusy ? 'Переходим в Yandex ID…' : 'Начать заново'}
        </button>}
    />}
  </AuthIdentityScreen>
}

function YandexAppSessionCallbackPage() {
  const navigate = useNavigate()
  const { actor, loading: authLoading } = useAuth()
  const { establish } = useYandexAppSession()
  const config = useMemo(() => getYandexAppSessionEntryConfig(), [])
  const [error, setError] = useState<string | null>(null)
  const sessionRequest = useRef<Promise<YandexAppSession> | null>(null)

  useEffect(() => {
    if (authLoading || config === null) return
    const apiBaseUrl = config.apiBaseUrl
    const search = window.location.search
    window.history.replaceState(null, '', window.location.pathname)
    let cancelled = false

    async function openSession(): Promise<void> {
      try {
        sessionRequest.current ??= Promise.resolve().then(() => {
          const authorization = consumeYandexAuthorizationCallback(search)
          if (authorization.intent !== 'app') throw new Error('Начните вход через Yandex ID заново.')
          return yandexPilotRepository.exchangeCodeForAppSession(
            apiBaseUrl,
            authorization.code,
            authorization.codeVerifier,
          )
        })
        const result = await sessionRequest.current
        if (actor !== null && result.profile.id !== actor.userId) {
          try {
            await yandexPilotRepository.revokeAppSession(apiBaseUrl, result.session.token)
          } catch {
            // Несовпавшая сессия никогда не сохраняется в browser storage.
          }
          throw new Error('Yandex ID связан с другим FIT-профилем. Войдите в соответствующий аккаунт или используйте другой Yandex ID.')
        }
        if (cancelled) return
        establish(result)
        navigate(actor === null ? '/auth/yandex/session' : '/assistant', { replace: true })
      } catch (caught) {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : 'Не удалось открыть сессию Yandex ID.')
        }
      }
    }

    void openSession()
    return () => { cancelled = true }
  }, [actor, authLoading, config, establish, navigate])

  if (config === null) return <Navigate to="/auth" replace />
  return <AuthIdentityScreen>
    <header className="auth-entry-head">
      <div className="brand" aria-hidden="true">FIT</div>
      <p className="eyebrow">YANDEX ID</p>
      <h1>{error ? 'Не удалось войти' : 'Проверяем вход'}</h1>
      <p className="muted">{error ?? 'Подтверждаем профиль и создаём защищённую сессию FIT…'}</p>
    </header>
    {error && <StatePanel
      tone="error"
      title="Сессия не создана"
      description={error}
      action={<Link to="/auth">Вернуться ко входу</Link>}
    />}
  </AuthIdentityScreen>
}

export function YandexAppSessionPage() {
  const navigate = useNavigate()
  const { actor, loading: authLoading } = useAuth()
  const { session, loading, error, retry, reset, signOut } = useYandexAppSession()
  const [signingOut, setSigningOut] = useState(false)
  const config = getYandexAppSessionEntryConfig()

  if (config === null) return <Navigate to="/auth" replace />
  if (authLoading || loading) return <AuthIdentityScreen>
    <StatePanel tone="info" title="Восстанавливаем сессию" description="Проверяем действующую сессию Yandex ID…" />
  </AuthIdentityScreen>
  if (actor !== null) {
    return <Navigate to={actor.role === 'client' ? '/me' : trainerHomePath()} replace />
  }
  if (error && session === null) return <AuthIdentityScreen>
    <StatePanel
      tone="error"
      title="Не удалось восстановить сессию"
      description={error}
      action={<div className="stack">
        <button className="primary" type="button" onClick={() => void retry()}>Повторить</button>
        <button className="secondary" type="button" onClick={reset}>Сбросить сессию Yandex ID</button>
      </div>}
    />
  </AuthIdentityScreen>
  if (session === null) return <Navigate to="/auth" replace />

  const fullName = [session.profile.firstName, session.profile.lastName]
    .filter(Boolean).join(' ') || 'Пользователь FIT'
  const expiresAt = new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(session.session.expiresAt))

  return <AuthIdentityScreen>
    <header className="auth-entry-head">
      <div className="brand" aria-hidden="true">FIT</div>
      <p className="eyebrow">YANDEX ID · ПИЛОТ</p>
      <h1>Сессия работает</h1>
      <p className="muted">Вход восстановится после перезагрузки страницы и завершится автоматически в указанный срок.</p>
    </header>
    <section className="compact stack yandex-pilot-profile" aria-label="Профиль Yandex ID">
      <div><span>Профиль</span><strong>{fullName}</strong></div>
      <div><span>Роль</span><strong>{session.profile.accountRole === 'trainer' ? 'Тренер' : 'Клиент'}</strong></div>
      <div><span>Сессия до</span><strong>{expiresAt}</strong></div>
    </section>
    <StatePanel
      tone="info"
      compact
      title="Основной интерфейс пока не переключён"
      description="Эта проверка подтверждает полноценную Yandex ID-сессию. Подключение вкладок к Yandex API будет отдельным безопасным этапом."
    />
    <button className="primary" type="button" disabled={signingOut} onClick={() => {
      setSigningOut(true)
      void signOut().finally(() => navigate('/auth', { replace: true }))
    }}>{signingOut ? 'Завершаем сессию…' : 'Выйти из Yandex ID'}</button>
  </AuthIdentityScreen>
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
  const { establish } = useYandexAppSession()
  const queryClient = useQueryClient()
  const config = actor === null ? null : getYandexSessionLinkingConfig()
  const apiBaseUrl = config?.apiBaseUrl ?? null
  const clientId = config?.clientId ?? null
  const [linked, setLinked] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [restartBusy, setRestartBusy] = useState(false)
  const linkRequest = useRef<Promise<void> | null>(null)
  const homePath = actor?.role === 'client' ? '/me' : trainerHomePath()

  async function restartLinking(): Promise<void> {
    if (clientId === null) return
    setRestartBusy(true)
    setError(null)
    try {
      const redirectUri = `${window.location.origin}/auth/yandex/callback`
      const url = await createYandexAuthorizationUrl(clientId, redirectUri, sessionStorage, 'link')
      window.location.assign(url)
    } catch {
      setError('Не удалось начать привязку Yandex ID. Попробуйте ещё раз с главной.')
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
          throw new Error('Войдите в FIT по email и паролю, затем начните привязку Yandex ID с главной.')
        }
        if (apiBaseUrl === null) {
          clearPendingYandexAuthorization()
          throw new Error('Привязка Yandex ID пока недоступна для этого аккаунта.')
        }
        linkRequest.current ??= Promise.resolve().then(async () => {
          const authorization = consumeYandexAuthorizationCallback(search)
          if (authorization.intent !== 'link') {
            throw new Error('Начните привязку Yandex ID с главной FIT.')
          }
          const supabaseSession = await authRepository.getSession()
          if (supabaseSession.error) throw supabaseSession.error
          const supabaseAccessToken = supabaseSession.data.session?.access_token
          if (!supabaseAccessToken) {
            throw new Error('Войдите в FIT заново и повторите привязку Yandex ID.')
          }
          const result = await yandexPilotRepository.linkYandexAccount(
            apiBaseUrl,
            supabaseAccessToken,
            authorization.code,
            authorization.codeVerifier,
          )
          if (result.appSession !== undefined
            && result.profileId === actor.userId
            && result.appSession.profile.id === actor.userId
            && isYandexAppSessionEnabled()) {
            establish(result.appSession)
          }
        })
        await linkRequest.current
        if (!cancelled) {
          queryClient.setQueryData(
            ['yandex-account-link-status', actor.userId],
            { linked: true },
          )
          setLinked(true)
        }
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : 'Не удалось привязать Yandex ID.')
      }
    }

    void linkAccount()
    return () => { cancelled = true }
  }, [actor, apiBaseUrl, establish, loading, queryClient])

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
        ? <Link className="button secondary" to={actor ? homePath : '/auth'}>{actor ? 'Вернуться на главную' : 'Вернуться ко входу'}</Link>
        : <button type="button" className="secondary" aria-busy={restartBusy} disabled={restartBusy} onClick={() => void restartLinking()}>
          {restartBusy ? 'Переходим в Yandex ID…' : 'Начать заново'}
        </button>}
    />}
    <Link className="auth-back-link" to={actor ? homePath : '/auth'}>{actor ? 'Вернуться на главную' : 'Вернуться ко входу'}</Link>
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
