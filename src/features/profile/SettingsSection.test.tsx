import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
  afterEach(() => { onlineManager.setOnline(true) })
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

  it('keeps entered account values after an error and clears stale errors on cancel', async () => {
    const user = userEvent.setup()
    updateProfile.mockRejectedValueOnce(new Error('Не удалось сохранить'))
    render(<AccountSettingsCard />, { wrapper: wrapper() })
    await user.click(screen.getByRole('button', { name: 'Изменить данные' }))
    await user.clear(screen.getByLabelText('Имя'))
    await user.type(screen.getByLabelText('Имя'), 'Мария')
    await user.click(screen.getByRole('button', { name: 'Сохранить' }))
    expect(await screen.findByText('Не удалось сохранить')).toBeVisible()
    expect(screen.getByLabelText('Имя')).toHaveValue('Мария')
    await user.click(screen.getByRole('button', { name: 'Отмена' }))
    await user.click(screen.getByRole('button', { name: 'Изменить данные' }))
    expect(screen.getByLabelText('Имя')).toHaveValue('Анна')
    expect(screen.queryByText('Не удалось сохранить')).not.toBeInTheDocument()
  })

  it('does not accept a second edit or submit while the saved account values are pending', async () => {
    let finish: (() => void) | undefined
    updateProfile.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve }))
    const user = userEvent.setup()
    render(<AccountSettingsCard />, { wrapper: wrapper() })
    await user.click(screen.getByRole('button', { name: 'Изменить данные' }))
    await user.click(screen.getByRole('button', { name: 'Сохранить' }))
    expect(screen.getByLabelText('Имя')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Сохранить' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Отмена' })).toBeDisabled()
    expect(updateProfile).toHaveBeenCalledOnce()
    finish!()
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce())
  })

  it('retains the submitted account values while an offline mutation is paused', async () => {
    const user = userEvent.setup()
    render(<AccountSettingsCard />, { wrapper: wrapper() })
    await user.click(screen.getByRole('button', { name: 'Изменить данные' }))
    await user.clear(screen.getByLabelText('Имя'))
    await user.type(screen.getByLabelText('Имя'), 'Мария')
    await user.clear(screen.getByLabelText('Часовой пояс'))
    await user.type(screen.getByLabelText('Часовой пояс'), 'Europe/Paris')
    act(() => { onlineManager.setOnline(false) })
    await user.click(screen.getByRole('button', { name: 'Сохранить' }))
    expect(screen.getByLabelText('Имя')).toBeDisabled()
    expect(updateProfile).not.toHaveBeenCalled()
    act(() => { onlineManager.setOnline(true) })
    await waitFor(() => expect(updateProfile).toHaveBeenCalledWith({ firstName: 'Мария', lastName: 'Иванова', timezone: 'Europe/Paris' }))
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce())
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
