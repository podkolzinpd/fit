import { supabase } from './client'

export const legalQueries = {
  getAcceptance: (userId: string, termsVersion: string, privacyVersion: string) => supabase
    .from('user_legal_acceptances')
    .select('accepted_at')
    .eq('user_id', userId)
    .eq('terms_version', termsVersion)
    .eq('privacy_version', privacyVersion)
    .maybeSingle(),
  recordAcceptance: (input: {
    userId: string
    termsVersion: string
    privacyVersion: string
    source: 'registration' | 'existing_user'
    acceptedAt: string
  }) => supabase
    .from('user_legal_acceptances')
    .upsert({
      user_id: input.userId,
      terms_version: input.termsVersion,
      privacy_version: input.privacyVersion,
      source: input.source,
      accepted_at: input.acceptedAt,
    }, { onConflict: 'user_id,terms_version,privacy_version', ignoreDuplicates: true }),
  getCurrentDeletionRequest: (userId: string) => supabase
    .from('account_deletion_requests')
    .select('id,status,requested_at')
    .eq('user_id', userId)
    .eq('status', 'requested')
    .order('requested_at', { ascending: false })
    .limit(1)
    .maybeSingle(),
  requestAccountDeletion: () => supabase.rpc('request_account_deletion'),
  cancelAccountDeletionRequest: () => supabase.rpc('cancel_account_deletion_request'),
}
