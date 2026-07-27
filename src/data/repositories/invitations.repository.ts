import { invitationQueries } from '../queries/invitations.queries'
import { repositoryError } from './error'

export const invitationsRepository = {
  async create(clientId: string, targetRole: 'client' | 'trainer'): Promise<string> {
    const result = await invitationQueries.create(clientId, targetRole)
    if (result.error) throw repositoryError(result.error)
    return result.data
  },
  async claim(code: string): Promise<string> {
    const result = await invitationQueries.claim(code.trim().toUpperCase())
    if (result.error) throw repositoryError(result.error)
    return result.data
  },
}
