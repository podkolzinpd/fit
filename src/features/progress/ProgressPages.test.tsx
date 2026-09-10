import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
import type { CustomMetric, ProgressEntry } from '../../shared/domain'
import { localDate } from '../../shared/local-date'
import { ProgressPage } from './ProgressPages'

const repository = vi.hoisted(() => ({ client: vi.fn(), list: vi.fn(), listMetrics: vi.fn(), save: vi.fn(), remove: vi.fn(), createMetric: vi.fn(), setMetricArchived: vi.fn() }))
vi.mock('../../app/auth-context', () => ({ useAuth: () => ({ actor: { userId: 'trainer', role: 'trainer', timezone: 'Europe/Moscow' } }) }))
vi.mock('../../app/use-client-realtime', () => ({ useClientRealtime: vi.fn() }))
vi.mock('../../app/data-backend-context', () => ({ useDataBackend: () => ({ clients: { get: repository.client }, progress: repository }) }))
// The chart and AI card have their own tests; this integration verifies the retained measurement workflow.
vi.mock('./ProgressChart', () => ({ ProgressChart: () => <div aria-label="График замеров" /> }))
vi.mock('./TrainingSummaryCard', () => ({ TrainerTrainingSummaryCard: () => null }))
vi.mock('./TrainerProgressOverviewCard', () => ({ TrainerProgressOverviewCard: () => null }))
vi.mock('./RunningProgressCard', () => ({ RunningProgressCard: () => null }))

const metric: CustomMetric = { id: 'sleep', clientId: 'client-1', name: 'Сон', unit: 'ч', version: 1, archivedAt: null }
const entry: ProgressEntry = { id: 'entry-1', clientId: 'client-1', recordedOn: localDate('2026-08-01'), createdBy: 'trainer', weightKg: 70, version: 3, customMetrics: [{ metricId: 'sleep', value: 8 }] }
beforeEach(() => {
  vi.clearAllMocks()
  repository.client.mockResolvedValue({ fullName: 'Тест', gender: 'female' })
  repository.list.mockResolvedValue([entry])
  repository.listMetrics.mockResolvedValue([metric])
  repository.save.mockResolvedValue(undefined)
  repository.remove.mockResolvedValue(undefined)
  repository.createMetric.mockResolvedValue(undefined)
  repository.setMetricArchived.mockResolvedValue(undefined)
})
function setup(path = '/progress/client-1?view=measurements') {
  render(<MemoryRouter initialEntries={[path]}><QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}><Routes><Route path="/progress/:clientId" element={<ProgressPage />} /></Routes></QueryClientProvider></MemoryRouter>)
  return userEvent.setup()
}

it('retains history, duplicate-date protection and versioned measurement editing', async () => {
  const user = setup()
  await user.click(await screen.findByRole('button', { name: 'Добавить замер' }))
  fireEvent.change(screen.getByLabelText('Дата'), { target: { value: '2026-08-01' } })
  await user.click(screen.getByRole('button', { name: 'Сохранить замер' }))
  expect(repository.save).not.toHaveBeenCalled()
  expect(screen.getByRole('alert')).toHaveTextContent('уже существует')
  expect(screen.getByRole('heading', { name: 'Изменить замер' })).toBeVisible()
  fireEvent.change(screen.getByLabelText('Вес, кг'), { target: { value: '69' } })
  await user.click(screen.getByRole('button', { name: 'Сохранить замер' }))
  await waitFor(() => expect(repository.save).toHaveBeenCalledWith(expect.objectContaining({ id: 'entry-1', version: 3, clientId: 'client-1', recordedOn: '2026-08-01', weightKg: 69, customMetrics: [{ metricId: 'sleep', value: 8 }] })))
  await waitFor(() => expect(screen.queryByRole('heading', { name: 'Изменить замер' })).toBeNull())
  await user.click(screen.getByRole('button', { name: 'Изменить' }))
  await user.click(screen.getByRole('button', { name: 'Отмена' }))
  expect(repository.save).toHaveBeenCalledOnce()
  await user.click(screen.getByRole('button', { name: 'Удалить' }))
  await waitFor(() => expect(repository.remove).toHaveBeenCalledWith(entry))
})

it('retains custom metric selection and management alongside the chart', async () => {
  const user = setup()
  await user.click(await screen.findByRole('button', { name: '⋯' }))
  const sheet = screen.getByRole('dialog', { name: 'Другие метрики' })
  await user.click(within(sheet).getByRole('button', { name: /Сон\s*ч/ }))
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(screen.getByRole('button', { name: '⋯ Сон' })).toHaveClass('active')
  await user.click(screen.getByRole('button', { name: 'Вес' }))
  expect(screen.getByRole('button', { name: 'Вес' })).toHaveClass('active')
  await user.click(screen.getByRole('button', { name: 'Настроить показатели' }))
  await user.type(screen.getByLabelText('Название показателя'), 'Пульс')
  await user.type(screen.getByLabelText('Единица измерения'), 'уд/мин')
  await user.click(within(screen.getByRole('group', { name: 'Новый показатель' })).getByRole('button', { name: 'Добавить' }))
  await waitFor(() => expect(repository.createMetric).toHaveBeenCalledWith('client-1', 'Пульс', 'уд/мин'))
  await user.click(screen.getByRole('button', { name: 'В архив' }))
  await waitFor(() => expect(repository.setMetricArchived).toHaveBeenCalledWith(metric, true))
  expect(screen.getByLabelText('График замеров')).toBeVisible()
})
