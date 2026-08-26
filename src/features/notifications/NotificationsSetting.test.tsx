import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NotificationsSetting } from './NotificationsSetting'

const repository = vi.hoisted(() => ({ status: vi.fn(), enable: vi.fn(), disable: vi.fn() }))
vi.mock('../../data/repositories/push-notifications.repository', () => ({ pushNotificationsRepository: repository }))

const isPushSupported = vi.hoisted(() => vi.fn<() => boolean>())
vi.mock('./push-subscription', () => ({ isPushSupported: () => isPushSupported() }))

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

describe('NotificationsSetting', () => {
  beforeEach(() => {
    repository.status.mockReset()
    repository.enable.mockReset()
    repository.disable.mockReset()
    isPushSupported.mockReset()
  })

  it('renders nothing when the browser does not support push', () => {
    isPushSupported.mockReturnValue(false)
    const { container } = render(<NotificationsSetting userId="user-1" />, { wrapper: wrapper() })
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the toggle off when the user has not subscribed', async () => {
    isPushSupported.mockReturnValue(true)
    repository.status.mockResolvedValue({ subscribed: false, workoutReminderEnabled: true })
    render(<NotificationsSetting userId="user-1" />, { wrapper: wrapper() })
    await waitFor(() => expect(screen.getByRole('switch')).not.toBeChecked())
  })

  it('shows the toggle on when subscribed and enabled', async () => {
    isPushSupported.mockReturnValue(true)
    repository.status.mockResolvedValue({ subscribed: true, workoutReminderEnabled: true })
    render(<NotificationsSetting userId="user-1" />, { wrapper: wrapper() })
    await waitFor(() => expect(screen.getByRole('switch')).toBeChecked())
  })

  it('calls enable when turning the toggle on', async () => {
    isPushSupported.mockReturnValue(true)
    repository.status.mockResolvedValue({ subscribed: false, workoutReminderEnabled: true })
    repository.enable.mockResolvedValue(undefined)
    render(<NotificationsSetting userId="user-1" />, { wrapper: wrapper() })
    await waitFor(() => expect(screen.getByRole('switch')).not.toBeChecked())
    await userEvent.click(screen.getByRole('switch'))
    expect(repository.enable).toHaveBeenCalledWith('user-1')
  })

  it('calls disable when turning the toggle off', async () => {
    isPushSupported.mockReturnValue(true)
    repository.status.mockResolvedValue({ subscribed: true, workoutReminderEnabled: true })
    repository.disable.mockResolvedValue(undefined)
    render(<NotificationsSetting userId="user-1" />, { wrapper: wrapper() })
    await waitFor(() => expect(screen.getByRole('switch')).toBeChecked())
    await userEvent.click(screen.getByRole('switch'))
    expect(repository.disable).toHaveBeenCalledWith('user-1')
  })

  it('shows an error message when the toggle mutation fails', async () => {
    isPushSupported.mockReturnValue(true)
    repository.status.mockResolvedValue({ subscribed: false, workoutReminderEnabled: true })
    repository.enable.mockRejectedValue(new Error('Push-уведомления сейчас недоступны'))
    render(<NotificationsSetting userId="user-1" />, { wrapper: wrapper() })
    await waitFor(() => expect(screen.getByRole('switch')).not.toBeChecked())
    await userEvent.click(screen.getByRole('switch'))
    expect(await screen.findByText('Push-уведомления сейчас недоступны')).toBeVisible()
  })
})
