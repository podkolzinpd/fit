import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { authRepository } from '../../data/repositories/auth.repository'
import {
  yandexPilotRepository,
  type YandexPilotClient,
  type YandexPilotConnections,
  type YandexPilotSession,
} from '../../data/repositories/yandex-pilot.repository'
import { useAuth } from '../../app/auth-context'
import { getYandexIdPilotConfig, trainerHomePath } from '../../app/feature-flags'
import { ProfileIcon } from '../../shared/icons'
import { normalizeTimeZone } from '../../shared/local-date'
import { AsyncView, Field } from '../../shared/ui'
import type { AccountRole } from '../../shared/domain'
import { consumeYandexAuthorizationCallback, createYandexAuthorizationUrl } from './yandex-pilot-oauth'

type Mode = 'login' | 'register'

export function AuthPage() {
  const [mode, setMode] = useState<Mode>('login')
  const [busy, setBusy] = useState(false)
  const [yandexBusy, setYandexBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [role, setRole] = useState<AccountRole>('trainer')
  const { actor } = useAuth()
  const location = useLocation()
  const yandexPilotConfig = getYandexIdPilotConfig()
  if (actor) return <Navigate to={(location.state as { from?: string } | null)?.from ?? (actor.role === 'client' ? '/me' : trainerHomePath())} replace />

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

  return <main className="auth-screen auth-entry">
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
        <Field label="Имя"><input name="firstName" autoComplete="given-name" required /></Field>
      </>}
      <Field label="Email"><input name="email" type="email" autoComplete="email" required /></Field>
      <Field label="Пароль"><input name="password" type="password" minLength={8} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required /></Field>
      {error && <p className="error" role="alert">{error}</p>}
      <button disabled={busy}>{busy ? 'Подождите…' : mode === 'login' ? 'Войти' : 'Создать аккаунт'}</button>
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
  </main>
}

export function YandexPilotCallbackPage() {
  const config = getYandexIdPilotConfig()
  const apiBaseUrl = config?.apiBaseUrl ?? null
  const [session, setSession] = useState<YandexPilotSession | null>(null)
  const [clients, setClients] = useState<YandexPilotClient[] | null>(null)
  const [clientsLoading, setClientsLoading] = useState(false)
  const [clientsError, setClientsError] = useState<Error | null>(null)
  const [connections, setConnections] = useState<YandexPilotConnections | null>(null)
  const [connectionsLoading, setConnectionsLoading] = useState(false)
  const [connectionsError, setConnectionsError] = useState<Error | null>(null)
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
        const [clientsResult, connectionsResult] = await Promise.allSettled([
          yandexPilotRepository.listClients(targetApiBaseUrl, result.session.token),
          yandexPilotRepository.listConnections(targetApiBaseUrl, result.session.token),
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
        setClientsLoading(false)
        setConnectionsLoading(false)
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
  const connectionClientIds = connections === null
    ? []
    : [...new Set([
        ...connections.memberships.map((membership) => membership.clientId),
        ...connections.invitations.map((invitation) => invitation.clientId),
      ])]
  return <main className="auth-screen auth-entry">
    <header className="auth-entry-head">
      <div className="brand" aria-hidden="true">FIT</div>
      <p className="eyebrow">YANDEX ID · ПИЛОТ</p>
      <h1>{session ? 'Доступ подтверждён' : error ? 'Не удалось войти' : 'Проверяем доступ'}</h1>
      <p className="muted">{session
        ? 'Yandex ID связан с тестовым профилем. Данные открыты только для чтения.'
        : error ?? 'Проверяем Yandex ID и доступ к изолированному stage…'}</p>
    </header>
    {session && <section className="compact stack yandex-pilot-profile" aria-label="Профиль пилота">
      <div><span>Профиль</span><strong>{fullName}</strong></div>
      <div><span>Роль</span><strong>{session.profile.accountRole === 'trainer' ? 'Тренер' : 'Клиент'}</strong></div>
      <div><span>Режим</span><strong>Только чтение</strong></div>
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
    {session && <section className="yandex-pilot-connections" aria-labelledby="yandex-pilot-connections-title">
      <div className="yandex-pilot-section-head">
        <h2 id="yandex-pilot-connections-title">Связи и приглашения</h2>
      </div>
      <AsyncView
        loading={connectionsLoading}
        error={connectionsError}
        empty={connections !== null && connectionClientIds.length === 0}
        onRetry={() => void loadConnections(config.apiBaseUrl, session.session.token)}
        emptyTitle="В stage пока нет связей"
        emptyDescription="Они появятся после переноса memberships и активных приглашений."
      >
        <div className="cards yandex-pilot-connections-list">
          {connectionClientIds.map((clientId) => {
            const client = clients?.find((candidate) => candidate.id === clientId)
            const memberships = connections?.memberships.filter((item) => item.clientId === clientId) ?? []
            const invitations = connections?.invitations.filter((item) => item.clientId === clientId) ?? []
            return <article className="card yandex-pilot-connection" key={clientId}>
              <div>
                <strong>{client?.fullName ?? 'Клиент'}</strong>
                <p>{memberships.length === 0 ? 'Подключённых тренеров нет' : memberships.map((membership) => {
                  const trainerName = [membership.firstName, membership.lastName].filter(Boolean).join(' ') || 'Тренер'
                  return `${trainerName} · ${membership.isRoot ? 'основной' : 'подключённый'}`
                }).join('; ')}</p>
              </div>
              {invitations.map((invitation) => <p className="yandex-pilot-invitation" key={invitation.id}>
                Активное приглашение для {invitation.targetRole === 'trainer' ? 'тренера' : 'клиента'} до{' '}
                {new Date(invitation.expiresAt).toLocaleDateString('ru-RU', { timeZone: normalizeTimeZone(session.profile.timezone) })}
              </p>)}
            </article>
          })}
        </div>
      </AsyncView>
    </section>}
    <Link className="auth-back-link" to="/auth">Вернуться ко входу</Link>
  </main>
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
  return <main className="auth-screen auth-entry"><header className="auth-entry-head"><div className="brand" aria-hidden="true">FIT</div><p className="eyebrow">ДОСТУП К АККАУНТУ</p><h1>Восстановление пароля</h1><p className="muted">Отправим ссылку на ваш email.</p></header><form className="stack auth-form" onSubmit={(e) => void submit(e)}><Field label="Email"><input name="email" type="email" autoComplete="email" required /></Field>{error && <p className="error">{error}</p>}{message && <p className="success">{message}</p>}<button>Отправить ссылку</button></form><Link className="auth-back-link" to="/auth">Вернуться ко входу</Link></main>
}

export function ResetPasswordPage() {
  const navigate = useNavigate(); const [error, setError] = useState<string | null>(null)
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    try { await authRepository.updatePassword(String(new FormData(event.currentTarget).get('password'))); navigate('/') }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Ошибка') }
  }
  return <main className="auth-screen auth-entry"><header className="auth-entry-head"><div className="brand" aria-hidden="true">FIT</div><p className="eyebrow">БЕЗОПАСНОСТЬ</p><h1>Новый пароль</h1><p className="muted">Выберите новый пароль для входа в FIT.</p></header><form className="stack auth-form" onSubmit={(e) => void submit(e)}><Field label="Пароль"><input name="password" type="password" minLength={8} autoComplete="new-password" required /></Field>{error && <p className="error">{error}</p>}<button>Сохранить</button></form></main>
}

export function AuthCallbackPage() {
  const { loading, error, actor } = useAuth()
  if (actor) return <Navigate to={actor.role === 'client' ? '/me' : trainerHomePath()} replace />
  return <main className="auth-screen auth-entry"><header className="auth-entry-head"><div className="brand" aria-hidden="true">FIT</div><p className="eyebrow">ВХОД В АККАУНТ</p><h1>Завершаем вход</h1><p className="muted">{loading ? 'Проверяем сессию…' : error ?? 'Не удалось получить сессию.'}</p></header><Link className="auth-back-link" to="/auth">Вернуться</Link></main>
}
