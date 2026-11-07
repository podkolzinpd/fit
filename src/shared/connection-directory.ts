export interface ConnectionPerson {
  invitationCode?: string
  id: string
  name: string
  role: 'trainer' | 'client'
  connected: boolean | null
  expectedRelationshipId: string | null
  expectedRevision: string | null
  currentTrainer: { id: string; name: string } | null
}
export interface ConnectionRequest {
  id: string
  status: string
  incoming: boolean
  peerId: string
  name: string
  role: 'trainer' | 'client'
  expiresAt: string
}
export interface ConnectionDirectory {
  createInvitation(): Promise<{ id: string; code: string; expiresAt: string }>
  revokeInvitation(code: string): Promise<{ status: string }>
  self(): Promise<{ code: string; fitId: string; emailSearchReady: boolean }>
  rotate(): Promise<{ code: string; fitId: string; emailSearchReady: boolean }>
  resolve(kind: 'email' | 'code', value: string): Promise<ConnectionPerson | null>
  preview(peerId: string): Promise<ConnectionPerson | null>
  list(): Promise<ConnectionRequest[]>
  status(requestId: string): Promise<{ status: string }>
  send(person: ConnectionPerson): Promise<{ id?: string; status: string; incoming?: boolean }>
  decide(action: 'accept' | 'decline' | 'cancel', requestId: string, person?: ConnectionPerson): Promise<{ status: string }>
}
