import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { emptyTrainerProfileDraft, TRAINER_SPECIALTIES } from '../../shared/trainer-profile'
import type { TrainerProfessionalProfile, TrainerProfileDraft } from '../../shared/domain'
import { TrainerProfessionalProfileSection } from './TrainerProfileEditorPage'

const repository = vi.hoisted(() => ({
  getOwn: vi.fn(),
  saveDraft: vi.fn(),
  publish: vi.fn(),
  unpublish: vi.fn(),
  setCatalogListing: vi.fn(),
}))

vi.mock('../../app/auth-context', () => ({
  useAuth: () => ({ actor: { userId: 'trainer-1', role: 'trainer', firstName: 'Анна', lastName: 'Иванова' } }),
}))
vi.mock('../../app/data-backend-context', () => ({
  useDataBackend: () => ({ trainerProfiles: repository }),
}))

const empty = emptyTrainerProfileDraft('Анна Иванова')
const profile: TrainerProfessionalProfile = {
  publicId: '11111111-1111-4111-8111-111111111111',
  draft: empty,
  published: null,
  listedInCatalog: false,
  publishedAt: null,
  updatedAt: '2026-09-13T09:00:00.000Z',
  version: 1,
  isBrandTrainer: false,
}

const completeDraft: TrainerProfileDraft = {
  ...empty,
  bio: 'Помогаю тренироваться регулярно и безопасно.',
  specialties: ['Кроссфит', 'Йога / пилатес / стретчинг'],
  city: 'Москва',
  trainingModes: ['online', 'in_person'],
  experienceStartYear: 2020,
  education: 'Высшее физкультурное образование.',
  formats: 'Созвон и персональный план.',
  price: 'От 3 000 ₽',
  acceptingClients: true,
  certificates: [{ title: 'Персональный тренер', organization: 'Fit Academy', year: 2025 }],
}

const publishedProfile: TrainerProfessionalProfile = {
  ...profile,
  draft: completeDraft,
  published: completeDraft,
  listedInCatalog: true,
  publishedAt: '2026-09-13T09:01:00.000Z',
}

function renderSection() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(<MemoryRouter><QueryClientProvider client={client}><TrainerProfessionalProfileSection /></QueryClientProvider></MemoryRouter>)
}

describe('TrainerProfessionalProfileSection', () => {
  beforeEach(() => {
    repository.getOwn.mockReset().mockResolvedValue(profile)
    repository.saveDraft.mockReset().mockResolvedValue(profile)
    repository.publish.mockReset().mockResolvedValue({ ...profile, published: empty, listedInCatalog: true, publishedAt: '2026-09-13T09:01:00.000Z', version: 2 })
    repository.unpublish.mockReset()
    repository.setCatalogListing.mockReset()
  })

  it('publishes a profile whose optional fields are all empty', async () => {
    const user = userEvent.setup()
    renderSection()

    expect(await screen.findByRole('button', { name: 'Опубликовать' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Заполнить анкету' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Опубликовать' }))

    await waitFor(() => expect(repository.saveDraft).toHaveBeenCalledWith(empty))
    expect(repository.publish).toHaveBeenCalledTimes(1)
    expect(await screen.findByText('Видна в каталоге')).toBeVisible()
  })

  it('edits and saves the complete profile without losing optional sections', async () => {
    repository.getOwn.mockResolvedValue(publishedProfile)
    repository.saveDraft.mockImplementation((draft: TrainerProfileDraft) => Promise.resolve({ ...publishedProfile, draft }))
    const user = userEvent.setup()
    renderSection()

    await user.click(await screen.findByRole('button', { name: 'Редактировать' }))
    await user.clear(screen.getByLabelText('О себе'))
    await user.type(screen.getByLabelText('О себе'), 'Новый короткий текст.')
    await user.click(screen.getByRole('checkbox', { name: 'Кроссфит' }))
    await user.click(screen.getByRole('checkbox', { name: 'Похудение и коррекция фигуры' }))
    await user.click(screen.getByRole('switch', { name: 'Онлайн' }))
    await user.type(screen.getByRole('combobox', { name: 'Метро Москвы' }), 'Динамо')
    await user.click(await screen.findByRole('option', { name: /Динамо/ }))
    await user.click(screen.getByRole('button', { name: 'Убрать станцию Динамо' }))
    expect(screen.queryByRole('list', { name: 'Выбранные станции метро' })).not.toBeInTheDocument()
    await user.type(screen.getByRole('combobox', { name: 'Метро Москвы' }), 'Динамо')
    await user.click(await screen.findByRole('option', { name: /Динамо/ }))
    await user.type(screen.getByLabelText('Клуб, район или адрес'), 'World Class Динамо')
    await user.click(screen.getByRole('button', { name: 'Добавить' }))
    await user.click(screen.getByRole('button', { name: 'Добавить сертификат' }))
    await user.type(screen.getByLabelText('Название сертификата 2'), 'Тренер по йоге')
    await user.click(screen.getByRole('button', { name: 'Сохранить' }))

    await waitFor(() => expect(repository.saveDraft).toHaveBeenCalledTimes(1))
    const saved = repository.saveDraft.mock.calls[0]?.[0] as TrainerProfileDraft | undefined
    expect(saved?.bio).toBe('Новый короткий текст.')
    expect(saved?.specialties).toEqual(['Йога / пилатес / стретчинг', 'Похудение и коррекция фигуры'])
    expect(saved?.trainingModes).toEqual(['in_person'])
    expect(saved?.metroStationIds).toEqual(['msk-dinamo'])
    expect(saved?.customLocations).toEqual(['World Class Динамо'])
    expect(saved?.certificates).toHaveLength(2)
  })

  it('keeps publication controls available for an already published profile', async () => {
    repository.getOwn.mockResolvedValue(publishedProfile)
    repository.setCatalogListing.mockResolvedValue({ ...publishedProfile, listedInCatalog: false })
    repository.unpublish.mockResolvedValue({ ...publishedProfile, published: null, listedInCatalog: false, publishedAt: null })
    const user = userEvent.setup()
    renderSection()

    await user.click(await screen.findByText('Публикация'))
    await user.click(screen.getByRole('switch', { name: 'Показывать в каталоге' }))
    await waitFor(() => expect(repository.setCatalogListing).toHaveBeenCalledWith(false))
    expect(screen.getByRole('link', { name: 'Открыть анкету' })).toHaveAttribute('href', `/trainers/${profile.publicId}`)
    await user.click(screen.getByRole('button', { name: 'Снять с публикации' }))
    await waitFor(() => expect(repository.unpublish).toHaveBeenCalledTimes(1))
  })

  it('shows all standardized specialty checkboxes and keeps a legacy free-text value intact when toggling a standard one', async () => {
    const legacyDraft: TrainerProfileDraft = { ...completeDraft, specialties: ['Кроссфит', 'Индивидуальный подход к каждому'] }
    const legacyProfile = { ...publishedProfile, draft: legacyDraft, published: legacyDraft }
    repository.getOwn.mockResolvedValue(legacyProfile)
    repository.saveDraft.mockImplementation((draft: TrainerProfileDraft) => Promise.resolve({ ...legacyProfile, draft }))
    const user = userEvent.setup()
    renderSection()

    await user.click(await screen.findByRole('button', { name: 'Редактировать' }))
    const group = screen.getByRole('group', { name: 'Направления' })
    expect(within(group).getAllByRole('checkbox')).toHaveLength(TRAINER_SPECIALTIES.length)
    expect(within(group).getByRole('checkbox', { name: 'Кроссфит' })).toBeChecked()
    expect(within(group).getByRole('checkbox', { name: 'Другое' })).not.toBeChecked()

    await user.click(within(group).getByRole('checkbox', { name: 'Йога / пилатес / стретчинг' }))
    await user.click(screen.getByRole('button', { name: 'Сохранить' }))

    await waitFor(() => expect(repository.saveDraft).toHaveBeenCalledTimes(1))
    const saved = repository.saveDraft.mock.calls[0]?.[0] as TrainerProfileDraft
    expect(saved.specialties).toEqual(['Кроссфит', 'Индивидуальный подход к каждому', 'Йога / пилатес / стретчинг'])
  })

  it('restores saved values when editing is cancelled', async () => {
    repository.getOwn.mockResolvedValue(publishedProfile)
    const user = userEvent.setup()
    renderSection()

    await user.click(await screen.findByRole('button', { name: 'Редактировать' }))
    await user.clear(screen.getByLabelText('Имя в анкете'))
    await user.type(screen.getByLabelText('Имя в анкете'), 'Другое имя')
    await user.click(screen.getByRole('button', { name: 'Отмена' }))

    expect(await screen.findByRole('heading', { name: 'Анна Иванова' })).toBeVisible()
    expect(repository.saveDraft).not.toHaveBeenCalled()
  })
})
