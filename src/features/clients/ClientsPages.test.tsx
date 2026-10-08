import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Client, ProgressEntry, SessionActor } from '../../shared/domain'
import { localDate } from '../../shared/local-date'
import { MyClientEditPage } from './ClientsPages'
import type { SaveOwnAthleteProfileInput } from '../../data/repositories/athlete-sport-profile.repository'
import type { AthleteSportProfile } from '../../shared/sport-interests'

const repository = vi.hoisted(() => ({
  getMine: vi.fn(),
  updateOwn: vi.fn(),
  createOwn: vi.fn(),
}))
const progress = vi.hoisted(() => ({
  list: vi.fn(),
  save: vi.fn(),
}))
const realtime = vi.hoisted(() => ({
  subscribeToClientChanges: vi.fn(() => () => undefined),
}))
const athleteSportProfile = vi.hoisted(() => ({
  supportsSportInterests: true,
  getMine: vi.fn<() => Promise<AthleteSportProfile>>(),
  saveOwn: vi.fn<(input: SaveOwnAthleteProfileInput) => Promise<string>>(),
}))

vi.mock('../../app/auth-context', () => ({
  useAuth: () => ({
    actor: { userId: 'client-1', role: 'client', firstName: 'Анна', lastName: 'Иванова', timezone: 'Europe/Moscow' } as SessionActor,
    refresh: vi.fn().mockResolvedValue(undefined),
  }),
}))
vi.mock('../../app/data-backend-context', () => ({
  useDataBackend: () => ({ source: 'yandex', clients: repository, progress, realtime, athleteSportProfile }),
}))

const client: Client = {
  id: 'client-1', hasAccount: true, fullName: 'Анна Иванова', canonicalFullName: 'Анна Иванова',
  gender: 'female', ageYears: 28, ageUpdatedAt: localDate('2026-09-01'), heightCm: 168,
  goal: null, note: null, currentWeightKg: null, archivedAt: null, version: 1, membershipVersion: null,
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(<MemoryRouter><QueryClientProvider client={queryClient}><MyClientEditPage /></QueryClientProvider></MemoryRouter>)
}

describe('MyClientEditPage', () => {
  beforeEach(() => {
    repository.getMine.mockReset().mockResolvedValue(client)
    repository.updateOwn.mockReset().mockResolvedValue(undefined)
    repository.createOwn.mockReset()
    progress.list.mockReset()
    progress.save.mockReset().mockResolvedValue('progress-1')
    athleteSportProfile.getMine.mockReset().mockResolvedValue({ sports: [], bio: null })
    athleteSportProfile.saveOwn.mockReset().mockResolvedValue('client-1')
  })

  it('offers the initial weight field when the client has no measurements yet, and records it as a progress entry', async () => {
    progress.list.mockResolvedValue([])
    const user = userEvent.setup()
    renderPage()

    const weightInput = await screen.findByLabelText('Начальный вес, кг')
    await user.type(weightInput, '72.5')
    await user.click(screen.getByRole('button', { name: 'Сохранить' }))

    await waitFor(() => expect(athleteSportProfile.saveOwn).toHaveBeenCalledOnce())
    expect(athleteSportProfile.saveOwn.mock.calls[0]?.[0]).toMatchObject({
      clientId: 'client-1', client: { initialWeightKg: 72.5 },
    })
  })

  it('hides the initial weight field once the client already has a measurement', async () => {
    const entry: ProgressEntry = { id: 'p1', clientId: 'client-1', createdBy: 'client-1', recordedOn: localDate('2026-09-10'), weightKg: 70, customMetrics: [], version: 1 }
    progress.list.mockResolvedValue([entry])
    const user = userEvent.setup()
    renderPage()

    await screen.findByLabelText('Имя')
    expect(screen.queryByLabelText('Начальный вес, кг')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Сохранить' }))
    await waitFor(() => expect(athleteSportProfile.saveOwn).toHaveBeenCalledOnce())
    expect(athleteSportProfile.saveOwn.mock.calls[0]?.[0].client.initialWeightKg).toBeUndefined()
  })

  it('still offers the initial weight field for a brand-new self-service profile', async () => {
    repository.getMine.mockResolvedValue(null)
    progress.list.mockResolvedValue([])
    renderPage()

    expect(await screen.findByLabelText('Начальный вес, кг')).toBeVisible()
    expect(progress.list).not.toHaveBeenCalled()
  })

  it('edits only the athlete profile with unlimited sport choices and a private bio', async () => {
    progress.list.mockResolvedValue([])
    athleteSportProfile.getMine.mockResolvedValue({ sports: ['running'], bio: 'Бегаю по утрам' })
    const user = userEvent.setup()
    renderPage()

    expect(await screen.findByRole('heading', { name: 'Редактировать профиль' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Бег' })).toHaveAttribute('aria-pressed', 'true')
    await user.type(screen.getByLabelText('Поиск по видам спорта'), 'йога')
    await user.click(screen.getByRole('button', { name: 'Йога' }))
    await user.clear(screen.getByLabelText('Поиск по видам спорта'))
    await user.click(screen.getByRole('button', { name: 'Плавание' }))
    await user.click(screen.getByRole('button', { name: 'Бокс' }))
    await user.click(screen.getByRole('button', { name: 'Футбол' }))
    await user.click(screen.getByRole('button', { name: 'Походы' }))
    await user.click(screen.getByRole('button', { name: 'Танцы' }))
    await user.click(screen.getByRole('button', { name: 'Сохранить' }))

    await waitFor(() => expect(athleteSportProfile.saveOwn).toHaveBeenCalledOnce())
    expect(athleteSportProfile.saveOwn.mock.calls[0]?.[0].sport).toEqual({
      sports: ['running', 'yoga', 'swimming', 'boxing', 'football', 'hiking', 'dance'], bio: 'Бегаю по утрам',
    })
  })
})
