import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const backend = vi.hoisted(() => ({
  createShare: vi.fn(),
  createShareForNewClient: vi.fn(),
  createInvitation: vi.fn(),
  revokeInvitation: vi.fn(),
  revoke: vi.fn(),
}))
vi.mock('../../app/auth-context', () => ({
  useAuth: () => ({ actor: { userId: 'trainer-1', role: 'trainer', firstName: 'Анастасия' } }),
}))
vi.mock('../../app/data-backend-context', () => ({
  useDataBackend: () => ({
    source: 'yandex',
    connectionDirectory: { createInvitation: backend.createInvitation, revokeInvitation: backend.revokeInvitation },
    invitations: {
      createShare: backend.createShare,
      createShareForNewClient: backend.createShareForNewClient,
      revoke: backend.revoke,
    },
  }),
}))

import { InvitationShareButton, InviteAthleteButton } from './InvitationShareActions'

describe('InvitationShareButton state refresh', () => {
  it.each(['client', 'trainer'] as const)('refreshes only the affected athlete card after a %s invitation failure', async (targetRole) => {
    backend.createShare.mockReset().mockRejectedValue(new Error('Недостаточно прав для этого действия.'))
    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
    const refresh = vi.spyOn(queryClient, 'invalidateQueries')
    render(<QueryClientProvider client={queryClient}><InvitationShareButton clientId="client-1" targetRole={targetRole} label="Пригласить" /></QueryClientProvider>)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Пригласить' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Недостаточно прав')
    expect(backend.createShare).toHaveBeenCalledExactlyOnceWith('client-1', targetRole)
    if (targetRole === 'client') expect(refresh).toHaveBeenCalledWith({ queryKey: ['client', 'client-1'] })
    else expect(refresh).not.toHaveBeenCalled()
  })
})

function renderButton() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(<QueryClientProvider client={client}><InviteAthleteButton /></QueryClientProvider>)
}

describe('InviteAthleteButton', () => {
  beforeEach(() => {
    backend.createInvitation.mockReset().mockResolvedValue({ id: 'invite-1', code: 'A'.repeat(32), expiresAt: '2026-12-25T12:00:00Z' })
    backend.createShareForNewClient.mockReset()
    backend.revokeInvitation.mockReset().mockResolvedValue({ status: 'revoked' })
  })
  it('prepares an invitation in one click without asking for a name or creating an athlete', async () => {
    renderButton()
    await userEvent.click(screen.getByRole('button', { name: 'Пригласить' }))
    expect(await screen.findByRole('dialog', { name: 'Ссылка готова' })).toBeVisible()
    expect(screen.queryByLabelText('Имя спортсмена')).not.toBeInTheDocument()
    expect(backend.createInvitation).toHaveBeenCalledOnce()
    expect(backend.createShareForNewClient).not.toHaveBeenCalled()
    expect(screen.getByText('Анастасия приглашает вас тренироваться вместе в Fit.')).toBeVisible()
  })
  it('shows a recoverable failure and retries invitation creation', async () => {
    backend.createInvitation.mockRejectedValueOnce(new Error('Сеть недоступна'))
    renderButton()
    await userEvent.click(screen.getByRole('button', { name: 'Пригласить' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Сеть недоступна')
    await userEvent.click(screen.getByRole('button', { name: 'Пригласить' }))
    expect(await screen.findByRole('dialog', { name: 'Ссылка готова' })).toBeVisible()
    expect(backend.createInvitation).toHaveBeenCalledTimes(2)
    expect(backend.createShareForNewClient).not.toHaveBeenCalled()
  })
})
