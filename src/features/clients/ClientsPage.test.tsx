import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import type { Client } from '../../shared/domain'
import { ClientsPage } from './ClientsListPage'

const repository = vi.hoisted(() => ({ list: vi.fn() }))
vi.mock('../../app/data-backend-context', () => ({
  useDataBackend: () => ({ clients: { list: repository.list } }),
}))

// Из workouts.repository экрану нужен только формат ИМТ, а тест проверяет
// поиск, а не расчёт. Заглушка держит тест на одном модуле вместо всего
// репозитория тренировок.
vi.mock('../../data/repositories/workouts.repository', () => ({ bmiLabel: () => '23.3' }))

const client = (id: string, fullName: string): Client => ({
  id, fullName, canonicalFullName: fullName, hasAccount: false, gender: null,
  ageYears: null, ageUpdatedAt: null, heightCm: null, goal: null, note: null,
  currentWeightKg: null, archivedAt: null, version: 1, membershipVersion: null,
})

const NAMES = ['Анна Смирнова', 'Борис Иванов', 'Вера Кузнецова', 'Глеб Орлов', 'Дарья Ершова', 'Егор Панов']

function renderPage(clients: Client[]) {
  repository.list.mockResolvedValue(clients)
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<MemoryRouter><QueryClientProvider client={queryClient}><ClientsPage /></QueryClientProvider></MemoryRouter>)
}

describe('ClientsPage search', () => {
  it('filters by name and clears the query from the field itself', async () => {
    const user = userEvent.setup()
    renderPage(NAMES.map((name, index) => client(`c${index}`, name)))

    const field = await screen.findByLabelText('Поиск клиента')
    expect(screen.queryByRole('button', { name: 'Очистить поиск' })).not.toBeInTheDocument()

    await user.type(field, 'кузнец')
    expect(screen.getByText('Вера Кузнецова')).toBeVisible()
    expect(screen.queryByText('Анна Смирнова')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Очистить поиск' }))
    expect(field).toHaveValue('')
    expect(screen.getByText('Анна Смирнова')).toBeVisible()
  })

  it('explains an empty result instead of showing a bare list', async () => {
    const user = userEvent.setup()
    renderPage(NAMES.map((name, index) => client(`c${index}`, name)))

    await user.type(await screen.findByLabelText('Поиск клиента'), 'Ярослав')
    expect(screen.getByText('По этому имени клиентов не найдено.')).toBeVisible()
  })

  it('hides the field while the list is still short enough to scan', async () => {
    renderPage(NAMES.slice(0, 5).map((name, index) => client(`c${index}`, name)))

    expect(await screen.findByText('Анна Смирнова')).toBeVisible()
    expect(screen.queryByLabelText('Поиск клиента')).not.toBeInTheDocument()
  })
})
