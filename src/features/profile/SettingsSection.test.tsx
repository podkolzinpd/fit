import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionActor, TrainerActor } from '../../shared/domain'
import { AccountSettingsCard, SettingsSection } from './SettingsSection'

type ProfileInput = { firstName: string | null; lastName: string | null; timezone: string }
type MockAuthState = {
  actor: SessionActor | null
  refresh: () => Promise<void>
  updateProfile: (input: ProfileInput) => Promise<void>
}

const refresh = vi.hoisted(() => vi.fn<() => Promise<void>>())
const updateProfile = vi.hoisted(() => vi.fn<(input: ProfileInput) => Promise<void>>())
const useAuth = vi.hoisted(() => vi.fn<() => MockAuthState>())

vi.mock('../../app/auth-context', () => ({ useAuth: () => useAuth() }))

const trainer: TrainerActor = {
  kind: 'trainer', role: 'trainer', userId: 'trainer-1', email: 'anna@fit.local',
  firstName: 'Анна', lastName: 'Иванова', timezone: 'Europe/Moscow',
}

function wrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

describe('SettingsSection', () => {
  beforeEach(() => {
    refresh.mockReset().mockResolvedValue(undefined)
    updateProfile.mockReset().mockResolvedValue(undefined)
    useAuth.mockReset().mockReturnValue({ actor: trainer, refresh, updateProfile })
  })

  it('names a settings group for assistive technology', () => {
    render(<SettingsSection title="Тренировки"><p>Содержимое</p></SettingsSection>)
    expect(screen.getByRole('region', { name: 'Тренировки' })).toContainElement(screen.getByText('Содержимое'))
  })

  it('keeps trainer data compact, supports cancel and saves an explicit edit', async () => {
    const user = userEvent.setup()
    render(<AccountSettingsCard />, { wrapper: wrapper() })

    expect(screen.getByText('Анна Иванова')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Изменить данные' }))
    await user.clear(screen.getByLabelText('Имя'))
    await user.type(screen.getByLabelText('Имя'), 'Мария')
    await user.click(screen.getByRole('button', { name: 'Отмена' }))
    expect(screen.queryByLabelText('Имя')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Изменить данные' }))
    await user.clear(screen.getByLabelText('Имя'))
    await user.clear(screen.getByLabelText('Фамилия'))
    await user.clear(screen.getByLabelText('Часовой пояс'))
    await user.click(screen.getByRole('button', { name: 'Сохранить' }))

    await waitFor(() => expect(updateProfile).toHaveBeenCalledWith({ firstName: null, lastName: null, timezone: 'Europe/Moscow' }))
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce())
    expect(await screen.findByRole('status')).toHaveTextContent('Сохранено')
  })

  it('shows account data without an edit action for a client and nothing without a session', () => {
    useAuth.mockReturnValue({
      actor: { kind: 'client', role: 'client', userId: 'client-1', email: null, firstName: null, lastName: null, timezone: 'Europe/Paris', clientId: 'client-1', trainerId: 'trainer-1', fullName: 'Тест Клиент' },
      refresh,
      updateProfile,
    })
    const { rerender } = render(<AccountSettingsCard />, { wrapper: wrapper() })
    expect(screen.getByText('Europe/Paris')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Изменить данные' })).not.toBeInTheDocument()

    useAuth.mockReturnValue({ actor: null, refresh, updateProfile })
    rerender(<AccountSettingsCard />)
    expect(screen.queryByText('Europe/Paris')).not.toBeInTheDocument()
  })
})
