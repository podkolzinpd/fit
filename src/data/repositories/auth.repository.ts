import type { SessionActor, TrainerActor } from '../../shared/domain'
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
  async signUp(email: string, password: string, firstName: string) {
    const { data, error } = await authQueries.signUp(email, password, firstName)
    if (error?.code === 'user_already_exists' || error?.message === 'User already registered') {
      throw new Error(signupFailedMessage)
    }
    if (error) throw repositoryError(error)
    if (!data.session) throw new Error(signupFailedMessage)
  },
  async signInWithGoogle() {
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
    if (!trainer.data) {
      const initialized = await authQueries.initializeTrainer(firstName, lastName)
      if (initialized.error) throw repositoryError(initialized.error)
    }
    const profile = await authQueries.getProfile(user.id)
    if (profile.error) throw repositoryError(profile.error)
    return {
      kind: 'trainer',
      userId: user.id,
      email: user.email ?? null,
      firstName: profile.data.first_name,
      lastName: profile.data.last_name,
      timezone: profile.data.timezone,
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
