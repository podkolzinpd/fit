import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Client, Workout } from '../../shared/domain'
import { localDate } from '../../shared/local-date'
import { QuickStartWorkout, TrainerActiveWorkouts } from './QuickStartWorkout'

const mocks = vi.hoisted(() => ({ quickStart: vi.fn(), invalidate: vi.fn() }))
vi.mock('../../app/data-backend-context', () => ({ useDataBackend: () => ({ workouts: { quickStart: mocks.quickStart } }) }))
vi.mock('../../app/auth-context', () => ({ useAuth: () => ({ actor: { userId: 'trainer-1' } }) }))
vi.mock('../../app/invalidate-workout-results', () => ({ invalidateWorkoutResults: mocks.invalidate }))

const client: Client = {
  id: 'b3942b20-52a2-4d5d-9895-b3b63cf61442', fullName: 'Анна', canonicalFullName: 'Анна', hasAccount: true,
  gender: null, ageYears: null, ageUpdatedAt: null, heightCm: null, goal: null, note: null,
  currentWeightKg: null, archivedAt: null, version: 1, membershipVersion: null,
}
const workoutId = '12acc6d6-7ca8-43cd-b124-b4224c917fae'

function view(element: React.ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}><MemoryRouter initialEntries={['/today']}><Routes>
    <Route path="/today" element={element} />
    <Route path="/workouts/:id/live" element={<p>Открыта Live-тренировка</p>} />
  </Routes></MemoryRouter></QueryClientProvider>)
}

describe('QuickStartWorkout', () => {
  beforeEach(() => { mocks.quickStart.mockReset(); mocks.invalidate.mockResolvedValue(undefined) })

  it('starts a client workout and opens Live without an intermediate plan', async () => {
    mocks.quickStart.mockResolvedValue({ id: workoutId, resumed: false })
    view(<QuickStartWorkout role="client" clientId={client.id} workouts={[]} returnTo="/me" />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Начать тренировку' }))
    expect(await screen.findByText('Открыта Live-тренировка')).toBeVisible()
    expect(mocks.quickStart).toHaveBeenCalledOnce()
    expect(mocks.quickStart).toHaveBeenCalledWith(client.id, expect.any(String), 'self')
  })

  it('requires a trainer to select a client before creating the session', async () => {
    mocks.quickStart.mockResolvedValue({ id: workoutId, resumed: false })
    const user = userEvent.setup()
    view(<QuickStartWorkout role="trainer" clients={[client]} workouts={[]} returnTo="/today" />)
    await user.click(screen.getByRole('button', { name: 'Начать тренировку' }))
    expect(mocks.quickStart).not.toHaveBeenCalled()
    await user.click(screen.getByText('Анна'))
    expect(mocks.quickStart).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'С тренером' })).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: 'Начать' }))
    expect(await screen.findByText('Открыта Live-тренировка')).toBeVisible()
    expect(mocks.quickStart).toHaveBeenCalledWith(client.id, expect.any(String), 'with_trainer')
  })

  it('starts Lime immediately on client selection and retries the same command', async () => {
    mocks.quickStart.mockRejectedValueOnce(new Error('network')).mockResolvedValue({ id: workoutId, resumed: true })
    const user = userEvent.setup()
    view(<QuickStartWorkout role="trainer" clients={[client]} workouts={[]} returnTo="/today" startOnClientSelection initialPickerOpen />)
    expect(mocks.quickStart).not.toHaveBeenCalled()
    await user.click(screen.getByText('Анна'))
    await user.click(await screen.findByRole('button', { name: 'Повторить' }))
    expect(await screen.findByText('Открыта Live-тренировка')).toBeVisible()
    expect(mocks.quickStart).toHaveBeenCalledTimes(2)
    expect(mocks.quickStart.mock.calls[0]).toEqual(mocks.quickStart.mock.calls[1])
    expect(mocks.quickStart.mock.calls[0]).toEqual([client.id, expect.any(String), 'with_trainer'])
    expect(screen.queryByRole('button', { name: 'Начать' })).not.toBeInTheDocument()
  })

  it('does not start a workout when Lime client selection is cancelled', async () => {
    const cancel = vi.fn()
    view(<QuickStartWorkout role="trainer" clients={[client]} workouts={[]} returnTo="/today" startOnClientSelection initialPickerOpen onPickerCancel={cancel} />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Закрыть' }))
    expect(cancel).toHaveBeenCalledOnce()
    expect(mocks.quickStart).not.toHaveBeenCalled()
  })

  it('supports the calendar label without changing the start command', async () => {
    mocks.quickStart.mockResolvedValue({ id: workoutId, resumed: false })
    const pending = vi.fn()
    const user = userEvent.setup()
    view(<QuickStartWorkout role="trainer" clientId={client.id} workouts={[]} returnTo="/today?date=2026-09-29" compact startLabel="Начать сейчас" onPendingChange={pending} />)
    await user.click(screen.getByRole('button', { name: 'Начать сейчас' }))
    expect(mocks.quickStart).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Начать' }))
    expect(await screen.findByText('Открыта Live-тренировка')).toBeVisible()
    expect(mocks.quickStart).toHaveBeenCalledWith(client.id, expect.any(String), 'with_trainer')
    expect(pending).toHaveBeenCalledWith(false)
  })

  it('keeps a trainers self format and operation on retry', async () => {
    mocks.quickStart.mockRejectedValueOnce(new Error('network')).mockResolvedValue({ id: workoutId, resumed: true })
    const user = userEvent.setup()
    view(<QuickStartWorkout role="trainer" clientId={client.id} clients={[client]} workouts={[]} returnTo="/today" />)
    await user.click(screen.getByRole('button', { name: 'Начать тренировку' }))
    await user.click(screen.getByRole('button', { name: 'Самостоятельно' }))
    await user.click(screen.getByRole('button', { name: 'Начать' }))
    await user.click(await screen.findByRole('button', { name: 'Повторить' }))
    expect(await screen.findByText('Открыта Live-тренировка')).toBeVisible()
    expect(mocks.quickStart.mock.calls[0]).toEqual(mocks.quickStart.mock.calls[1])
    expect(mocks.quickStart.mock.calls[1]?.[2]).toBe('self')
  })

  it('continues an active client session without another write', async () => {
    const active = {
      id: workoutId, clientId: client.id, clientName: client.fullName, status: 'in_progress',
      workoutDate: localDate('2026-10-01'), startedAt: '2026-10-01T08:00:00Z',
    } as Workout
    view(<QuickStartWorkout role="client" clientId={client.id} workouts={[active]} returnTo="/me" />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Продолжить тренировку' }))
    expect(await screen.findByText('Открыта Live-тренировка')).toBeVisible()
    expect(mocks.quickStart).not.toHaveBeenCalled()
  })

  it('lets a connected trainer continue a client-authored session returned by the read model', async () => {
    const active = {
      id: workoutId, clientId: client.id, clientName: client.fullName, status: 'in_progress',
      createdBy: 'client-actor', workoutDate: localDate('2026-10-01'),
    } as Workout
    view(<QuickStartWorkout role="trainer" clientId={client.id} workouts={[active]} returnTo={`/clients/${client.id}`} compact />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Продолжить тренировку' }))
    expect(await screen.findByText('Открыта Live-тренировка')).toBeVisible()
    expect(mocks.quickStart).not.toHaveBeenCalled()
  })

  it('retries an ambiguous failure with the same operation ID', async () => {
    mocks.quickStart.mockRejectedValueOnce(new Error('network')).mockResolvedValue({ id: workoutId, resumed: true })
    const user = userEvent.setup()
    view(<QuickStartWorkout role="client" clientId={client.id} workouts={[]} returnTo="/me" />)
    await user.click(screen.getByRole('button', { name: 'Начать тренировку' }))
    await user.click(await screen.findByRole('button', { name: 'Повторить' }))
    expect(await screen.findByText('Открыта Live-тренировка')).toBeVisible()
    expect(mocks.quickStart.mock.calls[0]?.[1]).toBe(mocks.quickStart.mock.calls[1]?.[1])
  })

  it('keeps start disabled until trainer clients and workouts are loaded', () => {
    view(<QuickStartWorkout role="trainer" clients={[]} workouts={[]} returnTo="/today" />)
    expect(screen.getByRole('button', { name: 'Начать тренировку' })).toBeDisabled()
    expect(screen.getByRole('link', { name: 'добавьте клиента' })).toHaveAttribute('href', '/clients/new')
  })

  it('lists every accessible active session with its client name', () => {
    const first = { id: workoutId, clientId: client.id, clientName: 'Анна', status: 'in_progress', createdBy: 'trainer-1' } as Workout
    const second = { ...first, id: '42acc6d6-7ca8-43cd-b124-b4224c917fae', clientId: 'other-client', clientName: 'Борис' }
    view(<TrainerActiveWorkouts workouts={[first, second]} returnTo="/today" />)
    expect(screen.getByRole('link', { name: /Анна/ })).toHaveAttribute('href', `/workouts/${first.id}/live`)
    expect(screen.getByRole('link', { name: /Борис/ })).toHaveAttribute('href', `/workouts/${second.id}/live`)
  })
})
