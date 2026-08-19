export const yandexPilotQueries = {
  exchangeCodeForProfile: (apiBaseUrl: string, code: string, codeVerifier: string) => fetch(`${apiBaseUrl}/v1/auth/yandex/pilot`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code, codeVerifier }),
  }),
}
