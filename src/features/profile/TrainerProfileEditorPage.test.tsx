import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { emptyTrainerProfileDraft, TRAINER_SPECIALTIES, TRAINER_SPECIALTIES_MAX } from '../../shared/trainer-profile'
import type { TrainerProfessionalProfile, TrainerProfileDraft } from '../../shared/domain'
import { TrainerProfessionalProfileSection } from './TrainerProfileEditorPage'

const repository = vi.hoisted(() => ({
  getOwn: vi.fn(),
  saveDraft: vi.fn(),
  uploadPhoto: vi.fn(),
  reorderPhotos: vi.fn(),
  deletePhoto: vi.fn(),
  publish: vi.fn(),
  unpublish: vi.fn(),
  setCatalogListing: vi.fn(),
}))
const imagePreparation = vi.hoisted(() => ({
  prepare: vi.fn(),
}))

vi.mock('../../app/auth-context', () => ({
  useAuth: () => ({ actor: { userId: 'trainer-1', role: 'trainer', firstName: 'Анна', lastName: 'Иванова' } }),
}))
vi.mock('../../app/data-backend-context', () => ({
  useDataBackend: () => ({ trainerProfiles: repository }),
}))
vi.mock('../../shared/profile-image', () => ({
  prepareTrainerProfilePhoto: imagePreparation.prepare,
  fileFromImageDataUrl: (value: string) => new File([value], 'saved-photo.jpg', { type: 'image/jpeg' }),
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
    repository.uploadPhoto.mockReset()
    repository.reorderPhotos.mockReset()
    repository.deletePhoto.mockReset()
    repository.publish.mockReset().mockResolvedValue({ ...profile, published: empty, listedInCatalog: true, publishedAt: '2026-09-13T09:01:00.000Z', version: 2 })
    repository.unpublish.mockReset()
    repository.setCatalogListing.mockReset()
    imagePreparation.prepare.mockReset().mockResolvedValue({
      image: { dataUrl: 'data:image/jpeg;base64,/9j/', mimeType: 'image/jpeg', width: 640, height: 480, sizeBytes: 3 },
      thumbnail: { dataUrl: 'data:image/jpeg;base64,/9j/', mimeType: 'image/jpeg', width: 320, height: 240, sizeBytes: 3 },
    })
  })

  it('shows photo upload errors next to the photo control', async () => {
    repository.uploadPhoto.mockRejectedValue(new Error('Не удалось загрузить фото. Попробуйте ещё раз.'))
    const user = userEvent.setup()
    renderSection()

    await user.click(await screen.findByRole('button', { name: 'Заполнить анкету' }))
    await user.upload(screen.getByLabelText('Выбрать фото'), new File(['photo'], 'coach.jpg', { type: 'image/jpeg' }))

    const photos = screen.getByLabelText('Редактирование анкеты тренера').querySelector('.trainer-photo-editor')
    expect(photos).not.toBeNull()
    expect(await within(photos as HTMLElement).findByRole('alert')).toHaveTextContent('Не удалось загрузить фото. Попробуйте ещё раз.')
  })

  it('does not resend the legacy data URL while migrating an existing photo', async () => {
    const legacyDraft = { ...empty, avatarDataUrl: 'data:image/jpeg;base64,/9j/' }
    const legacyProfile = { ...profile, draft: legacyDraft }
    repository.getOwn.mockResolvedValue(legacyProfile)
    repository.uploadPhoto
      .mockResolvedValueOnce({ ...legacyProfile, draft: { ...legacyDraft, avatarDataUrl: null, photos: [] } })
      .mockResolvedValueOnce(legacyProfile)
    const user = userEvent.setup()
    renderSection()

    await user.click(await screen.findByRole('button', { name: 'Редактировать' }))
    await user.upload(screen.getByLabelText('Выбрать фото'), new File(['photo'], 'new.jpg', { type: 'image/jpeg' }))

    await waitFor(() => expect(repository.uploadPhoto).toHaveBeenCalledTimes(2))
    expect(repository.uploadPhoto.mock.calls[0]?.[0]).toMatchObject({ avatarDataUrl: null })
    expect(repository.uploadPhoto.mock.calls[0]?.[2]).toBe(true)
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

    const unpublishButton = await screen.findByRole('button', { name: 'Снять с публикации' })
    expect(unpublishButton).toBeVisible()
    await user.click(unpublishButton)
    expect(screen.getByRole('alertdialog', { name: /Снять анкету с публикации/ })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Отмена' }))
    expect(repository.unpublish).not.toHaveBeenCalled()

    await user.click(screen.getByText('Публикация'))
    await user.click(screen.getByRole('switch', { name: 'Показывать в каталоге' }))
    await waitFor(() => expect(repository.setCatalogListing).toHaveBeenCalledWith(false))
    expect(screen.getByRole('link', { name: 'Открыть анкету' })).toHaveAttribute('href', `/trainers/${profile.publicId}`)

    await user.click(screen.getByRole('button', { name: 'Снять с публикации' }))
    await user.click(screen.getByRole('button', { name: /^Снять$/ }))
    await waitFor(() => expect(repository.unpublish).toHaveBeenCalledTimes(1))
    expect(await screen.findByRole('heading', { name: completeDraft.displayName })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Опубликовать' })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Снять с публикации' })).not.toBeInTheDocument()
  })

  it('blocks duplicate unpublish requests while the profile is being hidden', async () => {
    repository.getOwn.mockResolvedValue(publishedProfile)
    let finishUnpublish: ((value: TrainerProfessionalProfile) => void) | undefined
    repository.unpublish.mockImplementation(() => new Promise<TrainerProfessionalProfile>((resolve) => { finishUnpublish = resolve }))
    const user = userEvent.setup()
    renderSection()

    await user.click(await screen.findByRole('button', { name: 'Снять с публикации' }))
    await user.click(screen.getByRole('button', { name: /^Снять$/ }))

    const pendingButton = await screen.findByRole('button', { name: 'Снимаем с публикации…' })
    expect(pendingButton).toBeDisabled()
    await user.click(pendingButton)
    expect(repository.unpublish).toHaveBeenCalledTimes(1)

    finishUnpublish?.({ ...publishedProfile, published: null, listedInCatalog: false, publishedAt: null })
    expect(await screen.findByRole('button', { name: 'Опубликовать' })).toBeVisible()
  })

  it('keeps the published profile visible after an unpublish error', async () => {
    repository.getOwn.mockResolvedValue(publishedProfile)
    repository.unpublish.mockRejectedValue(new Error('Не удалось снять анкету с публикации.'))
    const user = userEvent.setup()
    renderSection()

    await user.click(await screen.findByRole('button', { name: 'Снять с публикации' }))
    await user.click(screen.getByRole('button', { name: /^Снять$/ }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось снять анкету с публикации.')
    expect(screen.getByRole('button', { name: 'Снять с публикации' })).toBeVisible()
    expect(screen.getByRole('heading', { name: completeDraft.displayName })).toBeVisible()
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

  it('flags the pre-split "Реабилитация и адаптивная физкультура" value as removable instead of dropping it silently', async () => {
    const splitDraft: TrainerProfileDraft = {
      ...completeDraft,
      specialties: ['Кроссфит', 'Реабилитация и адаптивная физкультура (после травм, ограничения по здоровью)'],
    }
    const splitProfile = { ...publishedProfile, draft: splitDraft, published: splitDraft }
    repository.getOwn.mockResolvedValue(splitProfile)
    repository.saveDraft.mockImplementation((draft: TrainerProfileDraft) => Promise.resolve({ ...splitProfile, draft }))
    const user = userEvent.setup()
    renderSection()

    await user.click(await screen.findByRole('button', { name: 'Редактировать' }))
    expect(screen.getByText('Направления · 2/6')).toBeInTheDocument()
    expect(screen.getByText('Реабилитация и адаптивная физкультура (после травм, ограничения по здоровью)')).toBeInTheDocument()
    const group = screen.getByRole('group', { name: 'Направления' })
    expect(within(group).queryByText('Реабилитация и адаптивная физкультура (после травм, ограничения по здоровью)')).not.toBeInTheDocument()
    expect(within(group).getByRole('checkbox', { name: 'Реабилитация после травм и операций' })).not.toBeChecked()

    await user.click(screen.getByRole('button', { name: 'Убрать' }))
    expect(screen.queryByText('Реабилитация и адаптивная физкультура (после травм, ограничения по здоровью)')).not.toBeInTheDocument()
    await user.click(within(group).getByRole('checkbox', { name: 'Адаптивная физическая культура (для людей с особенностями здоровья)' }))
    await user.click(screen.getByRole('button', { name: 'Сохранить' }))

    await waitFor(() => expect(repository.saveDraft).toHaveBeenCalledTimes(1))
    const saved = repository.saveDraft.mock.calls[0]?.[0] as TrainerProfileDraft
    expect(saved.specialties).toEqual(['Кроссфит', 'Адаптивная физическая культура (для людей с особенностями здоровья)'])
  })

  it('caps specialties at six, disables the rest and lets unchecking one free up a slot', async () => {
    const atLimit = [...TRAINER_SPECIALTIES].slice(0, TRAINER_SPECIALTIES_MAX)
    const limitDraft: TrainerProfileDraft = { ...completeDraft, specialties: atLimit }
    const limitProfile = { ...publishedProfile, draft: limitDraft, published: limitDraft }
    repository.getOwn.mockResolvedValue(limitProfile)
    const user = userEvent.setup()
    renderSection()

    await user.click(await screen.findByRole('button', { name: 'Редактировать' }))
    await user.click(screen.getByText(`Направления · ${TRAINER_SPECIALTIES_MAX}/${TRAINER_SPECIALTIES_MAX}`))
    const group = screen.getByRole('group', { name: 'Направления' })
    expect(screen.getByText(`Выбрано максимум направлений (${TRAINER_SPECIALTIES_MAX}). Уберите одно, чтобы выбрать другое.`)).toBeVisible()

    const unselected = within(group).getByRole('checkbox', { name: 'Другое' })
    expect(unselected).toBeDisabled()
    await user.click(unselected)
    expect(unselected).not.toBeChecked()

    await user.click(within(group).getByRole('checkbox', { name: atLimit[0] }))
    expect(screen.queryByText(/Выбрано максимум направлений/)).not.toBeInTheDocument()
    expect(unselected).toBeEnabled()
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

  it('changes the gallery cover and deletes a photo without losing the draft', async () => {
    const photos = [0, 1].map((index) => ({
      id: `11111111-1111-4111-8111-11111111111${index}`,
      url: `https://storage.example/full-${index}.jpg`,
      thumbnailUrl: `https://storage.example/thumb-${index}.jpg`,
      mimeType: 'image/jpeg' as const,
      width: 1200,
      height: 1600,
    }))
    const galleryDraft = { ...completeDraft, photos }
    const galleryProfile = { ...publishedProfile, draft: galleryDraft, published: galleryDraft }
    repository.getOwn.mockResolvedValue(galleryProfile)
    repository.saveDraft.mockResolvedValue(galleryProfile)
    repository.reorderPhotos.mockResolvedValue({
      ...galleryProfile,
      draft: { ...galleryDraft, photos: [photos[1]!, photos[0]!] },
    })
    repository.deletePhoto.mockResolvedValue({
      ...galleryProfile,
      draft: { ...galleryDraft, photos: [photos[0]!] },
    })
    const user = userEvent.setup()
    renderSection()

    await user.click(await screen.findByRole('button', { name: 'Редактировать' }))
    expect(screen.getByText('2/3')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'На обложку' }))
    await waitFor(() => expect(repository.reorderPhotos).toHaveBeenCalledWith([photos[1]!.id, photos[0]!.id]))

    await user.click(screen.getAllByRole('button', { name: 'Удалить' })[0]!)
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: /^Удалить$/ }))
    await waitFor(() => expect(repository.deletePhoto).toHaveBeenCalledWith(photos[1]!.id))
    expect(repository.saveDraft).toHaveBeenCalledWith(expect.objectContaining({ displayName: completeDraft.displayName }))
  })
})
