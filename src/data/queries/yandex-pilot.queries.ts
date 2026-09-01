export type YandexApiAccessMode = 'read_only' | 'read_write'

function sessionHeaders(
  sessionToken: string,
  accessMode: YandexApiAccessMode,
): Record<string, string> {
  return accessMode === 'read_write'
    ? { 'x-fit-session': sessionToken }
    : { 'x-fit-pilot-session': sessionToken }
}

export const yandexPilotQueries = {
  exchangeCodeForSession: (apiBaseUrl: string, code: string, codeVerifier: string) => fetch(`${apiBaseUrl}/v1/auth/yandex/pilot`, {
    method: 'POST',
    cache: 'no-store',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code, codeVerifier }),
  }),
  exchangeCodeForAppSession: (
    apiBaseUrl: string,
    code: string,
    codeVerifier: string,
  ) => fetch(`${apiBaseUrl}/v1/auth/yandex/session`, {
    method: 'POST',
    cache: 'no-store',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code, codeVerifier }),
  }),
  getAppSession: (apiBaseUrl: string, sessionToken: string) =>
    fetch(`${apiBaseUrl}/v1/auth/yandex/session`, {
      cache: 'no-store',
      headers: { 'x-fit-session': sessionToken },
    }),
  revokeAppSession: (apiBaseUrl: string, sessionToken: string) =>
    fetch(`${apiBaseUrl}/v1/auth/yandex/session`, {
      method: 'DELETE',
      cache: 'no-store',
      headers: { 'x-fit-session': sessionToken },
    }),
  linkYandexAccount: (
    apiBaseUrl: string,
    supabaseAccessToken: string,
    code: string,
    codeVerifier: string,
  ) => fetch(`${apiBaseUrl}/v1/auth/yandex/link`, {
    method: 'POST',
    cache: 'no-store',
    headers: {
      authorization: `Bearer ${supabaseAccessToken}`,
      'content-type': 'application/json',
    },
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
  listTrainingData: (
    apiBaseUrl: string,
    sessionToken: string,
    accessMode: YandexApiAccessMode = 'read_only',
  ) => fetch(`${apiBaseUrl}/v1/training-data`, {
    cache: 'no-store',
    headers: sessionHeaders(sessionToken, accessMode),
  }),
  parseWorkout: (
    apiBaseUrl: string,
    sessionToken: string,
    text: string,
    systemCatalog: readonly unknown[],
    accessMode: YandexApiAccessMode = 'read_only',
  ) => fetch(`${apiBaseUrl}/v1/assistant/yandex/parse-workout`, {
    method: 'POST',
    cache: 'no-store',
    headers: {
      'content-type': 'application/json',
      ...sessionHeaders(sessionToken, accessMode),
    },
    body: JSON.stringify({ text, systemCatalog }),
  }),
  listAssistantConversations: (
    apiBaseUrl: string,
    sessionToken: string,
    accessMode: YandexApiAccessMode = 'read_only',
  ) =>
    fetch(`${apiBaseUrl}/v1/assistant/conversations`, {
      cache: 'no-store',
      headers: sessionHeaders(sessionToken, accessMode),
    }),
  createAssistantConversation: (
    apiBaseUrl: string,
    sessionToken: string,
    title: string | null,
    accessMode: YandexApiAccessMode = 'read_only',
  ) => fetch(`${apiBaseUrl}/v1/assistant/conversations`, {
    method: 'POST',
    cache: 'no-store',
    headers: {
      'content-type': 'application/json',
      ...sessionHeaders(sessionToken, accessMode),
    },
    body: JSON.stringify({ title }),
  }),
  listAssistantMessages: (
    apiBaseUrl: string,
    sessionToken: string,
    conversationId: string,
    accessMode: YandexApiAccessMode = 'read_only',
  ) => fetch(`${apiBaseUrl}/v1/assistant/conversations/${conversationId}/messages`, {
    cache: 'no-store',
    headers: sessionHeaders(sessionToken, accessMode),
  }),
  sendAssistantTurn: (
    apiBaseUrl: string,
    sessionToken: string,
    conversationId: string,
    turnId: string,
    message: string,
    accessMode: YandexApiAccessMode = 'read_only',
  ) => fetch(`${apiBaseUrl}/v1/assistant/turn`, {
    method: 'POST',
    cache: 'no-store',
    headers: {
      'content-type': 'application/json',
      ...sessionHeaders(sessionToken, accessMode),
    },
    body: JSON.stringify({
      conversation_id: conversationId,
      turn_id: turnId,
      message,
    }),
  }),
  listAssistantActions: (
    apiBaseUrl: string,
    sessionToken: string,
    conversationId?: string,
    accessMode: YandexApiAccessMode = 'read_only',
  ) => fetch(`${apiBaseUrl}/v1/assistant/actions${conversationId === undefined
    ? ''
    : `?conversationId=${encodeURIComponent(conversationId)}`}`, {
    cache: 'no-store',
    headers: sessionHeaders(sessionToken, accessMode),
  }),
  applyAssistantAction: (
    apiBaseUrl: string,
    sessionToken: string,
    actionId: string,
    input: object,
    expectedVersion: number,
    accessMode: YandexApiAccessMode = 'read_only',
  ) => fetch(`${apiBaseUrl}/v1/assistant/actions/${actionId}/apply`, {
    method: 'POST',
    cache: 'no-store',
    headers: {
      'content-type': 'application/json',
      ...sessionHeaders(sessionToken, accessMode),
    },
    body: JSON.stringify({ input, expectedVersion }),
  }),
  completeAssistantSummary: (
    apiBaseUrl: string,
    sessionToken: string,
    actionId: string,
    expectedVersion: number,
    accessMode: YandexApiAccessMode = 'read_only',
  ) => fetch(`${apiBaseUrl}/v1/assistant/actions/${actionId}/complete-summary`, {
    method: 'POST',
    cache: 'no-store',
    headers: {
      'content-type': 'application/json',
      ...sessionHeaders(sessionToken, accessMode),
    },
    body: JSON.stringify({ expectedVersion }),
  }),
  cancelAssistantAction: (
    apiBaseUrl: string,
    sessionToken: string,
    actionId: string,
    expectedVersion: number,
    accessMode: YandexApiAccessMode = 'read_only',
  ) => fetch(`${apiBaseUrl}/v1/assistant/actions/${actionId}/cancel`, {
    method: 'POST',
    cache: 'no-store',
    headers: {
      'content-type': 'application/json',
      ...sessionHeaders(sessionToken, accessMode),
    },
    body: JSON.stringify({ expectedVersion }),
  }),
  listTrainingSummaries: (
    apiBaseUrl: string,
    sessionToken: string,
    clientId: string,
    accessMode: YandexApiAccessMode = 'read_only',
  ) =>
    fetch(`${apiBaseUrl}/v1/clients/${clientId}/training-summaries`, {
      cache: 'no-store',
      headers: sessionHeaders(sessionToken, accessMode),
    }),
  generateTrainingSummary: (
    apiBaseUrl: string,
    sessionToken: string,
    clientId: string,
    periodStart: string,
    periodEnd: string,
    force: boolean,
    accessMode: YandexApiAccessMode = 'read_only',
  ) => fetch(`${apiBaseUrl}/v1/clients/${clientId}/training-summaries/generate`, {
    method: 'POST',
    cache: 'no-store',
    headers: {
      'content-type': 'application/json',
      ...sessionHeaders(sessionToken, accessMode),
    },
    body: JSON.stringify({
      client_id: clientId,
      period_start: periodStart,
      period_end: periodEnd,
      force,
    }),
  }),
  publishTrainingSummary: (
    apiBaseUrl: string,
    sessionToken: string,
    summaryId: string,
    clientSummary: Record<string, unknown>,
    expectedVersion: number,
  ) => fetch(`${apiBaseUrl}/v1/training-summaries/${summaryId}/publish`, {
    method: 'POST',
    cache: 'no-store',
    headers: {
      'content-type': 'application/json',
      ...sessionHeaders(sessionToken, 'read_write'),
    },
    body: JSON.stringify({ clientSummary, expectedVersion }),
  }),
  getPushNotificationStatus: (apiBaseUrl: string, sessionToken: string) =>
    fetch(`${apiBaseUrl}/v1/push-notifications/status`, {
      cache: 'no-store',
      headers: { 'x-fit-pilot-session': sessionToken },
    }),
  upsertPushSubscription: (
    apiBaseUrl: string,
    sessionToken: string,
    subscription: { endpoint: string; p256dh: string; authKey: string },
  ) => fetch(`${apiBaseUrl}/v1/push-notifications/subscription`, {
    method: 'PUT',
    cache: 'no-store',
    headers: {
      'content-type': 'application/json',
      'x-fit-pilot-session': sessionToken,
    },
    body: JSON.stringify(subscription),
  }),
  deletePushSubscription: (apiBaseUrl: string, sessionToken: string) =>
    fetch(`${apiBaseUrl}/v1/push-notifications/subscription`, {
      method: 'DELETE',
      cache: 'no-store',
      headers: { 'x-fit-pilot-session': sessionToken },
    }),
  setPushNotificationPreference: (
    apiBaseUrl: string,
    sessionToken: string,
    kind: 'workout_reminder' | 'workout_scheduled',
    enabled: boolean,
  ) => fetch(`${apiBaseUrl}/v1/push-notifications/preferences/${kind}`, {
    method: 'PUT',
    cache: 'no-store',
    headers: {
      'content-type': 'application/json',
      'x-fit-pilot-session': sessionToken,
    },
    body: JSON.stringify({ enabled }),
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
