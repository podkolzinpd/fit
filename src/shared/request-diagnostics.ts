export type RequestDiagnosticStage = 'api' | 'network' | 'response'

export interface RequestDiagnostics {
  requestId: string
  occurredAt: string
  backend: 'yandex'
  operation: string
  stage: RequestDiagnosticStage
  status?: number
  errorCode?: string
  errorCategory?: string
  releaseId?: string
}

type DiagnosticError = Error & { requestDiagnostics?: RequestDiagnostics }

function optionalText(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

export function attachRequestDiagnostics<T extends Error>(
  error: T,
  diagnostics: RequestDiagnostics | undefined,
): T {
  if (diagnostics === undefined) return error
  Object.defineProperty(error, 'requestDiagnostics', {
    configurable: true,
    enumerable: false,
    value: diagnostics,
  })
  return error
}

export function getRequestDiagnostics(error: unknown): RequestDiagnostics | null {
  if (!(error instanceof Error)) return null
  const candidate = (error as DiagnosticError).requestDiagnostics
  if (!candidate || typeof candidate !== 'object') return null
  if (typeof candidate.requestId !== 'string'
    || typeof candidate.occurredAt !== 'string'
    || candidate.backend !== 'yandex'
    || typeof candidate.operation !== 'string'
    || !['api', 'network', 'response'].includes(candidate.stage)) return null
  return {
    requestId: candidate.requestId,
    occurredAt: candidate.occurredAt,
    backend: candidate.backend,
    operation: candidate.operation,
    stage: candidate.stage,
    ...(typeof candidate.status === 'number' ? { status: candidate.status } : {}),
    ...(optionalText(candidate.errorCode) ? { errorCode: candidate.errorCode } : {}),
    ...(optionalText(candidate.errorCategory) ? { errorCategory: candidate.errorCategory } : {}),
    ...(optionalText(candidate.releaseId) ? { releaseId: candidate.releaseId } : {}),
  }
}

export function requestSupportCode(requestId: string): string {
  const compact = requestId.replace(/[^a-z0-9]/gi, '').toUpperCase()
  const suffix = compact.slice(-12).padStart(12, '0')
  return `FIT-${suffix.slice(0, 4)}-${suffix.slice(4, 8)}-${suffix.slice(8)}`
}

export function formatRequestDiagnostics(diagnostics: RequestDiagnostics): string {
  const lines = [
    'Диагностика FIT',
    `Код: ${requestSupportCode(diagnostics.requestId)}`,
    `Request ID: ${diagnostics.requestId}`,
    `Время: ${diagnostics.occurredAt}`,
    `Backend: ${diagnostics.backend}`,
    `Операция: ${diagnostics.operation}`,
    `Этап: ${diagnostics.stage}`,
  ]
  if (diagnostics.status !== undefined) lines.push(`HTTP: ${diagnostics.status}`)
  if (diagnostics.errorCode !== undefined) lines.push(`Ошибка: ${diagnostics.errorCode}`)
  if (diagnostics.errorCategory !== undefined) lines.push(`Категория: ${diagnostics.errorCategory}`)
  if (diagnostics.releaseId !== undefined) lines.push(`Release: ${diagnostics.releaseId}`)
  return lines.join('\n')
}
