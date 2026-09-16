import { invokeLegacyCloudFunction } from './legacy-cloud-functions'

function diagnosticFailure(stage: string, requestId: string, details: string): Error {
  return new Error(`Этап ${stage} · ${details} · ID ${requestId}`)
}

export async function legacySummaryDiagnosticQuery(
  clientId: string,
  periodStart: string,
  periodEnd: string,
): Promise<unknown> {
  const result = await invokeLegacyCloudFunction<Record<string, unknown>>('summarize-client-training', {
    client_id: clientId,
    period_start: periodStart,
    period_end: periodEnd,
    force: true,
    trigger_reason: 'manual_refresh',
    diagnostic: 'preflight',
  }, { includeResponse: true })
  if (result === undefined) throw diagnosticFailure('ROUTE', 'нет ID', 'legacy bridge не настроен')
  if (result.error) {
    if (result.error instanceof Error) throw result.error
    const response = result.error.context
    const requestId = response.headers.get('x-fit-request-id') ?? 'нет ID'
    const releaseId = response.headers.get('x-fit-release-id') ?? 'legacy bridge'
    let code = response.headers.get('x-fit-error-code') ?? ''
    if (!code) {
      try {
        const payload = await response.clone().json() as { error?: unknown; code?: unknown }
        code = typeof payload.code === 'string'
          ? payload.code
          : typeof payload.error === 'string'
            ? payload.error
            : ''
      } catch { /* Status and route are still useful. */ }
    }
    throw diagnosticFailure('API', requestId, `HTTP ${response.status} · ${code || 'без кода'} · release ${releaseId}`)
  }
  const requestId = result.response?.headers.get('x-fit-request-id') ?? 'legacy bridge'
  const releaseId = result.response?.headers.get('x-fit-release-id') ?? 'legacy bridge'
  return {
    ...result.data,
    ready: true,
    code: 'available',
    request_id: requestId,
    release_id: releaseId,
  }
}

// Incident-only, read-only preflight. It follows the same production route as
// summary generation and stops before the model call or any database write.
export async function summaryDiagnosticQuery(
  apiBaseUrl: string,
  sessionToken: string,
  clientId: string,
  periodStart: string,
  periodEnd: string,
): Promise<unknown> {
  const requestId = crypto.randomUUID()
  let response: Response
  try {
    response = await fetch(`${apiBaseUrl}/v1/clients/${clientId}/training-summaries/diagnostic`, {
      method: 'POST',
      cache: 'no-store',
      headers: {
        'content-type': 'application/json',
        'x-fit-request-id': requestId,
        'x-fit-session': sessionToken,
      },
      body: JSON.stringify({
        client_id: clientId,
        period_start: periodStart,
        period_end: periodEnd,
        force: true,
        trigger_reason: 'manual_refresh',
      }),
      signal: AbortSignal.timeout(60000),
    })
  } catch (error) {
    const detail = error instanceof DOMException && error.name === 'TimeoutError'
      ? 'таймаут 60 с'
      : 'запрос не дошёл до Yandex API'
    throw diagnosticFailure('NETWORK', requestId, detail)
  }
  const responseRequestId = response.headers.get('x-fit-request-id') ?? requestId
  const releaseId = response.headers.get('x-fit-release-id') ?? 'нет release'
  if (!response.ok) {
    let bodyCode = ''
    try {
      const body = await response.clone().json() as { error?: unknown }
      bodyCode = typeof body.error === 'string' ? body.error : ''
    } catch { /* The status and headers remain sufficient diagnostics. */ }
    const code = response.headers.get('x-fit-error-code') ?? (bodyCode || 'без кода')
    throw diagnosticFailure('API', responseRequestId, `HTTP ${response.status} · ${code} · release ${releaseId}`)
  }
  try {
    const payload = await response.json() as Record<string, unknown>
    return { ...payload, request_id: responseRequestId, release_id: releaseId }
  } catch {
    throw diagnosticFailure('RESPONSE', responseRequestId, `невалидный JSON · release ${releaseId}`)
  }
}
