import { fetchWithTimeout } from './request-timeout'

const INVITATION_LINK_REQUEST_TIMEOUT_MS = 12_000

function endpoint(apiBaseUrl: string, path: string): string {
  return `${apiBaseUrl}${path}`
}

export const yandexInvitationLinkQueries = {
  preview: (apiBaseUrl: string, token: string) => fetchWithTimeout(fetch,
    endpoint(apiBaseUrl, '/v1/invitation-links/preview'),
    {
      method: 'POST',
      cache: 'no-store',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
    }, INVITATION_LINK_REQUEST_TIMEOUT_MS, 'Invitation preview request timed out',
  ),
  claim: (apiBaseUrl: string, sessionToken: string, token: string) => fetchWithTimeout(fetch,
    endpoint(apiBaseUrl, '/v1/invitation-links/claim'),
    {
      method: 'POST',
      cache: 'no-store',
      headers: {
        'content-type': 'application/json',
        'x-fit-session': sessionToken,
      },
      body: JSON.stringify({ token }),
    }, INVITATION_LINK_REQUEST_TIMEOUT_MS, 'Invitation claim request timed out',
  ),
}
