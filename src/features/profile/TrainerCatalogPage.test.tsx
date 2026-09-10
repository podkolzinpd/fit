import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TrainerProfessionalProfile } from '../../shared/domain'
import { TrainerCatalogPage } from './TrainerCatalogPage'

const listCatalog = vi.hoisted(() => vi.fn())
vi.mock('../../app/data-backend-context', () => ({
  useDataBackend: () => ({ trainerProfiles: { listCatalog } }),
}))

const profile: TrainerProfessionalProfile = {
  publicId: '11111111-1111-4111-8111-111111111111',
  draft: {
    displayName: 'Анна Иванова', bio: 'Помогаю начать заниматься и спокойно двигаться к результату.',
    specialties: ['Силовые'], city: 'Москва', trainingModes: ['online'], experienceStartYear: 2020,
    education: '', formats: '', price: 'от 3 000 ₽', acceptingClients: true, avatarDataUrl: null, certificates: [],
  },
  published: {
    displayName: 'Анна Иванова', bio: 'Помогаю начать заниматься и спокойно двигаться к результату.',
    specialties: ['Силовые'], city: 'Москва', trainingModes: ['online'], experienceStartYear: 2020,
    education: '', formats: '', price: 'от 3 000 ₽', acceptingClients: true, avatarDataUrl: null, certificates: [],
  },
  listedInCatalog: true,
  publishedAt: '2026-09-10T09:00:00.000Z', updatedAt: '2026-09-10T09:00:00.000Z', version: 2,
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<MemoryRouter><QueryClientProvider client={client}><TrainerCatalogPage /></QueryClientProvider></MemoryRouter>)
}

describe('TrainerCatalogPage', () => {
  beforeEach(() => listCatalog.mockReset().mockResolvedValue([profile]))

  it('shows a compact trainer card and opens the full published profile', async () => {
    renderPage()

    const results = await screen.findByRole('region', { name: 'Найденные тренеры' })
    expect(within(results).getByRole('heading', { name: 'Анна Иванова' })).toBeVisible()
    expect(within(results).getByText(/Онлайн · Москва/)).toBeVisible()
    expect(within(results).getByRole('link', { name: 'Посмотреть анкету' })).toHaveAttribute('href', `/trainers/${profile.publicId}`)
  })

  it('applies understandable optional filters only after search', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Анна Иванова')

    await user.click(screen.getByRole('button', { name: 'Фильтры' }))
    await user.type(screen.getByLabelText('Направление'), 'Бег')
    await user.type(screen.getByLabelText('Город'), 'Казань')
    await user.selectOptions(screen.getByLabelText('Формат'), 'online')
    await user.selectOptions(screen.getByLabelText('Новые клиенты'), 'true')
    await user.click(screen.getByRole('button', { name: 'Найти' }))

    expect(listCatalog).toHaveBeenLastCalledWith({
      query: '', specialty: 'Бег', city: 'Казань', mode: 'online', acceptingClients: true,
    })
  })
})
