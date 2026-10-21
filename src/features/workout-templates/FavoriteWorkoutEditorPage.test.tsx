import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
import type { FavoriteWorkoutTemplate } from '../../shared/domain'
import { FavoriteWorkoutEditorPage } from './FavoriteWorkoutEditorPage'

const backend = vi.hoisted(() => ({ favoriteWorkouts: { list: vi.fn(), update: vi.fn() } }))
vi.mock('../../app/auth-context', () => ({ useAuth: () => ({ actor: { userId: 'client', role: 'client' } }) }))
vi.mock('../../app/data-backend-context', () => ({ useDataBackend: () => backend }))
vi.mock('../exercises', () => ({ useExerciseCatalog: () => ({ exercises: [] }), ExercisePicker: () => null }))
vi.mock('../workouts', () => ({
  WorkoutHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
  WorkoutExerciseEditor: () => null,
  WorkoutCta: ({ pending, pendingLabel, disabled, children, ...props }: { pending: boolean; pendingLabel: string; disabled: boolean; children: React.ReactNode }) => <button {...props} disabled={pending || disabled}>{pending ? pendingLabel : children}</button>,
}))
const favorite: FavoriteWorkoutTemplate = {
  id: '10000000-0000-4000-8000-000000000001', title: 'Ноги', version: 1, createdAt: '2026-10-21T00:00:00Z',
  exercises: [{ source: 'system', ref: 'squat', name: 'Присед', muscleGroup: 'legs', inputKind: 'strength', position: 0, sets: [{ position: 0, weightKg: 50, reps: 8 }] }],
}
function open() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const router = createMemoryRouter([
    { path: '/me/workouts/favorites/:favoriteId/edit', element: <FavoriteWorkoutEditorPage /> },
    { path: '/me/workouts', element: <h1>Готовые тренировки</h1> },
  ], { initialEntries: [`/me/workouts/favorites/${favorite.id}/edit`] })
  render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>)
  return { router, client }
}
beforeEach(() => {
  vi.clearAllMocks()
  const values = new Map<string, string>()
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) })
  backend.favoriteWorkouts.list.mockResolvedValue([favorite])
  backend.favoriteWorkouts.update.mockResolvedValue({ ...favorite, version: 2 })
})
it('edits the existing snapshot, retains failed input, and returns only after success', async () => {
  backend.favoriteWorkouts.update.mockRejectedValueOnce(new Error('Нет соединения'))
  open()
  const name = await screen.findByLabelText('Название')
  fireEvent.change(name, { target: { value: 'Новый план' } })
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить изменения' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Нет соединения')
  expect(name).toHaveValue('Новый план')
  expect(backend.favoriteWorkouts.update).toHaveBeenCalledExactlyOnceWith(favorite.id, 1, 'Новый план', favorite.exercises)
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить изменения' }))
  await screen.findByRole('heading', { name: 'Готовые тренировки' })
  expect(backend.favoriteWorkouts.update).toHaveBeenCalledTimes(2)
})
it('protects dirty edits on navigation and permits cancelling the exit', async () => {
  open()
  fireEvent.change(await screen.findByLabelText('Название'), { target: { value: 'Черновик' } })
  fireEvent.click(screen.getByRole('button', { name: 'Назад' }))
  await screen.findByRole('alertdialog')
  fireEvent.click(screen.getByRole('button', { name: 'Отмена' }))
  expect(screen.getByLabelText('Название')).toHaveValue('Черновик')
  expect(backend.favoriteWorkouts.update).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Назад' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Выйти' }))
  await screen.findByRole('heading', { name: 'Готовые тренировки' })
})
it('does not upgrade a restored draft to a newer server version', async () => {
  localStorage.setItem(`fit.favorite-workout-edit.client.${favorite.id}`, JSON.stringify({ id: favorite.id, name: 'Старый черновик', notes: '', version: 1, exercises: favorite.exercises }))
  backend.favoriteWorkouts.list.mockResolvedValue([{ ...favorite, version: 2 }])
  backend.favoriteWorkouts.update.mockRejectedValue(new Error('Данные изменились'))
  open()
  await waitFor(() => expect(screen.getByLabelText('Название')).toHaveValue('Старый черновик'))
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить изменения' }))
  await screen.findByRole('alert')
  expect(backend.favoriteWorkouts.update).toHaveBeenCalledExactlyOnceWith(favorite.id, 1, 'Старый черновик', favorite.exercises)
})
it('shows a missing snapshot without mounting an empty editor', async () => {
  backend.favoriteWorkouts.list.mockResolvedValue([])
  open()
  await screen.findByRole('heading', { name: 'Тренировка больше недоступна' })
  expect(screen.queryByLabelText('Название')).not.toBeInTheDocument()
})
it('shows a failed initial load with retry instead of an empty editor', async () => {
  backend.favoriteWorkouts.list.mockRejectedValueOnce(new Error('Нет соединения'))
  open()
  await screen.findByRole('alert')
  expect(screen.queryByLabelText('Название')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Повторить' }))
  await screen.findByLabelText('Название')
})
