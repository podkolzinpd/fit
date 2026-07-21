import { supabase } from './client'

export const authQueries = {
  getSession: () => supabase.auth.getSession(),
  onAuthStateChange: (callback: Parameters<typeof supabase.auth.onAuthStateChange>[0]) =>
    supabase.auth.onAuthStateChange(callback),
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
  getProfile: (id: string) => supabase.from('profiles')
    .select('id,first_name,last_name,timezone,created_at,updated_at').eq('id', id).single(),
  updateProfile: (id: string, values: { first_name: string | null; last_name: string | null; timezone: string }) =>
    supabase.from('profiles').update(values).eq('id', id).select('id,first_name,last_name,timezone,created_at,updated_at').single(),
}
