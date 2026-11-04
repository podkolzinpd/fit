import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
import type { Client, ClientGoal } from '../../shared/domain'
import { localDate } from '../../shared/local-date'
import { OwnClientProfileGoal } from './OwnClientProfileGoal'

const getGoal = vi.hoisted(() => vi.fn())
vi.mock('../../app/auth-context', () => ({ useAuth: () => ({ actor: { timezone: 'Europe/Moscow' } }) }))
vi.mock('../../app/data-backend-context', () => ({ useDataBackend: () => ({ goals: { get: getGoal } }) }))
vi.mock('../../app/use-client-realtime', () => ({ useClientRealtime: vi.fn() }))
vi.mock('../../shared/local-date', async original => ({ ...await original<typeof import('../../shared/local-date')>(), todayInTimeZone: () => '2026-11-04' }))
const client: Client = { id: 'client', fullName: 'Synthetic', canonicalFullName: 'Synthetic', hasAccount: true, gender: null, ageYears: null, ageUpdatedAt: null, heightCm: null, goal: 'Старый текст', note: null, currentWeightKg: null, archivedAt: null, version: 1, membershipVersion: null }
const goal: ClientGoal = { id: 'goal', clientId: client.id, title: 'Действующая цель', targetDate: localDate('2026-12-01'), status: 'active', version: 4, criteria: [], stages: [
  { id: 'later', goalId: 'goal', title: 'Подводка', startsOn: localDate('2026-11-20'), endsOn: localDate('2026-12-01'), position: 2, version: 6 },
  { id: 'current', goalId: 'goal', title: 'Рабочий этап', startsOn: localDate('2026-11-01'), endsOn: localDate('2026-11-19'), position: 1, version: 7 },
  { id: 'past', goalId: 'goal', title: 'База', startsOn: localDate('2026-10-01'), endsOn: localDate('2026-10-31'), position: 0, version: 8 },
] }
function show() {
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={cache}><MemoryRouter><OwnClientProfileGoal client={client} /></MemoryRouter></QueryClientProvider>)
  return cache
}
beforeEach(() => getGoal.mockReset().mockResolvedValue(goal))
it('keeps the aggregate and all ordered dated subgoals instead of the legacy text', async () => {
  const user = userEvent.setup(); show()
  expect(await screen.findByText('Действующая цель')).toBeVisible()
  expect(screen.queryByText('Старый текст')).not.toBeInTheDocument()
  expect(screen.getByText('Этап 2 из 3')).toBeVisible()
  await user.click(screen.getByText('Все подцели · 3'))
  const list = screen.getByRole('list')
  expect(within(list).getAllByRole('listitem').map(el => el.querySelector('strong')?.textContent)).toEqual(['База', 'Рабочий этап', 'Подводка'])
  expect(within(list).getByText(/01.11.*19.11.*идёт/)).toBeVisible()
  expect(screen.getByRole('link', { name: 'Изменить цель и подцели' })).toHaveAttribute('href', '/me/goal')
})
it('updates from the shared query cache when a trainer changes a stage', async () => {
  const cache = show(); await screen.findByText('Этап 2 из 3')
  act(() => cache.setQueryData(['client-goal', client.id], { ...goal, stages: goal.stages.map(item => item.id === 'current' ? { ...item, title: 'Этап изменён тренером', version: 8 } : item) }))
  expect(await within(screen.getByRole('group', { name: 'Текущая подцель' })).findByText('Этап изменён тренером')).toBeVisible()
  expect(cache.getQueryData<ClientGoal>(['client-goal', client.id])?.stages).toHaveLength(3)
})
it('does not invent a current stage between dated stages', async () => {
  getGoal.mockResolvedValue({ ...goal, stages: goal.stages.filter(item => item.id !== 'current') }); show()
  expect(await screen.findByText('Сейчас нет текущего этапа')).toBeVisible()
  expect(screen.queryByText(/Этап 0/)).not.toBeInTheDocument()
  expect(screen.getByText('Все подцели · 2')).toBeVisible()
})
it('keeps legacy text as a create seed without inventing an aggregate', async () => {
  getGoal.mockResolvedValue(null); show()
  expect(await screen.findByText('Старый текст')).toBeVisible()
  expect(screen.getByRole('link', { name: 'Добавить цель' })).toBeVisible()
  expect(screen.queryByText(/Все подцели/)).not.toBeInTheDocument()
})
it('keeps goal loading failure distinct from an absent goal and permits retry', async () => {
  getGoal.mockRejectedValueOnce(new Error('network')); const user = userEvent.setup(); show()
  expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось загрузить цель и подцели')
  expect(screen.queryByRole('link', { name: 'Добавить цель' })).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Повторить загрузку цели' }))
  expect(await screen.findByText('Действующая цель')).toBeVisible()
})
