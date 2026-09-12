import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { SessionActor, TrainerProfessionalProfile } from '../../shared/domain'
import { PublicTrainerProfilePage } from './PublicTrainerProfilePage'

const mocks = vi.hoisted(() => ({
  actor: null as SessionActor | null,
  getPublicTrainerProfile: vi.fn<() => Promise<TrainerProfessionalProfile | null>>(),
}))

vi.mock('../../app/auth-context', () => ({ useAuth: () => ({ actor: mocks.actor }) }))
vi.mock('../../data/repositories/trainer-profiles.repository', () => ({
  getPublicTrainerProfile: mocks.getPublicTrainerProfile,
}))
vi.mock('../chat/ChatEntry', () => ({
  PublicTrainerChatButton: ({ publicProfileId }: { publicProfileId: string }) => <button type="button">Написать тренеру {publicProfileId}</button>,
}))

const fullProfile: TrainerProfessionalProfile = {
  publicId: 'profile-id',
  draft: {
    displayName: 'Анна Иванова',
    bio: 'Помогаю тренироваться регулярно и безопасно.',
    specialties: ['Силовые', 'Бег'],
    city: 'Москва',
    trainingModes: ['online', 'in_person'],
    experienceStartYear: new Date().getFullYear() - 3,
    education: 'Высшее физкультурное образование.',
    formats: 'Созвон и персональный план.',
    price: 'От 3 000 ₽',
    acceptingClients: true,
    avatarDataUrl: null,
    certificates: [{ title: 'Персональный тренер', organization: 'Fit Academy', year: 2025 }],
  },
  published: null,
  listedInCatalog: true,
  publishedAt: '2026-09-13T09:00:00.000Z',
  updatedAt: '2026-09-13T09:00:00.000Z',
  version: 1,
}
fullProfile.published = fullProfile.draft

function Destination() {
  const location = useLocation()
  return <p>Маршрут: {location.pathname}</p>
}

function renderPage(initialEntry: string | { pathname: string; state: { from: string } } = '/trainers/profile-id') {
  return render(<MemoryRouter initialEntries={[initialEntry]}>
    <Routes>
      <Route path="/trainers/:publicId" element={<PublicTrainerProfilePage />} />
      <Route path="*" element={<Destination />} />
    </Routes>
  </MemoryRouter>)
}

describe('PublicTrainerProfilePage', () => {
  beforeEach(() => {
    mocks.actor = { role: 'client' } as SessionActor
    mocks.getPublicTrainerProfile.mockReset()
    mocks.getPublicTrainerProfile.mockResolvedValue(fullProfile)
  })

  it('keeps the contact action before the long profile details and returns to the catalog', async () => {
    renderPage({ pathname: '/trainers/profile-id', state: { from: '/me/trainers' } })

    const contact = await screen.findByRole('button', { name: 'Написать тренеру profile-id' })
    const bio = screen.getByText('Помогаю тренироваться регулярно и безопасно.')
    expect(contact.compareDocumentPosition(bio) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Назад' }))
    expect(screen.getByText('Маршрут: /me/trainers')).toBeVisible()
  })

  it('explains that contact is unavailable without rendering a dead action', async () => {
    mocks.getPublicTrainerProfile.mockResolvedValue({
      ...fullProfile,
      published: { ...fullProfile.draft, acceptingClients: false },
    })
    renderPage()

    expect(await screen.findByText('Тренер временно не принимает новых клиентов')).toBeVisible()
    expect(screen.queryByRole('button', { name: /Написать тренеру/ })).toBeNull()
  })

  it('returns a guest to authentication and omits empty profile sections', async () => {
    mocks.actor = null
    mocks.getPublicTrainerProfile.mockResolvedValue({
      ...fullProfile,
      published: {
        ...fullProfile.draft,
        displayName: 'Борис',
        bio: '',
        specialties: [],
        city: '',
        trainingModes: [],
        experienceStartYear: null,
        education: '',
        formats: '',
        price: '',
        certificates: [],
      },
    })
    const { container } = renderPage()

    await screen.findByRole('heading', { name: 'Борис' })
    expect(container.querySelector('.trainer-card-facts')).toBeEmptyDOMElement()
    expect(container.querySelectorAll('details')).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: 'Назад' }))
    await waitFor(() => expect(screen.getByText('Маршрут: /auth')).toBeVisible())
  })
})
