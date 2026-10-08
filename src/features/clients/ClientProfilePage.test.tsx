import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Client } from '../../shared/domain'
import { localDate } from '../../shared/local-date'
import { SUPPORT_TELEGRAM_URL } from '../../shared/support'
import { getWorkoutTimeWheel, setWorkoutTimeWheel } from '../../app/workout-time-input'
import { ClientProfilePage, ClientProfileSettingsPage } from './ClientProfilePage'

type MockActor = { role: 'client'; userId: string; email: string }
const useAuth = vi.hoisted(() => vi.fn<() => { actor: MockActor | null }>())
vi.mock('../../app/auth-context', () => ({ useAuth: () => useAuth() }))

const getMine = vi.hoisted(() => vi.fn<() => Promise<Client | null>>())
vi.mock('../../data/repositories/clients.repository', () => ({ clientsRepository: { getMine } }))
const getOwnSport = vi.hoisted(() => vi.fn())
vi.mock('../../data/repositories/athlete-sport-profile.repository', () => ({
  athleteSportProfileRepository: { supportsSportInterests: true, getMine: getOwnSport, saveOwn: vi.fn() },
}))
vi.mock('../../app/data-backend-context', () => ({
  useDataBackend: () => ({ source: 'yandex', clients: { getMine }, athleteSportProfile: { supportsSportInterests: true, getMine: getOwnSport } }),
}))

vi.mock('./ClientTrainerConnections', () => ({ ClientTrainerConnections: ({ finance }: { finance?: ReactNode }) => <div>{finance}</div> }))
vi.mock('../finance', () => ({ ClientFinanceHomeCard: () => <section aria-label="Абонементы клиента">Абонементы</section> }))
vi.mock('../progress/BodyMapAppearanceSetting', () => ({ BodyMapAppearanceSetting: () => null }))

const notificationsStatus = vi.hoisted(() => vi.fn())
vi.mock('../../data/repositories/push-notifications.repository', () => ({
  pushNotificationsRepository: { status: notificationsStatus, enable: vi.fn(), setCategoryEnabled: vi.fn(), sendTestPush: vi.fn() },
  CHAT_MESSAGE_KIND: 'chat_message',
  WORKOUT_REMINDER_KIND: 'workout_reminder',
  WORKOUT_SCHEDULED_KIND: 'workout_scheduled',
}))
vi.mock('../notifications/push-subscription', () => ({ isPushSupported: () => true, getCurrentPushSubscription: () => Promise.resolve(null) }))
vi.mock('../install', () => ({ detectInstallPlatform: () => 'other', isAppInstalled: () => false }))

const client: Client = {
  id: 'client-1', hasAccount: true, fullName: 'Тест Клиент', canonicalFullName: 'тест клиент',
  gender: 'male', ageYears: 30, ageUpdatedAt: localDate('2026-01-01'), heightCm: 180, goal: null, note: null,
  currentWeightKg: null, archivedAt: null, version: 1, membershipVersion: 1,
}

function wrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}><MemoryRouter>{children}</MemoryRouter></QueryClientProvider>
  )
}

describe('ClientProfilePage', () => {
  beforeEach(() => {
    setWorkoutTimeWheel(false)
    useAuth.mockReset()
    getMine.mockReset()
    notificationsStatus.mockReset()
    useAuth.mockReturnValue({ actor: { role: 'client', userId: 'client-user-1', email: 'client@test.com' } })
    getMine.mockResolvedValue(client)
    getOwnSport.mockReset().mockResolvedValue({ sports: [], bio: null })
    notificationsStatus.mockResolvedValue({ state: 'needs-permission', workoutReminderEnabled: true, workoutScheduledEnabled: true, chatMessageEnabled: true })
  })

  it('keeps the profile focused and links to separate settings', async () => {
    render(<ClientProfilePage />, { wrapper: wrapper() })
    await waitFor(() => expect(screen.getByRole('link', { name: 'Настройки профиля' })).toHaveAttribute('href', '/me/settings'))
    expect(screen.getByText('Настройки')).toBeVisible()
    expect(screen.queryByText('Уведомления')).not.toBeInTheDocument()
    expect(await screen.findByRole('region', { name: 'Абонементы клиента' })).toBeVisible()
  })

  it('shows only the owner their selected sports and collapses a long list', async () => {
    getOwnSport.mockResolvedValue({
      sports: ['running', 'yoga', 'swimming', 'boxing', 'football', 'hiking', 'dance'],
      bio: 'Тренируюсь по утрам',
    })
    const user = userEvent.setup()
    render(<ClientProfilePage />, { wrapper: wrapper() })
    expect(await screen.findByText('Тренируюсь по утрам')).toBeVisible()
    expect(screen.getByText('Бег')).toBeVisible()
    expect(screen.queryByText('Танцы')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Показать ещё 1' }))
    expect(screen.getByText('Танцы')).toBeVisible()
  })

  it('renders notification controls on the client settings page', async () => {
    render(<ClientProfileSettingsPage />, { wrapper: wrapper() })
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Напоминать о незавершённой тренировке' })).toBeVisible())
    expect(screen.queryByRole('link', { name: 'Ввести код приглашения' })).not.toBeInTheDocument()
  })

  it('offers the optional wheel in client workout settings', async () => {
    const user = userEvent.setup()
    render(<ClientProfileSettingsPage />, { wrapper: wrapper() })
    const wheel = screen.getByRole('switch', { name: 'Ввод времени колёсиком' })
    expect(wheel).not.toBeChecked()
    await user.click(wheel)
    expect(wheel).toBeChecked()
    expect(getWorkoutTimeWheel()).toBe(true)
  })

  it('links to the Telegram support channel next to the feedback form entry', async () => {
    render(<ClientProfileSettingsPage />, { wrapper: wrapper() })
    await waitFor(() => expect(screen.getByRole('link', { name: 'Поддержка в Telegram' })).toHaveAttribute('href', SUPPORT_TELEGRAM_URL))
    expect(screen.getByRole('link', { name: 'Поддержка в Telegram' })).toHaveAttribute('target', '_blank')
    expect(screen.getByRole('link', { name: 'Поддержка в Telegram' })).toHaveAttribute('rel', 'noopener noreferrer')
  })
})
