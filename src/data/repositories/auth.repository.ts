import type { SessionActor } from '../../shared/domain'
import { authQueries } from '../queries/auth.queries'
import { repositoryError } from './error'

export const authRepository = {
  getSession: authQueries.getSession,
  onAuthStateChange: authQueries.onAuthStateChange,
  async signIn(email: string, password: string) {
    const { error } = await authQueries.signIn(email, password)
    if (error) throw repositoryError(error)
  },
  async signUp(email: string, password: string, firstName: string) {
    const { error } = await authQueries.signUp(email, password, firstName)
    if (error) throw repositoryError(error)
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
    const firstName = typeof user.user_metadata.first_name === 'string' ? user.user_metadata.first_name : undefined
    const lastName = typeof user.user_metadata.last_name === 'string' ? user.user_metadata.last_name : undefined
    const initialized = await authQueries.initializeTrainer(firstName, lastName)
    if (initialized.error) throw repositoryError(initialized.error)
    const profile = await authQueries.getProfile(user.id)
    if (profile.error) throw repositoryError(profile.error)
    return {
      userId: user.id,
      email: user.email ?? null,
      firstName: profile.data.first_name,
      lastName: profile.data.last_name,
      timezone: profile.data.timezone,
    }
  },
  async updateProfile(actor: SessionActor): Promise<SessionActor> {
    const result = await authQueries.updateProfile(actor.userId, {
      first_name: actor.firstName, last_name: actor.lastName, timezone: actor.timezone,
    })
    if (result.error) throw repositoryError(result.error)
    return { ...actor, firstName: result.data.first_name, lastName: result.data.last_name, timezone: result.data.timezone }
  },
}
