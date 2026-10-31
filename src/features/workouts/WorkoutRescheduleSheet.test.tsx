import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeAll, beforeEach, expect, it, vi } from 'vitest'
import type { Workout } from '../../shared/domain'
import { localDate } from '../../shared/local-date'
import { RepositoryError } from '../../data/repositories/error'
import { WorkoutRescheduleSheet } from './WorkoutRescheduleSheet'

const backend = vi.hoisted(() => ({ rescheduleSlot: vi.fn(), list: vi.fn(), get: vi.fn() }))
vi.mock('../../app/data-backend-context', () => ({ useDataBackend: () => ({ workouts: backend }) }))
const workout: Workout = { id: 'workout-1', clientId: 'client-1', clientName: 'Спортсмен', workoutDate: localDate('2026-11-02'), createdBy: 'trainer',
  status: 'planned', trainingFormat: 'with_trainer', title: 'Название', startTime: '10:00', endTime: '11:00', startedAt: null, completedAt: null,
  notes: null, stageId: null, stageTitle: null, version: 7, exercises: [] }
function show() {
  const onSaved = vi.fn().mockResolvedValue(undefined), onClose = vi.fn()
  const node = <WorkoutRescheduleSheet workout={workout} onSaved={onSaved} onClose={onClose} />
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const result = render(<QueryClientProvider client={client}>{node}</QueryClientProvider>)
  return { onSaved, onClose, ...result }
}
beforeAll(() => { HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') } })
beforeEach(() => { vi.clearAllMocks(); backend.list.mockResolvedValue([]); backend.rescheduleSlot.mockResolvedValue(8) })
it('preserves duration and submits one existing appointment with an operation ID', async () => {
  const { onSaved } = show()
  await waitFor(() => expect(screen.getByRole('button', { name: 'Перенести' })).toBeEnabled())
  fireEvent.change(screen.getByLabelText('Начало'), { target: { value: '11:30' } })
  expect(screen.getByLabelText('Окончание')).toHaveValue('12:30')
  const save = screen.getByRole('button', { name: 'Перенести' })
  fireEvent.click(save); fireEvent.click(save)
  await waitFor(() => expect(onSaved).toHaveBeenCalledOnce())
  expect(backend.rescheduleSlot).toHaveBeenCalledExactlyOnceWith(workout, { workoutDate: workout.workoutDate, startTime: '11:30', endTime: '12:30' }, expect.any(String))
})
it('keeps a failed draft and reuses the exact operation on retry', async () => {
  backend.rescheduleSlot.mockRejectedValueOnce(new Error('Нет сети'))
  const { onSaved } = show()
  await waitFor(() => expect(screen.getByRole('button', { name: 'Перенести' })).toBeEnabled())
  fireEvent.change(screen.getByLabelText('Начало'), { target: { value: '11:30' } })
  fireEvent.click(screen.getByRole('button', { name: 'Перенести' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Повторить' }))
  await waitFor(() => expect(onSaved).toHaveBeenCalledOnce())
  expect(backend.rescheduleSlot.mock.calls[1]).toEqual(backend.rescheduleSlot.mock.calls[0])
})
it('requires an explicit overlapping action, and cancellation never saves', async () => {
  backend.list.mockResolvedValue([{ ...workout, id: 'other', clientName: 'Другой спортсмен', startTime: '10:30', endTime: '11:30' }])
  const { onClose } = show()
  expect(await screen.findByRole('button', { name: 'Перенести всё равно' })).toBeEnabled()
  fireEvent.click(screen.getByRole('button', { name: 'Отмена' }))
  expect(onClose).toHaveBeenCalledOnce(); expect(backend.rescheduleSlot).not.toHaveBeenCalled()
})
it('blocks stale writes and opens the fresh record after a version conflict', async () => {
  backend.rescheduleSlot.mockRejectedValueOnce(new RepositoryError('PT409', 'Конфликт'))
  backend.get.mockResolvedValue({ ...workout, version: 8, startTime: '10:30' })
  const { onClose } = show()
  await waitFor(() => expect(screen.getByRole('button', { name: 'Перенести' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: 'Перенести' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Открыть актуальную запись' }))
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
  expect(backend.rescheduleSlot).toHaveBeenCalledOnce(); expect(backend.get).toHaveBeenCalledWith(workout.id)
})
