import type { AccountRole, SessionActor, TrainerActor } from '../../shared/domain'
import { isValidTimeZone, normalizeTimeZone, systemTimeZone } from '../../shared/local-date'
import { authQueries } from '../queries/auth.queries'
import { RepositoryError, repositoryError } from './error'

const signupFailedMessage = 'Не удалось создать аккаунт. Попробуйте войти или используйте другой email.'
const signInUnavailableMessage = 'Не удалось войти. Проверьте интернет и попробуйте ещё раз.'
const signInSessionMessage = 'Не удалось сохранить вход на этом устройстве. Обновите страницу и попробуйте ещё раз.'
const NETWORK_ERROR = /failed to fetch|fetch failed|networkerror|network request failed|load failed|timed out|timeout|aborted|aborterror/i
const SIGN_IN_ATTEMPT_DEADLINE_MS = 9_000

class SignInTimeoutError extends TypeError {
  constructor() {
    super('Auth sign-in request timed out')
    this.name = 'SignInTimeoutError'
  }
}

function isTransientNetworkError(error: unknown): boolean {
  return (error instanceof Error && NETWORK_ERROR.test(error.message))
    || (typeof error === 'object' && error !== null && 'message' in error
      && typeof error.message === 'string' && NETWORK_ERROR.test(error.message))
    || (typeof error === 'object' && error !== null && 'status' in error
      && typeof error.status === 'number' && [502, 503, 504].includes(error.status))
}

async function signInAttempt(email: string, password: string) {
  let timeoutId: ReturnType<typeof globalThis.setTimeout> | undefined
  try {
    return await Promise.race([
      authQueries.signIn(email, password),
      new Promise<never>((_, reject) => {
        timeoutId = globalThis.setTimeout(() => reject(new SignInTimeoutError()), SIGN_IN_ATTEMPT_DEADLINE_MS)
      }),
    ])
  } finally {
    if (timeoutId !== undefined) globalThis.clearTimeout(timeoutId)
  }
}

async function signInWithNetworkRetry(email: string, password: string): Promise<void> {
  let lastNetworkError: unknown
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const { error } = await signInAttempt(email, password)
      if (!error) return
      if (!isTransientNetworkError(error)) throw repositoryError(error)
      lastNetworkError = error
    } catch (error) {
      if (!isTransientNetworkError(error)) {
        if (error instanceof TypeError) {
          throw new RepositoryError('session_unavailable', signInSessionMessage, { cause: error })
        }
        throw error
      }
      lastNetworkError = error
    }

    // На мобильном короткий переход между Wi-Fi и сотовой сетью может оборвать
    // первый HTTPS-запрос. Повторяем ровно один раз и только сетевой сбой.
    if (attempt === 0) await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 500))
  }

  throw new RepositoryError('network_unavailable', signInUnavailableMessage, { cause: lastNetworkError })
}

export const authRepository = {
  getSession: authQueries.getSession,
  onAuthStateChange: authQueries.onAuthStateChange,
  async signIn(email: string, password: string) {
    // Мобильный браузер может восстановить старую вкладку с уже отозванным
    // refresh token одновременно с новым входом. Дожидаемся восстановления
    // SDK и очищаем только локальную сессию, не затрагивая другие устройства.
    // Ошибка серверного sign-out здесь не блокирует вход: SDK всё равно
    // удаляет локальную сессию для scope=local.
    await authQueries.clearLocalSession().catch(() => undefined)
    await signInWithNetworkRetry(email, password)
  },
  async signUp(email: string, password: string, firstName: string, role: AccountRole) {
    const { data, error } = await authQueries.signUp(email, password, firstName, role)
    if (error?.code === 'user_already_exists' || error?.message === 'User already registered') {
      throw new Error(signupFailedMessage)
    }
    if (error) throw repositoryError(error)
    if (!data.session) throw new Error(signupFailedMessage)
  },
  async signInWithGoogle(role: AccountRole = 'trainer') {
    sessionStorage.setItem('fit.pendingAccountRole', role)
    const redirect = `${window.location.origin}/auth/callback`
    const { error } = await authQueries.signInWithGoogle(redirect)
    if (error) throw repositoryError(error)
  },
  async resetPassword(email: string) {
    const { error } = await authQueries.resetPassword(email, `${window.location.origin}/auth/reset`)
    if (error) throw repositoryError(error)
  },
  async updatePassword(password: string) {
    const { error } = await authQueries.updatePassword(password)
    if (error) throw repositoryError(error)
  },
  async signOut() {
    const { error } = await authQueries.signOut()
    if (error) throw repositoryError(error)
  },
  async initialize(user: { id: string; email?: string; user_metadata: Record<string, unknown> }): Promise<SessionActor> {
    const [linkedClient, existing] = await Promise.all([
      authQueries.getLinkedClient(user.id),
      authQueries.getProfile(user.id),
    ])
    if (linkedClient.error) throw repositoryError(linkedClient.error)
    if (existing.error) throw repositoryError(existing.error)
    if (linkedClient.data) {
      const [firstName, ...lastNameParts] = linkedClient.data.full_name.trim().split(/\s+/)
      return {
        kind: 'client',
        role: 'client',
        userId: user.id,
        email: user.email ?? null,
        firstName: firstName || null,
        lastName: lastNameParts.join(' ') || null,
        timezone: normalizeTimeZone(existing.data?.timezone),
        clientId: linkedClient.data.id,
        trainerId: linkedClient.data.trainer_id,
        fullName: linkedClient.data.full_name,
      }
    }

    const trainer = await authQueries.getTrainer(user.id)
    if (trainer.error) throw repositoryError(trainer.error)
    const firstName = typeof user.user_metadata.first_name === 'string' ? user.user_metadata.first_name : undefined
    const lastName = typeof user.user_metadata.last_name === 'string' ? user.user_metadata.last_name : undefined
    const metadataRole = user.user_metadata.account_role
    const pendingRole = sessionStorage.getItem('fit.pendingAccountRole')
    const role: AccountRole = existing.data?.account_role === 'client' || existing.data?.account_role === 'trainer'
      ? existing.data.account_role
      : metadataRole === 'client' || metadataRole === 'trainer'
        ? metadataRole
        : pendingRole === 'client' ? 'client' : 'trainer'
    let profileData = existing.data
    if (!profileData) {
      const initialized = await authQueries.initializeAccount(role, firstName, lastName, systemTimeZone())
      if (initialized.error) throw repositoryError(initialized.error)
      const profile = await authQueries.getProfile(user.id)
      if (profile.error) throw repositoryError(profile.error)
      profileData = profile.data
    }
    sessionStorage.removeItem('fit.pendingAccountRole')
    if (!profileData) throw new Error('Профиль пользователя не найден')
    return {
      kind: 'trainer',
      userId: user.id,
      role,
      email: user.email ?? null,
      firstName: profileData.first_name,
      lastName: profileData.last_name,
      timezone: normalizeTimeZone(profileData.timezone),
    }
  },
  async updateProfile(actor: TrainerActor): Promise<TrainerActor> {
    if (!isValidTimeZone(actor.timezone)) {
      throw new Error('Укажите часовой пояс в формате Europe/Moscow')
    }
    const result = await authQueries.updateProfile(actor.userId, {
      first_name: actor.firstName, last_name: actor.lastName, timezone: actor.timezone,
    })
    if (result.error) throw repositoryError(result.error)
    return { ...actor, firstName: result.data.first_name, lastName: result.data.last_name, timezone: result.data.timezone }
  },
}
