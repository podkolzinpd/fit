import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { attachRequestDiagnostics } from './request-diagnostics'
import { AsyncView } from './ui'

const copyText = vi.hoisted(() => vi.fn())
vi.mock('./clipboard', () => ({ copyText }))

describe('request diagnostic error state', () => {
  beforeEach(() => copyText.mockReset().mockResolvedValue(undefined))

  it('shows a support code and copies only safe diagnostics', async () => {
    const error = attachRequestDiagnostics(new Error('Сервис временно недоступен'), {
      requestId: '18940d82-9075-48d2-a847-8feee301b4d7',
      occurredAt: '2026-09-20T10:15:30.000Z',
      backend: 'yandex',
      operation: 'GET /v1/profile',
      stage: 'api',
      status: 503,
      errorCode: 'service_unavailable',
      releaseId: 'release-42',
    })
    render(<AsyncView loading={false} error={error} onRetry={() => undefined}>Контент</AsyncView>)

    expect(screen.getByRole('alert')).toHaveTextContent('FIT-8FEE-E301-B4D7')
    fireEvent.click(screen.getByRole('button', { name: /Скопировать диагностику/ }))
    await waitFor(() => expect(copyText).toHaveBeenCalledOnce())
    expect(copyText.mock.calls[0]?.[0]).toContain('Request ID: 18940d82-9075-48d2-a847-8feee301b4d7')
    expect(copyText.mock.calls[0]?.[0]).not.toContain('token')
    expect(screen.getByRole('status')).toHaveTextContent('Скопировано')
  })

  it('keeps ordinary errors unchanged', () => {
    render(<AsyncView loading={false} error={new Error('Обычная ошибка')}>Контент</AsyncView>)
    expect(screen.getByRole('alert')).toHaveTextContent('Обычная ошибка')
    expect(screen.queryByText(/Код для поддержки/)).toBeNull()
  })
})
