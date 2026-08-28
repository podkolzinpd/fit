import type { AuthChangeEvent, Session } from '@supabase/supabase-js'
import { supabase } from './client'

type AuthStateChangeCallback = (event: AuthChangeEvent, session: Session | null) => void

export const authQueries = {
  getSession: () => supabase.auth.getSession(),
  onAuthStateChange: (callback: AuthStateChangeCallback) =>
    supabase.auth.onAuthStateChange((event, session) => {
      callback(event, session)
      return Promise.resolve()
    }),
  signIn: (email: string, password: string) => supabase.auth.signInWithPassword({ email, password }),
  signUp: (email: string, password: string, firstName: string, role: 'trainer' | 'client') =>
    supabase.auth.signUp({ email, password, options: { data: { first_name: firstName, account_role: role } } }),
  signInWithGoogle: (redirectTo: string) => supabase.auth.signInWithOAuth({
    provider: 'google', options: { redirectTo },
  }),
  resetPassword: (email: string, redirectTo: string) => supabase.auth.resetPasswordForEmail(email, { redirectTo }),
  updatePassword: (password: string) => supabase.auth.updateUser({ password }),
  signOut: () => supabase.auth.signOut(),
  initializeAccount: (role: 'trainer' | 'client', firstName?: string, lastName?: string, timezone?: string) => supabase.rpc('initialize_account', {
    p_role: role, p_first_name: firstName ?? null, p_last_name: lastName ?? null, p_timezone: timezone,
  }),
  getLinkedClient: (userId: string) => supabase.from('clients')
    .select('id,trainer_id,full_name')
    .eq('auth_user_id', userId)
    .maybeSingle(),
  getTrainer: (userId: string) => supabase.from('trainers')
    .select('profile_id')
    .eq('profile_id', userId)
    .maybeSingle(),
  getFeatureFlags: (userId: string) => supabase.from('user_feature_flags')
    .select('monochrome_preview')
    .eq('user_id', userId)
    .maybeSingle(),
  getProfile: (id: string) => supabase.from('profiles')
    .select('id,account_role,first_name,last_name,timezone,created_at,updated_at').eq('id', id).maybeSingle(),
  updateProfile: (id: string, values: { first_name: string | null; last_name: string | null; timezone: string }) =>
    supabase.from('profiles').update(values).eq('id', id).select('id,account_role,first_name,last_name,timezone,created_at,updated_at').single(),
}
