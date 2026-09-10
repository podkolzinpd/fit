import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const repository = vi.hoisted(() => ({
  status: vi.fn(),
  enable: vi.fn(),
  setCategoryEnabled: vi.fn(),
  sendTestPush: vi.fn(),
}))
vi.mock('../../data/repositories/push-notifications.repository', () => ({
  pushNotificationsRepository: repository,
  CHAT_MESSAGE_KIND: 'chat_message',
  WORKOUT_REMINDER_KIND: 'workout_reminder',
  WORKOUT_SCHEDULED_KIND: 'workout_scheduled',
}))

const isPushSupported = vi.hoisted(() => vi.fn<() => boolean>())
const getCurrentPushSubscription = vi.hoisted(() => vi.fn<() => Promise<{ endpoint: string; p256dh: string; authKey: string } | null>>())
vi.mock('./push-subscription', () => ({ isPushSupported: () => isPushSupported(), getCurrentPushSubscription: () => getCurrentPushSubscription() }))

const detectInstallPlatform = vi.hoisted(() => vi.fn<() => 'ios' | 'android' | 'other'>())
const isAppInstalled = vi.hoisted(() => vi.fn<() => boolean>())
vi.mock('../install', () => ({
  detectInstallPlatform: () => detectInstallPlatform(),
  isAppInstalled: () => isAppInstalled(),
}))

const nativeReminder = vi.hoisted(() => ({
  supported: vi.fn<() => boolean>(),
  permission: vi.fn<() => Promise<'granted' | 'denied' | 'prompt' | 'unsupported'>>(),
  requestPermission: vi.fn<() => Promise<boolean>>(),
  cancelAll: vi.fn<() => Promise<void>>(),
}))
vi.mock('../workouts/workout-inactivity-reminder', () => ({
  isNativeWorkoutInactivityReminderSupported: () => nativeReminder.supported(),
  workoutInactivityNotificationPermission: () => nativeReminder.permission(),
  requestWorkoutInactivityNotificationPermission: () => nativeReminder.requestPermission(),
  cancelAllNativeWorkoutInactivityReminders: () => nativeReminder.cancelAll(),
}))

import { NotificationsSetting } from './NotificationsSetting'

const USER_ID = 'user-1'
const LOCAL_SUBSCRIPTION = { endpoint: 'https://push.example/this-device', p256dh: 'p', authKey: 'a' }

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

function primeDefaults() {
  isPushSupported.mockReturnValue(true)
  detectInstallPlatform.mockReturnValue('android')
  isAppInstalled.mockReturnValue(true)
  nativeReminder.supported.mockReturnValue(false)
}

describe('NotificationsSetting', () => {
  beforeEach(() => {
    repository.status.mockReset()
    repository.enable.mockReset()
    repository.setCategoryEnabled.mockReset()
    repository.sendTestPush.mockReset()
    isPushSupported.mockReset()
    getCurrentPushSubscription.mockReset()
    detectInstallPlatform.mockReset()
    isAppInstalled.mockReset()
    nativeReminder.supported.mockReset()
    nativeReminder.permission.mockReset()
    nativeReminder.requestPermission.mockReset()
    nativeReminder.cancelAll.mockReset()
  })
  afterEach(() => vi.restoreAllMocks())

  it('renders nothing when the browser does not support push', () => {
    primeDefaults()
    isPushSupported.mockReturnValue(false)
    const { container } = render(<NotificationsSetting userId={USER_ID} />, { wrapper: wrapper() })
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the install-first state on iOS before the app is added to the home screen, without querying status', () => {
    primeDefaults()
    detectInstallPlatform.mockReturnValue('ios')
    isAppInstalled.mockReturnValue(false)
    render(<NotificationsSetting userId={USER_ID} />, { wrapper: wrapper() })
    expect(screen.getByText('Установите Fit на экран «Домой»')).toBeVisible()
    expect(repository.status).not.toHaveBeenCalled()
  })

  it('shows needs-permission with an enable button, and enables the subscription plus the scheduled category on click', async () => {
    primeDefaults()
    const user = userEvent.setup()
    repository.status.mockResolvedValue({ state: 'needs-permission', workoutReminderEnabled: true, workoutScheduledEnabled: true, chatMessageEnabled: true })
    repository.enable.mockResolvedValue(undefined)
    repository.setCategoryEnabled.mockResolvedValue(undefined)

    render(<NotificationsSetting userId={USER_ID} />, { wrapper: wrapper() })
    await screen.findByText('Нужно разрешение')
    await user.click(screen.getByRole('button', { name: 'Включить уведомления' }))

    expect(repository.enable).toHaveBeenCalledWith(USER_ID)
    expect(repository.setCategoryEnabled).toHaveBeenCalledWith(USER_ID, 'workout_scheduled', true)
    expect(repository.setCategoryEnabled).toHaveBeenCalledWith(USER_ID, 'chat_message', true)
  })

  it('shows denied with an instruction and no button', async () => {
    primeDefaults()
    repository.status.mockResolvedValue({ state: 'denied', workoutReminderEnabled: true, workoutScheduledEnabled: true, chatMessageEnabled: true })
    render(<NotificationsSetting userId={USER_ID} />, { wrapper: wrapper() })
    await screen.findByText('Отключены в настройках телефона')
    expect(screen.getByText('Разрешите уведомления для Fit в настройках телефона, затем обновите страницу.')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Включить уведомления' })).not.toBeInTheDocument()
  })

  it('shows the working state with both category switches reflecting their preference', async () => {
    primeDefaults()
    repository.status.mockResolvedValue({ state: 'working', workoutReminderEnabled: true, workoutScheduledEnabled: false, chatMessageEnabled: true })
    render(<NotificationsSetting userId={USER_ID} />, { wrapper: wrapper() })
    await screen.findByText('Уведомления работают')
    const switches = screen.getAllByRole('switch')
    expect(switches[0]).toBeChecked()
    expect(switches[1]).not.toBeChecked()
  })

  it('toggles a category switch independently, without touching the other one', async () => {
    primeDefaults()
    const user = userEvent.setup()
    repository.status.mockResolvedValue({ state: 'working', workoutReminderEnabled: true, workoutScheduledEnabled: true, chatMessageEnabled: true })
    repository.setCategoryEnabled.mockResolvedValue(undefined)

    render(<NotificationsSetting userId={USER_ID} />, { wrapper: wrapper() })
    await user.click(screen.getByRole('switch', { name: 'Новые тренировки от тренера' }))

    expect(repository.setCategoryEnabled).toHaveBeenCalledWith(USER_ID, 'workout_scheduled', false)
    expect(repository.enable).not.toHaveBeenCalled()
  })

  it('sends a test push and shows a confirmed result once the service worker responds', async () => {
    primeDefaults()
    const user = userEvent.setup()
    repository.status.mockResolvedValue({ state: 'working', workoutReminderEnabled: true, workoutScheduledEnabled: true, chatMessageEnabled: true })
    getCurrentPushSubscription.mockResolvedValue(LOCAL_SUBSCRIPTION)
    repository.sendTestPush.mockImplementation(() => {
      window.dispatchEvent(new MessageEvent('message', { data: { type: 'fit-test-push-received' } }))
      return Promise.resolve(undefined)
    })
    Object.defineProperty(navigator, 'serviceWorker', {
      value: { addEventListener: window.addEventListener.bind(window), removeEventListener: window.removeEventListener.bind(window) },
      configurable: true,
    })

    render(<NotificationsSetting userId={USER_ID} />, { wrapper: wrapper() })
    await user.click(await screen.findByRole('button', { name: 'Отправить тестовое уведомление' }))

    expect(await screen.findByText('Пришло.')).toBeVisible()
    expect(repository.sendTestPush).toHaveBeenCalledWith(LOCAL_SUBSCRIPTION.endpoint)

    Reflect.deleteProperty(navigator, 'serviceWorker')
  })

  it('does not offer a test-push button outside the working state', async () => {
    primeDefaults()
    repository.status.mockResolvedValue({ state: 'needs-permission', workoutReminderEnabled: true, workoutScheduledEnabled: true, chatMessageEnabled: true })
    render(<NotificationsSetting userId={USER_ID} />, { wrapper: wrapper() })
    await screen.findByText('Нужно разрешение')
    expect(screen.queryByRole('button', { name: 'Отправить тестовое уведомление' })).not.toBeInTheDocument()
  })

  it('shows an error message when enabling fails', async () => {
    primeDefaults()
    const user = userEvent.setup()
    repository.status.mockResolvedValue({ state: 'needs-permission', workoutReminderEnabled: true, workoutScheduledEnabled: true, chatMessageEnabled: true })
    repository.enable.mockRejectedValue(new Error('Push-уведомления сейчас недоступны'))

    render(<NotificationsSetting userId={USER_ID} />, { wrapper: wrapper() })
    await user.click(await screen.findByRole('button', { name: 'Включить уведомления' }))

    expect(await screen.findByText('Push-уведомления сейчас недоступны')).toBeVisible()
  })

  it('uses local notifications in the native app and cancels them when reminders are disabled', async () => {
    primeDefaults()
    const user = userEvent.setup()
    nativeReminder.supported.mockReturnValue(true)
    nativeReminder.permission.mockResolvedValue('granted')
    nativeReminder.cancelAll.mockResolvedValue(undefined)
    repository.status.mockResolvedValue({ state: 'unavailable', workoutReminderEnabled: true, workoutScheduledEnabled: true, chatMessageEnabled: true })
    repository.setCategoryEnabled.mockResolvedValue(undefined)

    render(<NotificationsSetting userId={USER_ID} />, { wrapper: wrapper() })
    await screen.findByText('Уведомления работают')
    const reminderSwitch = screen.getByRole('switch', { name: 'Напоминания о тренировках' })
    expect(screen.queryByRole('switch', { name: 'Новые тренировки от тренера' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Отправить тестовое уведомление' })).not.toBeInTheDocument()

    await user.click(reminderSwitch)

    expect(repository.setCategoryEnabled).toHaveBeenCalledWith(USER_ID, 'workout_reminder', false)
    expect(nativeReminder.cancelAll).toHaveBeenCalledOnce()
  })
})
