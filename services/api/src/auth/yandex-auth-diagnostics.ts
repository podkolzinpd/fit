import { safeDatabaseErrorDiagnostics } from '../db/database-readiness.js'
import { YandexIdentityRejectedError, YandexIdentityUnavailableError } from './yandex-identity.js'
import { YandexOAuthCodeRejectedError, YandexOAuthCodeUnavailableError } from './yandex-oauth-code.js'

export type YandexAuthStage = 'configuration' | 'oauth_code' | 'identity'
  | 'trainer_activation' | 'lime_activation' | 'assistant_activation'
  | 'nutrition_activation' | 'session_issue' | 'handoff_issue'

// Never serialize an exception, its message/stack, SQL or provider payload.
export function yandexAuthFailureDiagnostics(stage: YandexAuthStage, error?: unknown) {
  const original: unknown = error instanceof AggregateError ? error.errors[0] : error
  const diagnostic = safeDatabaseErrorDiagnostics(original)
  const code = /^(?:[0-9][0-9A-Z]{4}|PT(?:403|404|409|422)|ECONNREFUSED|ECONNRESET|ENETUNREACH|ENOTFOUND|EPIPE|ETIMEDOUT)$/u
    .test(diagnostic.code) ? diagnostic.code : 'unknown'
  const provider = original instanceof YandexOAuthCodeUnavailableError || original instanceof YandexIdentityUnavailableError
    ? original : undefined
  return {
    event: 'yandex_auth_failed',
    authStage: stage,
    authFailure: error === undefined ? 'not_configured'
      : original instanceof YandexOAuthCodeUnavailableError || original instanceof YandexIdentityUnavailableError
        ? 'provider_unavailable'
        : original instanceof YandexOAuthCodeRejectedError || original instanceof YandexIdentityRejectedError
          ? 'provider_rejected' : 'unexpected',
    errorCode: code,
    errorCategory: diagnostic.category,
    ...(provider === undefined ? {} : {
      providerFailure: ['network', 'http', 'invalid_response', 'unknown'].includes(provider.failure) ? provider.failure : 'unknown',
      ...(Number.isInteger(provider.httpStatus) && provider.httpStatus !== undefined
        && provider.httpStatus >= 100 && provider.httpStatus <= 599 ? { providerStatus: provider.httpStatus } : {}),
    }),
  }
}
