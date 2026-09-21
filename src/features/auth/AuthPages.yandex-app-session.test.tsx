import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthPage, YandexAppSessionPage, YandexPilotCallbackPage } from './AuthPages'
import {
  createYandexAuthorizationUrl,
  readPendingYandexNativeRegistration,
  savePendingYandexNativeRegistration,
} from './yandex-pilot-oauth'
import {
  readInvitationAuthReturn,
  saveInvitationAuthReturn,
} from './invitation-auth-return'
import {
  captureInvitationLink,
  readPendingInvitationLink,
} from './invitation-link-continuation'
import { PRIVACY_VERSION, TERMS_VERSION } from '../../shared/legal'
import { YandexAccountSetupRequiredError } from '../../data/repositories/yandex-pilot.repository'
import { attachRequestDiagnostics } from '../../shared/request-diagnostics'

const PROFILE_ID = 'd2b80c5e-f60b-42b0-ae3f-308e91bbcb9b'
const session = {
  accessMode: 'read_write' as const,
  profile: {
    id: PROFILE_ID,
    firstName: 'Ирина',
    lastName: null,
    timezone: 'Europe/Moscow',
    accountRole: 'trainer' as const,
  },
  session: {
    token: 'a'.repeat(43),
    expiresAt: '2099-09-01T12:00:00.000Z',
  },
}

interface MockAuthState {
  actor: { userId: string; role: 'trainer' | 'client' } | null
  loading: boolean
  error: string | null
}

interface MockAppSessionState {
  session: typeof session | null
  loading: boolean
  error: string | null
  establish: (value: typeof session) => void
  retry: () => Promise<void>
  reset: () => void
  signOut: () => Promise<void>
}

const authState = vi.hoisted(() => vi.fn<() => MockAuthState>())
vi.mock('../../app/auth-context', () => ({ useAuth: () => authState() }))

const appSessionState = vi.hoisted(() => vi.fn<() => MockAppSessionState>())
vi.mock('../../app/yandex-app-session-context', () => ({
  useYandexAppSession: () => appSessionState(),
}))

const repository = vi.hoisted(() => ({
  exchangeCodeForAppSession: vi.fn(),
  registerYandexAccount: vi.fn(),
  recoverYandexAccount: vi.fn(),
  completeYandexRegistration: vi.fn(),
  revokeAppSession: vi.fn(),
}))
vi.mock('../../data/repositories/yandex-pilot.repository', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../data/repositories/yandex-pilot.repository')>(),
  yandexPilotRepository: repository,
}))

const establish = vi.fn()
const retry = vi.fn()
const reset = vi.fn()
const signOut = vi.fn()

async function appCallbackSearch(): Promise<string> {
  const authorizationUrl = new URL(await createYandexAuthorizationUrl(
    'public-client-id',
    'http://localhost/auth/yandex/callback',
    sessionStorage,
    'app',
  ))
  return `?code=one-time-code&state=${authorizationUrl.searchParams.get('state')}`
}

async function registrationCallbackSearch(): Promise<string> {
  savePendingYandexNativeRegistration({
    accountRole: 'trainer',
    firstName: 'Ирина',
    timezone: 'Europe/Moscow',
    termsVersion: TERMS_VERSION,
    privacyVersion: PRIVACY_VERSION,
  })
  const authorizationUrl = new URL(await createYandexAuthorizationUrl(
    'public-client-id',
    'http://localhost/auth/yandex/callback',
    sessionStorage,
    'register',
  ))
  return `?code=registration-code&state=${authorizationUrl.searchParams.get('state')}`
}

describe('Yandex app session auth flow', () => {
  beforeEach(() => {
    establish.mockReset()
    retry.mockReset().mockResolvedValue(undefined)
    reset.mockReset()
    signOut.mockReset().mockResolvedValue(undefined)
    repository.exchangeCodeForAppSession.mockReset().mockResolvedValue(session)
    repository.registerYandexAccount.mockReset().mockResolvedValue(session)
    repository.recoverYandexAccount.mockReset().mockResolvedValue(session)
    repository.completeYandexRegistration.mockReset().mockResolvedValue(session)
    repository.revokeAppSession.mockReset().mockResolvedValue(undefined)
    authState.mockReset().mockReturnValue({ actor: null, loading: false, error: null })
    appSessionState.mockReset().mockReturnValue({
      session: null,
      loading: false,
      error: null,
      establish,
      retry,
      reset,
      signOut,
    })
    vi.stubEnv('VITE_YANDEX_APP_SESSION_ENABLED', 'true')
    vi.stubEnv('VITE_YANDEX_OAUTH_CLIENT_ID', 'public-client-id')
    vi.stubEnv('VITE_YANDEX_API_BASE_URL', 'https://stage.example.test')
    vi.stubGlobal('crypto', {
      getRandomValues: (bytes: Uint8Array) => bytes.fill(7),
      subtle: { digest: vi.fn().mockResolvedValue(new Uint8Array(32).fill(9).buffer) },
    })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    window.history.replaceState(null, '', '/')
    sessionStorage.clear()
  })

  it('uses Yandex ID as the primary login while keeping email sign-in available', () => {
    render(<MemoryRouter><AuthPage /></MemoryRouter>)

    expect(screen.getByRole('button', { name: 'Продолжить с Yandex ID' })).toHaveClass('primary')
    expect(screen.getByLabelText('Email')).toBeVisible()
    expect(screen.getByLabelText('Пароль')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Войти по email' })).toHaveClass('secondary')
  })

  it('shows only Yandex ID when the final auth cutover flag and its dependencies are enabled', () => {
    vi.stubEnv('VITE_YANDEX_NATIVE_REGISTRATION_ENABLED', 'true')
    vi.stubEnv('VITE_YANDEX_MAIN_ROUTING_ENABLED', 'true')
    vi.stubEnv('VITE_YANDEX_ONLY_AUTH_ENABLED', 'true')
    render(<MemoryRouter><AuthPage /></MemoryRouter>)

    expect(screen.getByRole('heading', { name: 'Вход' })).toBeVisible()
    expect(screen.getByText('Планируйте тренировки и следите за прогрессом клиентов.')).toBeVisible()
    expect(screen.getByRole('region', { name: 'Авторизация через Yandex ID' })).toBeVisible()
    expect(screen.getByText('Вход и регистрация выполняются через Yandex ID.')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Продолжить с Yandex ID' })).toHaveClass('primary')
    expect(screen.queryByLabelText('Email')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Пароль')).not.toBeInTheDocument()
    expect(screen.queryByText('Забыли пароль?')).not.toBeInTheDocument()
    expect(screen.queryByText('Создать аккаунт')).not.toBeInTheDocument()
  })

  it('keeps the existing internal return path for an email-authenticated account', async () => {
    authState.mockReturnValue({
      actor: { userId: PROFILE_ID, role: 'trainer' },
      loading: false,
      error: null,
    })
    render(<MemoryRouter initialEntries={[{
      pathname: '/auth',
      state: { from: '/legal/delete-account' },
    }]}>
      <Routes>
        <Route path="/auth" element={<AuthPage />} />
        <Route path="/legal/delete-account" element={<p>delete account route</p>} />
      </Routes>
    </MemoryRouter>)

    expect(await screen.findByText('delete account route')).toBeVisible()
  })

  it('rejects an external return target after authentication', async () => {
    authState.mockReturnValue({
      actor: { userId: PROFILE_ID, role: 'trainer' },
      loading: false,
      error: null,
    })
    render(<MemoryRouter initialEntries={[{
      pathname: '/auth',
      state: { from: 'https://attacker.example.test/' },
    }]}>
      <Routes>
        <Route path="/auth" element={<AuthPage />} />
        <Route path="/today" element={<p>trainer home</p>} />
      </Routes>
    </MemoryRouter>)

    expect(await screen.findByText('trainer home')).toBeVisible()
  })

  it('explains the pending invitation and prepares client registration', () => {
    vi.stubEnv('VITE_YANDEX_NATIVE_REGISTRATION_ENABLED', 'true')
    vi.stubEnv('VITE_YANDEX_MAIN_ROUTING_ENABLED', 'true')
    render(<MemoryRouter initialEntries={[{
      pathname: '/auth',
      state: { from: '/join?code=AB12CD34EF56' },
    }]}><AuthPage /></MemoryRouter>)

    expect(screen.getByText('Войдите или создайте аккаунт, чтобы продолжить по приглашению.')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Создать аккаунт' }))
    expect(screen.getByLabelText('Тип аккаунта')).toHaveValue('client')
    expect(screen.getByRole('button', { name: 'Продолжить с Yandex ID' })).toHaveClass('primary')
  })

  it('opens native registration with the role from a protected invitation preview', () => {
    const token = `AB12CD34EF56.${'a'.repeat(64)}`
    captureInvitationLink(`#token=${token}&source=yandex`)
    vi.stubEnv('VITE_YANDEX_NATIVE_REGISTRATION_ENABLED', 'true')
    vi.stubEnv('VITE_YANDEX_MAIN_ROUTING_ENABLED', 'true')
    render(<MemoryRouter initialEntries={[{
      pathname: '/auth',
      state: {
        from: '/invite',
        inviteRole: 'client',
        mode: 'register',
      },
    }]}><AuthPage /></MemoryRouter>)

    expect(screen.getByRole('heading', { name: 'Регистрация' })).toBeVisible()
    expect(screen.getByLabelText('Тип аккаунта')).toHaveValue('client')
    expect(screen.queryByText(token)).not.toBeInTheDocument()
    expect(readInvitationAuthReturn()).toBe('/invite')
    expect(readPendingInvitationLink()?.token).toBe(token)
  })

  it('returns a restored Yandex session to the pending invitation once', async () => {
    vi.stubEnv('VITE_YANDEX_MAIN_ROUTING_ENABLED', 'true')
    saveInvitationAuthReturn('/join?code=ab12cd34ef56')
    authState.mockReturnValue({
      actor: { userId: PROFILE_ID, role: 'client' },
      loading: false,
      error: null,
    })
    appSessionState.mockReturnValue({
      session,
      loading: false,
      error: null,
      establish,
      retry,
      reset,
      signOut,
    })
    render(<MemoryRouter initialEntries={['/auth/yandex/session']}>
      <Routes>
        <Route path="/auth/yandex/session" element={<YandexAppSessionPage />} />
        <Route path="/join" element={<p>invitation route</p>} />
      </Routes>
    </MemoryRouter>)

    expect(await screen.findByText('invitation route')).toBeVisible()
    await waitFor(() => expect(readInvitationAuthReturn()).toBeNull())
  })

  it('clears a pending Yandex invitation when the email fallback signs in', async () => {
    saveInvitationAuthReturn('/join?code=ab12cd34ef56')
    authState.mockReturnValue({
      actor: { userId: PROFILE_ID, role: 'client' },
      loading: false,
      error: null,
    })
    render(<MemoryRouter initialEntries={['/auth']}>
      <Routes>
        <Route path="/auth" element={<AuthPage />} />
        <Route path="/join" element={<p>invitation route</p>} />
      </Routes>
    </MemoryRouter>)

    expect(await screen.findByText('invitation route')).toBeVisible()
    await waitFor(() => expect(readInvitationAuthReturn()).toBeNull())
  })

  it('uses Yandex ID as the only primary registration action when the native flow is enabled', () => {
    vi.stubEnv('VITE_YANDEX_NATIVE_REGISTRATION_ENABLED', 'true')
    vi.stubEnv('VITE_YANDEX_MAIN_ROUTING_ENABLED', 'true')
    render(<MemoryRouter><AuthPage /></MemoryRouter>)

    fireEvent.click(screen.getByRole('button', { name: 'Создать аккаунт' }))
    expect(screen.getByLabelText('Тип аккаунта')).toBeVisible()
    expect(screen.getByLabelText('Имя')).toBeVisible()
    expect(screen.queryByLabelText('Email')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Пароль')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Продолжить с Yandex ID' })).toHaveClass('primary')
    expect(screen.getByRole('button', { name: 'Создать по email' })).toBeVisible()
  })

  it('registers after the PKCE callback and clears the pending profile draft', async () => {
    vi.stubEnv('VITE_YANDEX_NATIVE_REGISTRATION_ENABLED', 'true')
    vi.stubEnv('VITE_YANDEX_MAIN_ROUTING_ENABLED', 'true')
    window.history.replaceState(null, '', `/auth/yandex/callback${await registrationCallbackSearch()}`)
    render(<MemoryRouter initialEntries={['/auth/yandex/callback']}>
      <Routes>
        <Route path="/auth/yandex/callback" element={<YandexPilotCallbackPage />} />
        <Route path="/auth/yandex/session" element={<p>registered session</p>} />
      </Routes>
    </MemoryRouter>)

    expect(await screen.findByText('registered session')).toBeVisible()
    expect(repository.registerYandexAccount).toHaveBeenCalledWith(
      'https://stage.example.test',
      'registration-code',
      expect.stringMatching(/^[A-Za-z0-9_-]{43,128}$/),
      {
        accountRole: 'trainer',
        firstName: 'Ирина',
        timezone: 'Europe/Moscow',
        termsVersion: TERMS_VERSION,
        privacyVersion: PRIVACY_VERSION,
      },
    )
    expect(establish).toHaveBeenCalledWith(session)
    expect(readPendingYandexNativeRegistration()).toBeNull()
  })

  it('keeps the registration draft for a safe OAuth restart after an API error', async () => {
    vi.stubEnv('VITE_YANDEX_NATIVE_REGISTRATION_ENABLED', 'true')
    vi.stubEnv('VITE_YANDEX_MAIN_ROUTING_ENABLED', 'true')
    repository.registerYandexAccount.mockRejectedValueOnce(
      new Error('Yandex Cloud временно недоступен.'),
    )
    saveInvitationAuthReturn('/join?code=ab12cd34ef56')
    window.history.replaceState(null, '', `/auth/yandex/callback${await registrationCallbackSearch()}`)
    render(<MemoryRouter><YandexPilotCallbackPage /></MemoryRouter>)

    expect(await screen.findByRole('alert')).toHaveTextContent('Yandex Cloud временно недоступен.')
    expect(window.location.search).toBe('')
    expect(screen.getByRole('button', { name: 'Начать заново' })).toBeEnabled()
    expect(readPendingYandexNativeRegistration()).toEqual({
      accountRole: 'trainer',
      firstName: 'Ирина',
      timezone: 'Europe/Moscow',
      termsVersion: TERMS_VERSION,
      privacyVersion: PRIVACY_VERSION,
    })
    expect(readInvitationAuthReturn()).toBe('/join?code=AB12CD34EF56')
  })

  it('clears stale legal acceptance and requires a fresh registration page', async () => {
    vi.stubEnv('VITE_YANDEX_NATIVE_REGISTRATION_ENABLED', 'true')
    vi.stubEnv('VITE_YANDEX_MAIN_ROUTING_ENABLED', 'true')
    const refreshRequired = new Error('Условия использования обновились.')
    refreshRequired.name = 'YandexNativeRegistrationRefreshRequiredError'
    repository.registerYandexAccount.mockRejectedValueOnce(refreshRequired)
    window.history.replaceState(null, '', `/auth/yandex/callback${await registrationCallbackSearch()}`)
    render(<MemoryRouter><YandexPilotCallbackPage /></MemoryRouter>)

    expect(await screen.findByRole('alert')).toHaveTextContent('Условия использования обновились.')
    expect(readPendingYandexNativeRegistration()).toBeNull()
    expect(screen.getByRole('link', { name: 'Обновить регистрацию' })).toHaveAttribute(
      'href',
      '/auth',
    )
  })

  it('exchanges an app OAuth callback and opens the session route', async () => {
    window.history.replaceState(null, '', `/auth/yandex/callback${await appCallbackSearch()}`)
    render(<MemoryRouter initialEntries={['/auth/yandex/callback']}>
      <Routes>
        <Route path="/auth/yandex/callback" element={<YandexPilotCallbackPage />} />
        <Route path="/auth/yandex/session" element={<p>session route</p>} />
      </Routes>
    </MemoryRouter>)

    expect(await screen.findByText('session route')).toBeVisible()
    expect(repository.exchangeCodeForAppSession).toHaveBeenCalledWith(
      'https://stage.example.test',
      'one-time-code',
      expect.stringMatching(/^[A-Za-z0-9_-]{43,128}$/),
    )
    expect(establish).toHaveBeenCalledWith(session)
    expect(window.location.search).toBe('')
  })

  it('explains when Yandex rejects authorization for the current account', async () => {
    await createYandexAuthorizationUrl(
      'public-client-id',
      'http://localhost/auth/yandex/callback',
      sessionStorage,
      'app',
    )
    window.history.replaceState(
      null,
      '',
      '/auth/yandex/callback?error=unauthorized_client&error_description=provider-copy',
    )
    render(<MemoryRouter initialEntries={['/auth/yandex/callback']}>
      <Routes>
        <Route path="/auth/yandex/callback" element={<YandexPilotCallbackPage />} />
      </Routes>
    </MemoryRouter>)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Yandex ID не разрешил вход для этого аккаунта. Попробуйте другой аккаунт Yandex ID или повторите позже.',
    )
    expect(screen.getByRole('link', { name: 'Повторить вход' })).toHaveAttribute('href', '/auth')
    expect(repository.exchangeCodeForAppSession).not.toHaveBeenCalled()
    expect(window.location.search).toBe('')
  })

  it('shows a support code for an incomplete Yandex profile without offering email login', async () => {
    const requestId = 'bd1f7c5e-230b-48e0-8c93-57ec3d1e67cb'
    repository.exchangeCodeForAppSession.mockRejectedValueOnce(attachRequestDiagnostics(
      new Error('Профиль FIT ещё не готов для входа через Yandex ID. Попробуйте снова позже.'),
      {
        requestId,
        occurredAt: '2026-09-21T09:58:49.526Z',
        backend: 'yandex',
        operation: 'POST /v1/auth/yandex/session',
        stage: 'api',
        status: 403,
        errorCode: 'yandex_profile_not_ready',
      },
    ))
    window.history.replaceState(null, '', `/auth/yandex/callback${await appCallbackSearch()}`)
    render(<MemoryRouter initialEntries={['/auth/yandex/callback']}>
      <Routes>
        <Route path="/auth/yandex/callback" element={<YandexPilotCallbackPage />} />
      </Routes>
    </MemoryRouter>)

    expect(await screen.findByRole('alert')).toHaveTextContent('Профиль FIT ещё не готов')
    expect(screen.getByText('Код для поддержки:', { exact: false })).toHaveTextContent('FIT-57EC-3D1E-67CB')
    expect(screen.getByRole('link', { name: 'Повторить вход' })).toHaveAttribute('href', '/auth')
    expect(screen.queryByText(/войдите по email/i)).not.toBeInTheDocument()
  })

  it('links an existing profile from the one-time Yandex handoff', async () => {
    vi.stubEnv('VITE_YANDEX_NATIVE_REGISTRATION_ENABLED', 'true')
    vi.stubEnv('VITE_YANDEX_MAIN_ROUTING_ENABLED', 'true')
    vi.stubEnv('VITE_YANDEX_ONLY_AUTH_ENABLED', 'true')
    repository.exchangeCodeForAppSession.mockRejectedValueOnce(
      new YandexAccountSetupRequiredError({
        token: 'h'.repeat(43),
        expiresAt: '2099-09-19T12:10:00.000Z',
      }),
    )
    window.history.replaceState(null, '', `/auth/yandex/callback${await appCallbackSearch()}`)
    render(<MemoryRouter initialEntries={['/auth/yandex/callback']}>
      <Routes>
        <Route path="/auth/yandex/callback" element={<YandexPilotCallbackPage />} />
        <Route path="/auth/yandex/session" element={<p>recovered session</p>} />
      </Routes>
    </MemoryRouter>)

    expect(await screen.findByRole('heading', { name: 'У вас уже был аккаунт FIT?' })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Да, был аккаунт' }))
    fireEvent.change(screen.getByLabelText('Email старого аккаунта'), {
      target: { value: 'person@example.test' },
    })
    fireEvent.change(screen.getByLabelText('Пароль старого аккаунта'), {
      target: { value: 'secret-password' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Связать и продолжить' }))

    expect(await screen.findByText('recovered session')).toBeVisible()
    expect(repository.recoverYandexAccount).toHaveBeenCalledWith(
      'https://stage.example.test',
      {
        handoffToken: 'h'.repeat(43),
        email: 'person@example.test',
        password: 'secret-password',
      },
    )
    expect(establish).toHaveBeenCalledWith(session)
  })

  it('creates a new profile only after the user explicitly chooses that path', async () => {
    vi.stubEnv('VITE_YANDEX_NATIVE_REGISTRATION_ENABLED', 'true')
    vi.stubEnv('VITE_YANDEX_MAIN_ROUTING_ENABLED', 'true')
    vi.stubEnv('VITE_YANDEX_ONLY_AUTH_ENABLED', 'true')
    repository.exchangeCodeForAppSession.mockRejectedValueOnce(
      new YandexAccountSetupRequiredError({
        token: 'h'.repeat(43),
        expiresAt: '2099-09-19T12:10:00.000Z',
      }),
    )
    window.history.replaceState(null, '', `/auth/yandex/callback${await appCallbackSearch()}`)
    render(<MemoryRouter initialEntries={['/auth/yandex/callback']}>
      <Routes>
        <Route path="/auth/yandex/callback" element={<YandexPilotCallbackPage />} />
        <Route path="/auth/yandex/session" element={<p>new session</p>} />
      </Routes>
    </MemoryRouter>)

    await screen.findByRole('heading', { name: 'У вас уже был аккаунт FIT?' })
    expect(repository.completeYandexRegistration).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Нет, создать новый' }))
    fireEvent.change(screen.getByLabelText('Имя'), { target: { value: 'Ирина' } })
    fireEvent.click(screen.getByRole('button', { name: 'Создать аккаунт' }))

    expect(await screen.findByText('new session')).toBeVisible()
    expect(repository.completeYandexRegistration).toHaveBeenCalledWith(
      'https://stage.example.test',
      expect.objectContaining({
        handoffToken: 'h'.repeat(43),
        accountRole: 'trainer',
        firstName: 'Ирина',
        termsVersion: TERMS_VERSION,
        privacyVersion: PRIVACY_VERSION,
      }),
    )
  })

  it('returns a linked Yandex account to the pending invitation', async () => {
    const token = `AB12CD34EF56.${'a'.repeat(64)}`
    vi.stubEnv('VITE_YANDEX_MAIN_ROUTING_ENABLED', 'true')
    captureInvitationLink(`#token=${token}&source=yandex`)
    saveInvitationAuthReturn('/invite')
    window.history.replaceState(null, '', `/auth/yandex/callback${await appCallbackSearch()}`)
    render(<MemoryRouter initialEntries={['/auth/yandex/callback']}>
      <Routes>
        <Route path="/auth/yandex/callback" element={<YandexPilotCallbackPage />} />
        <Route path="/auth/yandex/session" element={<p>session route</p>} />
      </Routes>
    </MemoryRouter>)

    expect(await screen.findByText('session route')).toBeVisible()
    expect(establish).toHaveBeenCalledWith(session)
    expect(readInvitationAuthReturn()).toBe('/invite')
    expect(readPendingInvitationLink()?.token).toBe(token)
  })

  it('opens a matching Yandex app session for the authenticated FIT actor', async () => {
    authState.mockReturnValue({
      actor: { userId: PROFILE_ID, role: 'trainer' },
      loading: false,
      error: null,
    })
    window.history.replaceState(null, '', `/auth/yandex/callback${await appCallbackSearch()}`)
    render(<MemoryRouter initialEntries={['/auth/yandex/callback']}>
      <Routes>
        <Route path="/auth/yandex/callback" element={<YandexPilotCallbackPage />} />
        <Route path="/assistant" element={<p>assistant route</p>} />
      </Routes>
    </MemoryRouter>)

    expect(await screen.findByText('assistant route')).toBeVisible()
    expect(repository.exchangeCodeForAppSession).toHaveBeenCalledOnce()
    expect(establish).toHaveBeenCalledWith(session)
  })

  it('revokes a Yandex app session linked to another FIT actor', async () => {
    authState.mockReturnValue({
      actor: { userId: '6e577cc7-3b56-4a86-bc85-1ce2426ce249', role: 'trainer' },
      loading: false,
      error: null,
    })
    window.history.replaceState(null, '', `/auth/yandex/callback${await appCallbackSearch()}`)
    render(<MemoryRouter><YandexPilotCallbackPage /></MemoryRouter>)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Yandex ID связан с другим FIT-профилем.',
    )
    expect(repository.revokeAppSession).toHaveBeenCalledWith(
      'https://stage.example.test',
      session.session.token,
    )
    expect(establish).not.toHaveBeenCalled()
  })

  it('shows a restored session and logs out without exposing the token', async () => {
    appSessionState.mockReturnValue({
      session,
      loading: false,
      error: null,
      establish,
      retry,
      reset,
      signOut,
    })
    render(<MemoryRouter initialEntries={['/auth/yandex/session']}>
      <Routes>
        <Route path="/auth/yandex/session" element={<YandexAppSessionPage />} />
        <Route path="/auth" element={<p>auth route</p>} />
      </Routes>
    </MemoryRouter>)

    expect(screen.getByRole('heading', { name: 'Сессия работает' })).toBeVisible()
    expect(screen.getByText('Ирина')).toBeVisible()
    expect(document.body.textContent).not.toContain(session.session.token)
    fireEvent.click(screen.getByRole('button', { name: 'Выйти из Yandex ID' }))
    await waitFor(() => expect(signOut).toHaveBeenCalledOnce())
    expect(await screen.findByText('auth route')).toBeVisible()
  })

  it('offers retry and an explicit local reset after restore failure', () => {
    appSessionState.mockReturnValue({
      session: null,
      loading: false,
      error: 'Yandex Cloud вход временно недоступен.',
      establish,
      retry,
      reset,
      signOut,
    })
    render(<MemoryRouter><YandexAppSessionPage /></MemoryRouter>)

    expect(screen.getByRole('alert')).toHaveTextContent('Yandex Cloud вход временно недоступен.')
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }))
    expect(retry).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: 'Сбросить сессию Yandex ID' }))
    expect(reset).toHaveBeenCalledOnce()
  })

  it('allows resetting a failed restored session from the regular sign-in page', () => {
    appSessionState.mockReturnValue({
      session: null,
      loading: false,
      error: 'Проверка сессии Yandex ID заняла слишком много времени.',
      establish,
      retry,
      reset,
      signOut,
    })
    render(<MemoryRouter><AuthPage /></MemoryRouter>)

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Проверка сессии Yandex ID заняла слишком много времени.',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Сбросить сессию Yandex ID' }))
    expect(reset).toHaveBeenCalledOnce()
  })
})
