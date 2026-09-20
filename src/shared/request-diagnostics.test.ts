import { describe, expect, it } from 'vitest'
import {
  attachRequestDiagnostics,
  formatRequestDiagnostics,
  getRequestDiagnostics,
  requestSupportCode,
  type RequestDiagnostics,
} from './request-diagnostics'

const diagnostics: RequestDiagnostics = {
  requestId: '18940d82-9075-48d2-a847-8feee301b4d7',
  occurredAt: '2026-09-20T10:15:30.000Z',
  backend: 'yandex',
  operation: 'GET /v1/clients/:id',
  stage: 'api',
  status: 503,
  errorCode: 'service_unavailable',
  errorCategory: 'configuration',
  releaseId: 'release-42',
}

describe('request diagnostics', () => {
  it('attaches safe metadata without changing the visible error', () => {
    const error = attachRequestDiagnostics(new Error('Не удалось загрузить данные'), diagnostics)
    expect(error.message).toBe('Не удалось загрузить данные')
    expect(getRequestDiagnostics(error)).toEqual(diagnostics)
    expect(Object.keys(error)).not.toContain('requestDiagnostics')
  })

  it('builds a compact support code and a complete clipboard packet', () => {
    expect(requestSupportCode(diagnostics.requestId)).toBe('FIT-8FEE-E301-B4D7')
    expect(formatRequestDiagnostics(diagnostics)).toBe([
      'Диагностика FIT',
      'Код: FIT-8FEE-E301-B4D7',
      'Request ID: 18940d82-9075-48d2-a847-8feee301b4d7',
      'Время: 2026-09-20T10:15:30.000Z',
      'Backend: yandex',
      'Операция: GET /v1/clients/:id',
      'Этап: api',
      'HTTP: 503',
      'Ошибка: service_unavailable',
      'Категория: configuration',
      'Release: release-42',
    ].join('\n'))
  })

  it('does not treat an ordinary error as a diagnosable request', () => {
    expect(getRequestDiagnostics(new Error('Ошибка'))).toBeNull()
  })
})
