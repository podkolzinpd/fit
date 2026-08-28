import { supabase } from './client'

export const invitationQueries = {
  create: (clientId: string, targetRole: 'client' | 'trainer') => supabase.rpc('create_client_invitation', {
    p_client_id: clientId,
    p_target_role: targetRole,
  }),
  claim: (code: string) => supabase.rpc('claim_client_invitation', { p_code: code }),
  list: (clientId: string) => supabase.from('client_invitations')
    .select('id,client_id,target_role,expires_at,created_at')
    .eq('client_id', clientId).is('claimed_at', null).is('revoked_at', null)
    .gt('expires_at', new Date().toISOString()).order('created_at', { ascending: false }),
  listTrainers: (clientId: string) => supabase.rpc('list_client_trainers', { p_client_id: clientId }),
  revoke: (invitationId: string) => supabase.rpc('revoke_client_invitation', { p_invitation_id: invitationId }),
  disconnectTrainer: (clientId: string) => supabase.rpc('disconnect_client_trainer', { p_client_id: clientId }),
  removeTrainer: (clientId: string, trainerId: string) => supabase.rpc('remove_client_trainer', {
    p_client_id: clientId, p_trainer_id: trainerId,
  }),
  leave: (clientId: string) => supabase.rpc('leave_client_space', { p_client_id: clientId }),
}
