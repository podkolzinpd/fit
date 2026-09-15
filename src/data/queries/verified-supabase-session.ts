import { supabase } from './client'

function authenticationRequired(): Error {
  return new Error('authentication_required')
}

/**
 * Returns a token which Supabase Auth still recognises as an active session.
 *
 * PostgREST can accept a signed JWT until it expires even after its Auth
 * session has been revoked. Paid server-side operations must therefore not
 * rely on getSession() alone: validate once, refresh once when necessary, and
 * stop before the paid endpoint if the session cannot be recovered.
 */
export async function verifiedSupabaseAccessToken(): Promise<string> {
  const current = await supabase.auth.getSession()
  const currentToken = current.data.session?.access_token
  if (current.error || !currentToken) throw authenticationRequired()

  const currentUser = await supabase.auth.getUser(currentToken)
  if (!currentUser.error && currentUser.data.user) return currentToken

  const refreshed = await supabase.auth.refreshSession()
  const refreshedToken = refreshed.data.session?.access_token
  if (refreshed.error || !refreshedToken) throw authenticationRequired()

  const refreshedUser = await supabase.auth.getUser(refreshedToken)
  if (refreshedUser.error || !refreshedUser.data.user) throw authenticationRequired()
  return refreshedToken
}
