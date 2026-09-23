import type { AuthChangeEvent, Session } from '@supabase/supabase-js'
import { getSupabaseClient } from './client'

type AuthStateChangeCallback = (event: AuthChangeEvent, session: Session | null) => void

export const authQueries = {
  getSession: () => getSupabaseClient().auth.getSession(),
  onAuthStateChange: (callback: AuthStateChangeCallback) =>
    getSupabaseClient().auth.onAuthStateChange((event, session) => {
      callback(event, session)
      return Promise.resolve()
    }),
  clearLocalSession: () => getSupabaseClient().auth.signOut({ scope: 'local' }),
  signIn: (email: string, password: string) => getSupabaseClient().auth.signInWithPassword({ email, password }),
  signUp: (
    email: string,
    password: string,
    firstName: string,
    role: 'trainer' | 'client',
    legal: { termsVersion: string; privacyVersion: string; acceptedAt: string },
  ) => getSupabaseClient().auth.signUp({
    email,
    password,
    options: { data: {
      first_name: firstName,
      account_role: role,
      legal_terms_version: legal.termsVersion,
      legal_privacy_version: legal.privacyVersion,
      legal_accepted_at: legal.acceptedAt,
    } },
  }),
  signInWithGoogle: (redirectTo: string) => getSupabaseClient().auth.signInWithOAuth({
    provider: 'google', options: { redirectTo },
  }),
  resetPassword: (email: string, redirectTo: string) => getSupabaseClient().auth.resetPasswordForEmail(email, { redirectTo }),
  updatePassword: (password: string) => getSupabaseClient().auth.updateUser({ password }),
  signOut: () => getSupabaseClient().auth.signOut(),
  initializeAccount: (role: 'trainer' | 'client', firstName?: string, lastName?: string, timezone?: string) => getSupabaseClient().rpc('initialize_account', {
    p_role: role, p_first_name: firstName ?? null, p_last_name: lastName ?? null, p_timezone: timezone,
  }),
  getLinkedClient: (userId: string) => getSupabaseClient().from('clients')
    .select('id,trainer_id,full_name')
    .eq('auth_user_id', userId)
    .maybeSingle(),
  getTrainer: (userId: string) => getSupabaseClient().from('trainers')
    .select('profile_id')
    .eq('profile_id', userId)
    .maybeSingle(),
  getProfile: (id: string) => getSupabaseClient().from('profiles')
    .select('id,account_role,first_name,last_name,timezone,created_at,updated_at').eq('id', id).maybeSingle(),
  updateProfile: (id: string, values: { first_name: string | null; last_name: string | null; timezone: string }) =>
    getSupabaseClient().from('profiles').update(values).eq('id', id).select('id,account_role,first_name,last_name,timezone,created_at,updated_at').single(),
}
