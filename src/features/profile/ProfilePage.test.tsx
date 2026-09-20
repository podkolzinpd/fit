import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SUPPORT_TELEGRAM_URL } from '../../shared/support'
import { TrainerProfileSettingsPage } from './ProfilePage'

type MockActor = { role: 'trainer'; userId: string; email: string }
const useAuth = vi.hoisted(() => vi.fn<() => { actor: MockActor | null }>())
vi.mock('../../app/auth-context', () => ({ useAuth: () => useAuth() }))

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

function wrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}><MemoryRouter>{children}</MemoryRouter></QueryClientProvider>
  )
}

describe('TrainerProfileSettingsPage', () => {
  beforeEach(() => {
    useAuth.mockReset()
    notificationsStatus.mockReset()
    useAuth.mockReturnValue({ actor: { role: 'trainer', userId: 'trainer-user-1', email: 'trainer@test.com' } })
    notificationsStatus.mockResolvedValue({ state: 'needs-permission', workoutReminderEnabled: true, workoutScheduledEnabled: true, chatMessageEnabled: true })
  })

  it('links to the Telegram support channel next to the feedback form entry', async () => {
    render(<TrainerProfileSettingsPage />, { wrapper: wrapper() })
    await waitFor(() => expect(screen.getByRole('link', { name: 'Поддержка в Telegram' })).toHaveAttribute('href', SUPPORT_TELEGRAM_URL))
    expect(screen.getByRole('link', { name: 'Поддержка в Telegram' })).toHaveAttribute('target', '_blank')
    expect(screen.getByRole('link', { name: 'Поддержка в Telegram' })).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('does not keep archive visibility in settings', () => {
    render(<TrainerProfileSettingsPage />, { wrapper: wrapper() })

    expect(screen.queryByRole('checkbox', { name: 'Показывать архив клиентов' })).not.toBeInTheDocument()
  })
})
