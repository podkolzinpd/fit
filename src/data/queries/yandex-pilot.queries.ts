export const yandexPilotQueries = {
  exchangeCodeForSession: (apiBaseUrl: string, code: string, codeVerifier: string) => fetch(`${apiBaseUrl}/v1/auth/yandex/pilot`, {
    method: 'POST',
    cache: 'no-store',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code, codeVerifier }),
  }),
  listClients: (apiBaseUrl: string, sessionToken: string) => fetch(`${apiBaseUrl}/v1/clients`, {
    cache: 'no-store',
    headers: { 'x-fit-pilot-session': sessionToken },
  }),
  listConnections: (apiBaseUrl: string, sessionToken: string) => fetch(`${apiBaseUrl}/v1/connections`, {
    cache: 'no-store',
    headers: { 'x-fit-pilot-session': sessionToken },
  }),
  createInvitation: (
    apiBaseUrl: string,
    sessionToken: string,
    clientId: string,
    targetRole: 'client' | 'trainer',
  ) => fetch(`${apiBaseUrl}/v1/invitations`, {
    method: 'POST',
    cache: 'no-store',
    headers: {
      'content-type': 'application/json',
      'x-fit-pilot-session': sessionToken,
    },
    body: JSON.stringify({ clientId, targetRole }),
  }),
  claimInvitation: (apiBaseUrl: string, sessionToken: string, code: string) =>
    fetch(`${apiBaseUrl}/v1/invitations/claim`, {
      method: 'POST',
      cache: 'no-store',
      headers: {
        'content-type': 'application/json',
        'x-fit-pilot-session': sessionToken,
      },
      body: JSON.stringify({ code }),
    }),
  revokeInvitation: (apiBaseUrl: string, sessionToken: string, invitationId: string) =>
    fetch(`${apiBaseUrl}/v1/invitations/${invitationId}`, {
      method: 'DELETE',
      cache: 'no-store',
      headers: { 'x-fit-pilot-session': sessionToken },
    }),
  removeTrainer: (
    apiBaseUrl: string,
    sessionToken: string,
    clientId: string,
    trainerId: string,
  ) => fetch(`${apiBaseUrl}/v1/clients/${clientId}/trainers/${trainerId}`, {
    method: 'DELETE',
    cache: 'no-store',
    headers: { 'x-fit-pilot-session': sessionToken },
  }),
  leaveClient: (apiBaseUrl: string, sessionToken: string, clientId: string) =>
    fetch(`${apiBaseUrl}/v1/clients/${clientId}/memberships/me`, {
      method: 'DELETE',
      cache: 'no-store',
      headers: { 'x-fit-pilot-session': sessionToken },
    }),
}
