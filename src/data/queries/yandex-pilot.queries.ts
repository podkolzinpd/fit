export const yandexPilotQueries = {
  exchangeCodeForSession: (apiBaseUrl: string, code: string, codeVerifier: string) => fetch(`${apiBaseUrl}/v1/auth/yandex/pilot`, {
    method: 'POST',
    cache: 'no-store',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code, codeVerifier }),
  }),
  listClients: (apiBaseUrl: string, sessionToken: string) => fetch(`${apiBaseUrl}/v1/clients`, {
    cache: 'no-store',
    headers: { authorization: `Bearer ${sessionToken}` },
  }),
}
