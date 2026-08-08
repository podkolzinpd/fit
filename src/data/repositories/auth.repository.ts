import type { AccountRole, SessionActor, TrainerActor } from '../../shared/domain'
import { authQueries } from '../queries/auth.queries'
import { repositoryError } from './error'

const signupFailedMessage = 'Не удалось создать аккаунт. Попробуйте войти или используйте другой email.'

export const authRepository = {
  getSession: authQueries.getSession,
  onAuthStateChange: authQueries.onAuthStateChange,
  async signIn(email: string, password: string) {
    const { error } = await authQueries.signIn(email, password)
    if (error) throw repositoryError(error)
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
    const linkedClient = await authQueries.getLinkedClient(user.id)
    if (linkedClient.error) throw repositoryError(linkedClient.error)
    if (linkedClient.data) {
      const [firstName, ...lastNameParts] = linkedClient.data.full_name.trim().split(/\s+/)
      return {
        kind: 'client',
        role: 'client',
        userId: user.id,
        email: user.email ?? null,
        firstName: firstName || null,
        lastName: lastNameParts.join(' ') || null,
        timezone: 'Europe/Moscow',
        clientId: linkedClient.data.id,
        trainerId: linkedClient.data.trainer_id,
        fullName: linkedClient.data.full_name,
      }
    }

    const trainer = await authQueries.getTrainer(user.id)
    if (trainer.error) throw repositoryError(trainer.error)
    const firstName = typeof user.user_metadata.first_name === 'string' ? user.user_metadata.first_name : undefined
    const lastName = typeof user.user_metadata.last_name === 'string' ? user.user_metadata.last_name : undefined
    const existing = await authQueries.getProfile(user.id)
    if (existing.error) throw repositoryError(existing.error)
    const metadataRole = user.user_metadata.account_role
    const pendingRole = sessionStorage.getItem('fit.pendingAccountRole')
    const role: AccountRole = existing.data?.account_role === 'client' || existing.data?.account_role === 'trainer'
      ? existing.data.account_role
      : metadataRole === 'client' || metadataRole === 'trainer'
        ? metadataRole
        : pendingRole === 'client' ? 'client' : 'trainer'
    let profileData = existing.data
    if (!profileData) {
      const initialized = await authQueries.initializeAccount(role, firstName, lastName)
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
      timezone: profileData.timezone,
    }
  },
  async updateProfile(actor: TrainerActor): Promise<TrainerActor> {
    const result = await authQueries.updateProfile(actor.userId, {
      first_name: actor.firstName, last_name: actor.lastName, timezone: actor.timezone,
    })
    if (result.error) throw repositoryError(result.error)
    return { ...actor, firstName: result.data.first_name, lastName: result.data.last_name, timezone: result.data.timezone }
  },
}
