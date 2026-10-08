import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Client, ClientGoal } from '../../shared/domain'
import { localDate } from '../../shared/local-date'
import { RepositoryError } from '../../data/repositories/error'
import { GoalPage } from './GoalPages'

const repository = vi.hoisted(() => ({ getClient: vi.fn(), getGoal: vi.fn(), deleteStage: vi.fn() }))
vi.mock('../../app/auth-context', () => ({ useAuth: () => ({ actor: { timezone: 'Europe/Moscow' } }) }))
vi.mock('../../app/data-backend-context', () => ({ useDataBackend: () => ({
  clients: { get: repository.getClient }, goals: { get: repository.getGoal, deleteStage: repository.deleteStage },
}) }))

const client: Client = { id: 'synthetic-client', hasAccount: false, fullName: 'Synthetic client',
  canonicalFullName: 'Synthetic client', gender: null, ageYears: null, ageUpdatedAt: null,
  heightCm: null, goal: null, note: null, currentWeightKg: null, archivedAt: null, version: 1, membershipVersion: 1 }
const goal: ClientGoal = { id: 'synthetic-goal', clientId: client.id, title: 'Синтетическая цель',
  targetDate: null, status: 'active', version: 1, criteria: [], stages: [{ id: 'synthetic-stage',
    goalId: 'synthetic-goal', title: 'Первый этап', startsOn: localDate('2026-10-01'),
    endsOn: localDate('2026-10-31'), position: 0, version: 7 }] }

describe('selected goal stage deletion', () => {
  beforeEach(() => {
    repository.getClient.mockReset().mockResolvedValue(client)
    repository.getGoal.mockReset().mockResolvedValue(goal)
    repository.deleteStage.mockReset().mockRejectedValue(new RepositoryError('PT409', 'Данные уже изменились. Обновите страницу и повторите.'))
  })

  it('keeps the version selected before confirmation even when the query updates the stage', async () => {
    const user = userEvent.setup()
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
    render(<MemoryRouter initialEntries={[`/clients/${client.id}/goal`]}>
      <QueryClientProvider client={queryClient}>
        <Routes><Route path="/clients/:clientId/goal" element={<GoalPage />} /></Routes>
      </QueryClientProvider>
    </MemoryRouter>)
    await screen.findByText('Первый этап')
    await user.click(screen.getByRole('button', { name: /^Удалить$/ }))
    const dialog = screen.getByRole('alertdialog', { name: 'Удалить этап?' })
    act(() => {
      queryClient.setQueryData(['client-goal', client.id], {
        ...goal, stages: goal.stages.map((stage) => ({ ...stage, title: 'Изменённый этап', version: 8 })),
      })
    })
    expect(await screen.findByText('Изменённый этап')).toBeVisible()
    await user.click(within(dialog).getByRole('button', { name: /^Удалить$/ }))
    await waitFor(() => expect(repository.deleteStage).toHaveBeenCalledExactlyOnceWith({ id: 'synthetic-stage', version: 7 }))
    expect(await screen.findByText('Данные уже изменились. Обновите страницу и повторите.')).toBeVisible()
    expect(screen.getByText('Изменённый этап')).toBeVisible()
    expect(repository.getGoal).toHaveBeenCalledTimes(1)
    queryClient.clear()
  })
})
