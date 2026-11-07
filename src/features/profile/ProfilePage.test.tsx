import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SUPPORT_TELEGRAM_URL } from '../../shared/support'
import { getWorkoutTimeWheel, setWorkoutTimeWheel } from '../../app/workout-time-input'
import { TrainerProfileSettingsPage } from './ProfilePage'

type MockActor = { role: 'trainer'; userId: string; email: string }
const useAuth = vi.hoisted(() => vi.fn<() => { actor: MockActor | null }>())
vi.mock('../../app/auth-context', () => ({ useAuth: () => useAuth() }))

vi.mock('../progress/BodyMapAppearanceSetting', () => ({ BodyMapAppearanceSetting: () => null }))

const notificationsStatus = vi.hoisted(() => vi.fn())

vi.mock('../notifications/push-subscription', () => ({ isPushSupported: () => true, getCurrentPushSubscription: () => Promise.resolve(null) }))
vi.mock('../install', () => ({ detectInstallPlatform: () => 'other', isAppInstalled: () => false }))

function wrapper(section?: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}><MemoryRouter initialEntries={[section ? `/profile/settings?section=${section}` : '/profile/settings']}>{children}</MemoryRouter></QueryClientProvider>
  )
}

describe('TrainerProfileSettingsPage', () => {
  beforeEach(() => {
    setWorkoutTimeWheel(false)
    useAuth.mockReset()
    notificationsStatus.mockReset()
    useAuth.mockReturnValue({ actor: { role: 'trainer', userId: 'trainer-user-1', email: 'trainer@test.com' } })
    notificationsStatus.mockResolvedValue({ state: 'needs-permission', workoutReminderEnabled: true, workoutScheduledEnabled: true, chatMessageEnabled: true })
  })

  it('links to the Telegram support channel next to the feedback form entry', async () => {
    render(<TrainerProfileSettingsPage />, { wrapper: wrapper('help') })
    await waitFor(() => expect(screen.getByRole('link', { name: 'Поддержка в Telegram' })).toHaveAttribute('href', SUPPORT_TELEGRAM_URL))
    expect(screen.getByRole('link', { name: 'Поддержка в Telegram' })).toHaveAttribute('target', '_blank')
    expect(screen.getByRole('link', { name: 'Поддержка в Telegram' })).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('opens one settings section, preserves the preference and returns to the overview', async () => {
    const user = userEvent.setup()
    render(<TrainerProfileSettingsPage />, { wrapper: wrapper() })
    expect(screen.queryByRole('switch')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Управление упражнениями' })).toHaveAttribute('href', '/exercises')
    await user.click(screen.getByRole('link', { name: /^Тренировки/ }))
    const wheel = screen.getByRole('switch', { name: 'Ввод времени колёсиком' })
    await user.click(wheel)
    await user.click(screen.getByRole('button', { name: 'Назад' }))
    expect(screen.getByRole('heading', { name: 'Настройки' })).toBeVisible()
    expect(screen.queryByRole('switch')).not.toBeInTheDocument()
    await user.click(screen.getByRole('link', { name: /^Тренировки/ }))
    expect(screen.getByRole('switch', { name: 'Ввод времени колёсиком' })).toBeChecked()
    expect(screen.queryByRole('link', { name: 'Политика конфиденциальности' })).not.toBeInTheDocument()
  })

  it('does not keep archive visibility in settings', () => {
    render(<TrainerProfileSettingsPage />, { wrapper: wrapper() })

    expect(screen.queryByRole('checkbox', { name: 'Показывать архив клиентов' })).not.toBeInTheDocument()
  })

  it('offers the optional wheel in trainer workout settings', async () => {
    const user = userEvent.setup()
    render(<TrainerProfileSettingsPage />, { wrapper: wrapper('training') })
    const wheel = screen.getByRole('switch', { name: 'Ввод времени колёсиком' })
    expect(wheel).not.toBeChecked()
    await user.click(wheel)
    expect(wheel).toBeChecked()
    expect(getWorkoutTimeWheel()).toBe(true)
    await user.click(wheel)
    expect(wheel).not.toBeChecked()
    expect(wheel).toBeVisible()
    expect(getWorkoutTimeWheel()).toBe(false)
    expect(screen.getByRole('switch', { name: 'Отдых в плане' })).toBeVisible()
    expect(screen.getAllByRole('switch')).toHaveLength(4)
  })
})

vi.mock('../../app/data-backend-context', async () => {
  const { nativeBackend } = await import('../../test/native-backend')
  return { useDataBackend: () => ({ ...nativeBackend, pushNotifications: { status: notificationsStatus, enable: vi.fn(), setCategoryEnabled: vi.fn(), sendTestPush: vi.fn() } }) }
})
