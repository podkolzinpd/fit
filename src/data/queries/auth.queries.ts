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
  signUp: (email: string, password: string, firstName: string) =>
    supabase.auth.signUp({ email, password, options: { data: { first_name: firstName } } }),
  signInWithGoogle: (redirectTo: string) => supabase.auth.signInWithOAuth({
    provider: 'google', options: { redirectTo },
  }),
  resetPassword: (email: string, redirectTo: string) => supabase.auth.resetPasswordForEmail(email, { redirectTo }),
  updatePassword: (password: string) => supabase.auth.updateUser({ password }),
  signOut: () => supabase.auth.signOut(),
  initializeTrainer: (firstName?: string, lastName?: string) => supabase.rpc('initialize_trainer', {
    p_first_name: firstName ?? null, p_last_name: lastName ?? null,
  }),
  getLinkedClient: (userId: string) => supabase.from('clients')
    .select('id,trainer_id,full_name')
    .eq('auth_user_id', userId)
    .maybeSingle(),
  getTrainer: (userId: string) => supabase.from('trainers')
    .select('profile_id')
    .eq('profile_id', userId)
    .maybeSingle(),
  getProfile: (id: string) => supabase.from('profiles')
    .select('id,first_name,last_name,timezone,created_at,updated_at').eq('id', id).single(),
  updateProfile: (id: string, values: { first_name: string | null; last_name: string | null; timezone: string }) =>
    supabase.from('profiles').update(values).eq('id', id).select('id,first_name,last_name,timezone,created_at,updated_at').single(),
}
