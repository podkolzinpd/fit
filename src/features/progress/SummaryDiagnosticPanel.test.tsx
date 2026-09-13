import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
import { SummaryDiagnosticPanel } from './SummaryDiagnosticPanel'
import { getSummaryDiagnostic } from '../../data/repositories/summary-diagnostic.repository'

vi.mock('../../data/repositories/summary-diagnostic.repository', () => ({ getSummaryDiagnostic: vi.fn() }))
const preflight = { fingerprint: 'test', stats: { workouts: 14, exercises: 149, sets: 376, model_input_chars: 44511 } }
beforeEach(() => { vi.mocked(getSummaryDiagnostic).mockReset(); sessionStorage.clear() })
const mount = () => render(<MemoryRouter><SummaryDiagnosticPanel clientId="client-1" /></MemoryRouter>)

it('requires preflight and a separate click; escapes the raw answer without writing an analysis', async () => {
  vi.mocked(getSummaryDiagnostic).mockResolvedValueOnce(preflight).mockResolvedValueOnce({ ...preflight, answer: '<script>private</script>', issues: ['Правило'] })
  mount()
  expect(getSummaryDiagnostic).not.toHaveBeenCalled()
  await userEvent.click(screen.getByRole('button', { name: 'Сверить данные без ИИ' }))
  expect(getSummaryDiagnostic).toHaveBeenCalledTimes(1)
  await userEvent.click(await screen.findByRole('button', { name: 'Один запрос к ИИ' }))
  expect(await screen.findByText('<script>private</script>')).toBeVisible()
  expect(getSummaryDiagnostic).toHaveBeenLastCalledWith('client-1', 'run_once', 'test')
  expect(document.querySelector('script')).toBeNull()
})

it('blocks mismatched input and blocks retry after an uncertain paid call', async () => {
  vi.mocked(getSummaryDiagnostic).mockResolvedValueOnce({ ...preflight, stats: { ...preflight.stats, sets: 377 } })
  const view = mount()
  await userEvent.click(screen.getByRole('button', { name: 'Сверить данные без ИИ' }))
  expect(await screen.findByRole('button', { name: 'Один запрос к ИИ' })).toBeDisabled()
  view.unmount()
  vi.mocked(getSummaryDiagnostic).mockResolvedValueOnce(preflight).mockRejectedValueOnce(new Error('Сеть'))
  mount()
  await userEvent.click(screen.getByRole('button', { name: 'Сверить данные без ИИ' }))
  await userEvent.click(await screen.findByRole('button', { name: 'Один запрос к ИИ' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Сеть')
  expect(screen.getByRole('button', { name: 'Один запрос к ИИ' })).toBeDisabled()
})
