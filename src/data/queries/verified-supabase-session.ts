import { supabase } from './client'

function authenticationRequired(): Error {
  return new Error('authentication_required')
}

/**
 * Returns the current browser access token.
 *
 * The summary service remains the source of truth for authorization and
 * rejects invalid sessions before any model request. A second browser-side
 * getUser/refresh gate made valid sign-ins fail without reaching the service,
 * which also removed the server-side diagnostics needed to recover safely.
 */
export async function verifiedSupabaseAccessToken(): Promise<string> {
  const current = await supabase.auth.getSession()
  const currentToken = current.data.session?.access_token
  if (current.error || !currentToken) throw authenticationRequired()
  return currentToken
}

/**
 * Refreshes an existing browser session after the server has rejected its
 * access token. This is deliberately server-driven: valid sessions keep using
 * the fast path, while a stale token gets exactly one recovery attempt.
 */
export async function refreshSupabaseAccessToken(): Promise<string> {
  const refreshed = await supabase.auth.refreshSession()
  const refreshedToken = refreshed.data.session?.access_token
  if (refreshed.error || !refreshedToken) throw authenticationRequired()
  return refreshedToken
}
