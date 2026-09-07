import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const repository = vi.hoisted(() => ({
  status: vi.fn(),
  enable: vi.fn(),
  enableCategory: vi.fn(),
  sendTestPush: vi.fn(),
}))
vi.mock('../../data/repositories/push-notifications.repository', () => ({
  pushNotificationsRepository: repository,
  WORKOUT_REMINDER_KIND: 'workout_reminder',
  WORKOUT_SCHEDULED_KIND: 'workout_scheduled',
}))

const isPushSupported = vi.hoisted(() => vi.fn())
const getCurrentPushSubscription = vi.hoisted(() => vi.fn())
vi.mock('./push-subscription', () => ({ isPushSupported: () => isPushSupported(), getCurrentPushSubscription: () => getCurrentPushSubscription() }))

const detectInstallPlatform = vi.hoisted(() => vi.fn())
const installPromptDismissed = vi.hoisted(() => vi.fn())
const isAppInstalled = vi.hoisted(() => vi.fn())
vi.mock('../install', () => ({
  detectInstallPlatform: () => detectInstallPlatform(),
  installPromptDismissed: (userId: string) => installPromptDismissed(userId),
  isAppInstalled: () => isAppInstalled(),
}))

const pushOnboardingSeen = vi.hoisted(() => vi.fn())
const markPushOnboardingSeen = vi.hoisted(() => vi.fn())
vi.mock('./notification-onboarding-storage', () => ({
  pushOnboardingSeen: (userId: string) => pushOnboardingSeen(userId),
  markPushOnboardingSeen: (userId: string) => markPushOnboardingSeen(userId),
}))

vi.mock('../../shared/yandex-metrika', () => ({ trackGoal: vi.fn() }))

import { NotificationOnboarding } from './NotificationOnboarding'

const USER_ID = 'user-1'
const LOCAL_SUBSCRIPTION = { endpoint: 'https://push.example/this-device', p256dh: 'p', authKey: 'a' }

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

// Baseline: supported, not seen, Android (no iOS install gate), already
// installed (so it doesn't get held back by the "don't stack with the
// install nudge" rule), not already working.
function primeHappyPathDefaults() {
  isPushSupported.mockReturnValue(true)
  pushOnboardingSeen.mockReturnValue(false)
  detectInstallPlatform.mockReturnValue('android')
  isAppInstalled.mockReturnValue(true)
  installPromptDismissed.mockReturnValue(true)
  repository.status.mockResolvedValue({ state: 'needs-permission', workoutReminderEnabled: true })
}

describe('NotificationOnboarding', () => {
  beforeEach(() => {
    repository.status.mockReset()
    repository.enable.mockReset()
    repository.enableCategory.mockReset()
    repository.sendTestPush.mockReset()
    isPushSupported.mockReset()
    getCurrentPushSubscription.mockReset()
    detectInstallPlatform.mockReset()
    installPromptDismissed.mockReset()
    isAppInstalled.mockReset()
    pushOnboardingSeen.mockReset()
    markPushOnboardingSeen.mockReset()
  })

  it('renders nothing when the browser does not support push', () => {
    primeHappyPathDefaults()
    isPushSupported.mockReturnValue(false)
    const { container } = render(<NotificationOnboarding userId={USER_ID} />, { wrapper: wrapper() })
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing when already dismissed or seen before', () => {
    primeHappyPathDefaults()
    pushOnboardingSeen.mockReturnValue(true)
    const { container } = render(<NotificationOnboarding userId={USER_ID} />, { wrapper: wrapper() })
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing on iOS before the app is installed, without ever calling subscribeToPush', async () => {
    primeHappyPathDefaults()
    detectInstallPlatform.mockReturnValue('ios')
    isAppInstalled.mockReturnValue(false)
    render(<NotificationOnboarding userId={USER_ID} />, { wrapper: wrapper() })
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(repository.enable).not.toHaveBeenCalled()
  })

  it('renders nothing while the install prompt has not been installed or dismissed yet', () => {
    primeHappyPathDefaults()
    isAppInstalled.mockReturnValue(false)
    installPromptDismissed.mockReturnValue(false)
    const { container } = render(<NotificationOnboarding userId={USER_ID} />, { wrapper: wrapper() })
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing (and marks itself seen) when notifications already work', async () => {
    primeHappyPathDefaults()
    repository.status.mockResolvedValue({ state: 'working', workoutReminderEnabled: true })
    const { container } = render(<NotificationOnboarding userId={USER_ID} />, { wrapper: wrapper() })
    await waitFor(() => expect(markPushOnboardingSeen).toHaveBeenCalledWith(USER_ID))
    expect(container).toBeEmptyDOMElement()
  })

  it('enables both categories, sends a test push, and shows a confirmed message on success', async () => {
    primeHappyPathDefaults()
    const user = userEvent.setup()
    repository.enable.mockResolvedValue(undefined)
    repository.enableCategory.mockResolvedValue(undefined)
    getCurrentPushSubscription.mockResolvedValue(LOCAL_SUBSCRIPTION)
    repository.sendTestPush.mockImplementation(async () => {
      window.dispatchEvent(new MessageEvent('message', { data: { type: 'fit-test-push-received' } }))
    })
    Object.defineProperty(navigator, 'serviceWorker', {
      value: { addEventListener: window.addEventListener.bind(window), removeEventListener: window.removeEventListener.bind(window) },
      configurable: true,
    })

    render(<NotificationOnboarding userId={USER_ID} />, { wrapper: wrapper() })
    await screen.findByRole('button', { name: 'Включить уведомления' })
    await user.click(screen.getByRole('button', { name: 'Включить уведомления' }))

    expect(await screen.findByText('Уведомления работают.')).toBeVisible()
    expect(repository.enable).toHaveBeenCalledWith(USER_ID)
    expect(repository.enableCategory).toHaveBeenCalledWith(USER_ID, 'workout_scheduled')
    expect(repository.sendTestPush).toHaveBeenCalledWith(LOCAL_SUBSCRIPTION.endpoint)
    expect(markPushOnboardingSeen).toHaveBeenCalledWith(USER_ID)

    Reflect.deleteProperty(navigator, 'serviceWorker')
  })

  it('shows an error message and still marks itself seen when enabling fails', async () => {
    primeHappyPathDefaults()
    const user = userEvent.setup()
    repository.enable.mockRejectedValue(new Error('Уведомления не разрешены в браузере'))

    render(<NotificationOnboarding userId={USER_ID} />, { wrapper: wrapper() })
    await user.click(await screen.findByRole('button', { name: 'Включить уведомления' }))

    expect(await screen.findByText('Уведомления не разрешены в браузере')).toBeVisible()
    expect(repository.sendTestPush).not.toHaveBeenCalled()
    expect(markPushOnboardingSeen).toHaveBeenCalledWith(USER_ID)
  })

  it('dismisses without enabling anything', async () => {
    primeHappyPathDefaults()
    const user = userEvent.setup()
    render(<NotificationOnboarding userId={USER_ID} />, { wrapper: wrapper() })
    await user.click(await screen.findByRole('button', { name: 'Не сейчас' }))
    expect(repository.enable).not.toHaveBeenCalled()
    expect(markPushOnboardingSeen).toHaveBeenCalledWith(USER_ID)
  })
})
