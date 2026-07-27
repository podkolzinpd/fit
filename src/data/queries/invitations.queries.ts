import { supabase } from './client'

export const invitationQueries = {
  create: (clientId: string, targetRole: 'client' | 'trainer') => supabase.rpc('create_client_invitation', {
    p_client_id: clientId,
    p_target_role: targetRole,
  }),
  claim: (code: string) => supabase.rpc('claim_client_invitation', { p_code: code }),
}
