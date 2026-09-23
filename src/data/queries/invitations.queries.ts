import { getSupabaseClient } from './client'

export const invitationQueries = {
  create: (clientId: string, targetRole: 'client' | 'trainer') => getSupabaseClient().rpc('create_client_invitation', {
    p_client_id: clientId,
    p_target_role: targetRole,
  }),
  createShare: (clientId: string, targetRole: 'client' | 'trainer') => getSupabaseClient().rpc('create_client_invitation_share', {
    p_client_id: clientId,
    p_target_role: targetRole,
  }),
  previewLink: (token: string) => getSupabaseClient().rpc('get_client_invitation_preview', { p_token: token }),
  claimLink: (token: string) => getSupabaseClient().rpc('claim_client_invitation_link', { p_token: token }),
  claim: (code: string) => getSupabaseClient().rpc('claim_client_invitation', { p_code: code }),
  reconnect: (code: string) => getSupabaseClient().rpc('reconnect_client_trainer', { p_code: code }),
  list: (clientId: string) => getSupabaseClient().from('client_invitations')
    .select('id,client_id,target_role,expires_at,created_at')
    .eq('client_id', clientId).is('claimed_at', null).is('revoked_at', null)
    .gt('expires_at', new Date().toISOString()).order('created_at', { ascending: false }),
  listTrainers: (clientId: string) => getSupabaseClient().rpc('list_client_trainers', { p_client_id: clientId }),
  revoke: (invitationId: string) => getSupabaseClient().rpc('revoke_client_invitation', { p_invitation_id: invitationId }),
  disconnectTrainer: (clientId: string) => getSupabaseClient().rpc('disconnect_client_trainer', { p_client_id: clientId }),
  removeTrainer: (clientId: string, trainerId: string) => getSupabaseClient().rpc('remove_client_trainer', {
    p_client_id: clientId, p_trainer_id: trainerId,
  }),
  leave: (clientId: string) => getSupabaseClient().rpc('leave_client_space', { p_client_id: clientId }),
}
