import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TrainerCatalogFilters, TrainerProfessionalProfile } from '../../shared/domain'
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

const catalogPage = (items = [profile], totalCount = items.length, nextOffset: number | null = null) => ({
  items, totalCount, nextOffset,
})

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<MemoryRouter><div className="content"><QueryClientProvider client={client}><TrainerCatalogPage /></QueryClientProvider></div></MemoryRouter>)
}

describe('TrainerCatalogPage', () => {
  beforeEach(() => {
    window.sessionStorage.clear()
    listCatalog.mockReset().mockResolvedValue(catalogPage())
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
      configurable: true,
      value: function scrollTo(this: HTMLElement, options?: ScrollToOptions | number, y?: number) {
        this.scrollTop = typeof options === 'number' ? (y ?? 0) : (options?.top ?? 0)
      },
    })
  })

  it('shows a compact trainer card and opens the full published profile', async () => {
    renderPage()

    const results = await screen.findByRole('region', { name: 'Найденные тренеры' })
    expect(within(results).getByRole('heading', { name: 'Анна Иванова' })).toBeVisible()
    expect(within(results).getByText(/Онлайн · Москва/)).toBeVisible()
    expect(within(results).getByRole('link', { name: 'Посмотреть анкету' })).toHaveAttribute('href', `/trainers/${profile.publicId}`)
  })

  it('applies optional filters from a compact dialog and shows their count', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Анна Иванова')

    await user.click(screen.getByRole('button', { name: 'Фильтры' }))
    const dialog = screen.getByRole('dialog', { name: 'Фильтры тренеров' })
    await user.type(within(dialog).getByLabelText('Направление'), 'Бег')
    await user.type(within(dialog).getByLabelText('Город'), 'Казань')
    await user.selectOptions(within(dialog).getByLabelText('Формат'), 'online')
    await user.selectOptions(within(dialog).getByLabelText('Новые клиенты'), 'true')
    await user.click(within(dialog).getByRole('button', { name: 'Показать тренеров' }))

    await waitFor(() => expect(listCatalog).toHaveBeenLastCalledWith({
      query: '', specialty: 'Бег', city: 'Казань', mode: 'online', acceptingClients: true,
    }, { offset: 0, limit: 20 }))
    expect(screen.getByRole('button', { name: 'Фильтры · 4' })).toBeVisible()
    expect(screen.queryByRole('dialog', { name: 'Фильтры тренеров' })).not.toBeInTheDocument()
  })

  it('clears the name immediately and resets an empty result', async () => {
    listCatalog.mockImplementation((filters: TrainerCatalogFilters) => Promise.resolve(catalogPage(filters.query ? [] : [profile])))
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Анна Иванова')

    await user.type(screen.getByLabelText('Имя тренера'), 'Мария')
    await user.click(screen.getByRole('button', { name: 'Найти' }))
    expect(await screen.findByText('Тренеры не найдены')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Сбросить фильтры' }))

    expect(await screen.findByText('Анна Иванова')).toBeVisible()
    expect(screen.getByLabelText('Имя тренера')).toHaveValue('')
    await user.type(screen.getByLabelText('Имя тренера'), 'Ан')
    await user.click(screen.getByRole('button', { name: 'Очистить имя тренера' }))
    expect(screen.getByLabelText('Имя тренера')).toHaveValue('')
  })

  it('restores search filters and list position after opening a profile', async () => {
    const user = userEvent.setup()
    const first = renderPage()
    await screen.findByText('Анна Иванова')
    await user.type(screen.getByLabelText('Имя тренера'), 'Анна')
    await user.click(screen.getByRole('button', { name: 'Найти' }))
    const content = document.querySelector<HTMLElement>('.content')!
    content.scrollTop = 420
    await user.click(screen.getByRole('link', { name: 'Посмотреть анкету' }))
    first.unmount()

    renderPage()
    expect(screen.getByLabelText('Имя тренера')).toHaveValue('Анна')
    await waitFor(() => expect(listCatalog).toHaveBeenLastCalledWith(expect.objectContaining({ query: 'Анна' }), { offset: 0, limit: 20 }))
    await waitFor(() => expect(document.querySelector<HTMLElement>('.content')?.scrollTop).toBe(420))
  })

  it('shows the full result count and loads the next page without replacing the first', async () => {
    const second = { ...profile, publicId: '22222222-2222-4222-8222-222222222222',
      draft: { ...profile.draft, displayName: 'Мария Петрова' },
      published: { ...profile.published!, displayName: 'Мария Петрова' } }
    listCatalog.mockImplementation((_filters: TrainerCatalogFilters, page: { offset: number }) =>
      Promise.resolve(page.offset === 0 ? catalogPage([profile], 2, 1) : catalogPage([second], 2)))
    const user = userEvent.setup()
    renderPage()

    expect(await screen.findByText('Найдено: 2')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Показать ещё' }))

    expect(await screen.findByText('Мария Петрова')).toBeVisible()
    expect(screen.getByText('Анна Иванова')).toBeVisible()
    expect(listCatalog).toHaveBeenLastCalledWith({ query: '', specialty: '', city: '', mode: '', acceptingClients: null }, { offset: 1, limit: 20 })
    expect(screen.queryByRole('button', { name: 'Показать ещё' })).not.toBeInTheDocument()
  })

  it('keeps the current page and retries when loading more fails', async () => {
    let secondPageAttempts = 0
    listCatalog.mockImplementation((_filters: TrainerCatalogFilters, page: { offset: number }) => {
      if (page.offset === 0) return Promise.resolve(catalogPage([profile], 2, 1))
      secondPageAttempts += 1
      return secondPageAttempts === 1
        ? Promise.reject(new Error('network'))
        : Promise.resolve(catalogPage([{ ...profile, publicId: '33333333-3333-4333-8333-333333333333' }], 2))
    })
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Анна Иванова')

    await user.click(screen.getByRole('button', { name: 'Показать ещё' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось загрузить ещё анкеты.')
    expect(screen.getByText('Анна Иванова')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Повторить' }))

    await waitFor(() => expect(secondPageAttempts).toBe(2))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
