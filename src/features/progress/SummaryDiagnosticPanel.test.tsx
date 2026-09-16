import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
import { SummaryDiagnosticPanel } from './SummaryDiagnosticPanel'
import { getLegacySummaryDiagnostic, getSummaryDiagnostic } from '../../data/repositories/summary-diagnostic.repository'

vi.mock('../../data/repositories/summary-diagnostic.repository', () => ({ getSummaryDiagnostic: vi.fn(), getLegacySummaryDiagnostic: vi.fn() }))
const preflight = {
  fingerprint: 'test',
  ready: true,
  code: 'available',
  requestId: 'request-id',
  releaseId: 'release-id',
  stats: { workouts: 14, exercises: 149, sets: 376, model_input_chars: 44511 },
}
beforeEach(() => { vi.mocked(getSummaryDiagnostic).mockReset(); vi.mocked(getLegacySummaryDiagnostic).mockReset(); sessionStorage.clear() })
const mount = (backendSource: 'supabase' | 'yandex' = 'yandex') => render(<MemoryRouter><SummaryDiagnosticPanel backendSource={backendSource} apiBaseUrl="https://api.example.test" sessionToken="session-token" clientId="client-1" periodStart="2026-08-16" periodEnd="2026-09-15" /></MemoryRouter>)

it('runs only the zero-token production preflight and shows its trace', async () => {
  vi.mocked(getSummaryDiagnostic).mockResolvedValueOnce(preflight)
  mount()
  expect(getSummaryDiagnostic).not.toHaveBeenCalled()
  await userEvent.click(screen.getByRole('button', { name: 'Запустить preflight без ИИ' }))
  expect(getSummaryDiagnostic).toHaveBeenCalledTimes(1)
  expect(getSummaryDiagnostic).toHaveBeenCalledWith('https://api.example.test', 'session-token', 'client-1', '2026-08-16', '2026-09-15')
  expect(await screen.findByText(/Preflight пройден/)).toBeVisible()
  expect(screen.getByText(/ID: request-id/)).toBeVisible()
  expect(screen.queryByText(/запрос к ИИ/i)).not.toBeInTheDocument()
})

it('shows the exact failed stage and permits only another free preflight', async () => {
  vi.mocked(getSummaryDiagnostic).mockRejectedValueOnce(new Error('Этап API · HTTP 503 · service_unavailable · ID request-id'))
  mount()
  await userEvent.click(screen.getByRole('button', { name: 'Запустить preflight без ИИ' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Этап API · HTTP 503')
  expect(screen.getByRole('button', { name: 'Запустить preflight без ИИ' })).toBeEnabled()
})

it('uses the legacy preflight for a Supabase-backed client', async () => {
  vi.mocked(getLegacySummaryDiagnostic).mockResolvedValueOnce(preflight)
  mount('supabase')

  await userEvent.click(screen.getByRole('button', { name: 'Запустить preflight без ИИ' }))
  expect(getLegacySummaryDiagnostic).toHaveBeenCalledWith('client-1', '2026-08-16', '2026-09-15')
  expect(getSummaryDiagnostic).not.toHaveBeenCalled()
  expect(await screen.findByText(/Preflight пройден/)).toBeVisible()
})
