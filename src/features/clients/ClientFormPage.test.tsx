import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Client, SessionActor } from '../../shared/domain'
import { localDate } from '../../shared/local-date'
import { RepositoryError } from '../../data/repositories/error'
import { ClientFormPage } from './ClientsPages'

const repository = vi.hoisted(() => ({
  get: vi.fn(),
  update: vi.fn(),
  updatePreferences: vi.fn(),
}))
const realtime = vi.hoisted(() => ({
  subscribeToClientChanges: vi.fn(() => () => undefined),
}))

vi.mock('../../app/auth-context', () => ({
  useAuth: () => ({
    actor: { userId: 'trainer-1', role: 'trainer', firstName: 'Антон', lastName: null, timezone: 'Europe/Moscow' } as SessionActor,
  }),
}))
vi.mock('../../app/data-backend-context', () => ({
  useDataBackend: () => ({ clients: repository, realtime, progress: {} }),
}))

const client: Client = {
  id: 'client-1', hasAccount: true, fullName: 'Руфина', canonicalFullName: 'Анна Иванова',
  gender: 'female', ageYears: 28, ageUpdatedAt: localDate('2026-09-01'), heightCm: 168,
  goal: 'Укрепить спину', note: 'Личная заметка', currentWeightKg: null,
  archivedAt: null, version: 4, membershipVersion: 3,
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(<MemoryRouter initialEntries={['/clients/client-1/edit']}>
    <QueryClientProvider client={queryClient}>
      <Routes>
        <Route path="/clients/:clientId/edit" element={<ClientFormPage />} />
        <Route path="/clients/:clientId" element={<p>Карточка сохранена</p>} />
      </Routes>
    </QueryClientProvider>
  </MemoryRouter>)
}

describe('ClientFormPage', () => {
  beforeEach(() => {
    repository.get.mockReset().mockResolvedValue(client)
    repository.update.mockReset().mockResolvedValue(undefined)
    repository.updatePreferences.mockReset().mockResolvedValue(undefined)
    realtime.subscribeToClientChanges.mockClear()
  })

  it('edits the canonical questionnaire without overwriting a trainer alias', async () => {
    const user = userEvent.setup()
    renderPage()

    const name = await screen.findByLabelText('Имя')
    expect(name).toHaveValue('Анна Иванова')
    await user.clear(name)
    await user.type(name, 'Анна Петрова')
    await user.click(screen.getByRole('button', { name: 'Сохранить' }))

    await waitFor(() => expect(repository.update).toHaveBeenCalledWith(expect.objectContaining({
      id: 'client-1', version: 4, fullName: 'Анна Петрова',
    })))
    expect(repository.updatePreferences).not.toHaveBeenCalled()
  })

  it('saves only trainer preferences when the questionnaire did not change', async () => {
    const user = userEvent.setup()
    renderPage()

    const alias = await screen.findByLabelText('Имя в моём списке')
    await user.clear(alias)
    await user.type(alias, 'Руфина в зале')
    await user.click(screen.getByRole('button', { name: 'Сохранить' }))

    await waitFor(() => expect(repository.updatePreferences).toHaveBeenCalledWith({
      clientId: 'client-1', alias: 'Руфина в зале', note: 'Личная заметка', version: 3,
    }))
    expect(repository.update).not.toHaveBeenCalled()
  })

  it('refetches current versions after a real concurrent edit', async () => {
    repository.update.mockRejectedValueOnce(new RepositoryError('PT409', 'Данные уже изменились. Обновите страницу и повторите.'))
    repository.get
      .mockResolvedValueOnce(client)
      .mockResolvedValue({ ...client, version: 5 })
    const user = userEvent.setup()
    renderPage()

    const name = await screen.findByLabelText('Имя')
    await user.clear(name)
    await user.type(name, 'Анна Петрова')
    await user.click(screen.getByRole('button', { name: 'Сохранить' }))

    expect(await screen.findByText('Данные уже изменились. Обновите страницу и повторите.')).toBeVisible()
    await waitFor(() => expect(repository.get).toHaveBeenCalledTimes(2))
  })
})
