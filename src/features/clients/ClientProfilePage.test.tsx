import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Client } from '../../shared/domain'
import { localDate } from '../../shared/local-date'
import { ClientProfilePage } from './ClientProfilePage'

type MockActor = { role: 'client'; userId: string; email: string }
const useAuth = vi.hoisted(() => vi.fn<() => { actor: MockActor | null }>())
vi.mock('../../app/auth-context', () => ({ useAuth: () => useAuth() }))

const getMine = vi.hoisted(() => vi.fn<() => Promise<Client | null>>())
vi.mock('../../data/repositories/clients.repository', () => ({ clientsRepository: { getMine } }))

vi.mock('./ClientTrainerConnections', () => ({ ClientTrainerConnections: () => null }))
vi.mock('../progress/BodyMapAppearanceSetting', () => ({ BodyMapAppearanceSetting: () => null }))

const notificationsStatus = vi.hoisted(() => vi.fn())
vi.mock('../../data/repositories/push-notifications.repository', () => ({
  pushNotificationsRepository: { status: notificationsStatus, enable: vi.fn(), disable: vi.fn() },
}))
vi.mock('../notifications/push-subscription', () => ({ isPushSupported: () => true }))

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
    useAuth.mockReset()
    getMine.mockReset()
    notificationsStatus.mockReset()
    useAuth.mockReturnValue({ actor: { role: 'client', userId: 'client-user-1', email: 'client@test.com' } })
    getMine.mockResolvedValue(client)
    notificationsStatus.mockResolvedValue({ subscribed: false, workoutReminderEnabled: true })
  })

  it('renders the push notifications toggle for a client', async () => {
    render(<ClientProfilePage />, { wrapper: wrapper() })
    await waitFor(() => expect(screen.getByText('Напоминания о тренировках')).toBeVisible())
  })
})
