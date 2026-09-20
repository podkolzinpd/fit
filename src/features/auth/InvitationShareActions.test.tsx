import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const backend = vi.hoisted(() => ({
  createShareForNewClient: vi.fn(),
  revoke: vi.fn(),
}))
vi.mock('../../app/auth-context', () => ({
  useAuth: () => ({ actor: { userId: 'trainer-1', role: 'trainer', firstName: 'Анастасия' } }),
}))
vi.mock('../../app/data-backend-context', () => ({
  useDataBackend: () => ({
    source: 'supabase',
    invitations: {
      createShareForNewClient: backend.createShareForNewClient,
      revoke: backend.revoke,
    },
  }),
}))

import { InviteAthleteButton } from './InvitationShareActions'

function renderButton() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(<QueryClientProvider client={client}><InviteAthleteButton /></QueryClientProvider>)
}

describe('InviteAthleteButton', () => {
  beforeEach(() => {
    backend.createShareForNewClient.mockReset().mockResolvedValue({
      clientId: 'client-1',
      share: {
        id: 'invite-1', clientId: 'client-1', targetRole: 'client',
        code: 'ABC123DEF456', token: `ABC123DEF456.${'a'.repeat(64)}`,
        expiresAt: '2026-09-25T12:00:00.000Z',
      },
    })
    backend.revoke.mockReset().mockResolvedValue(undefined)
  })

  it('creates a compact client card and immediately prepares the protected link', async () => {
    const user = userEvent.setup()
    renderButton()

    await user.click(screen.getByRole('button', { name: 'Пригласить спортсмена' }))
    expect(screen.getByRole('dialog', { name: 'Кого пригласить?' })).toBeVisible()
    await user.type(screen.getByLabelText('Имя спортсмена'), 'Иван Петров')
    await user.click(screen.getByRole('button', { name: 'Создать приглашение' }))

    expect(await screen.findByRole('dialog', { name: 'Ссылка готова' })).toBeVisible()
    expect(screen.getByText('Анастасия приглашает вас тренироваться вместе в Fit.')).toBeVisible()
    expect(backend.createShareForNewClient).toHaveBeenCalledWith(
      'Иван Петров',
      expect.stringMatching(/^[0-9a-f-]{36}$/),
    )
  })

  it('retries the atomic command without a second client-side creation step', async () => {
    const user = userEvent.setup()
    backend.createShareForNewClient.mockRejectedValueOnce(new Error('Сеть недоступна'))
    renderButton()

    await user.click(screen.getByRole('button', { name: 'Пригласить спортсмена' }))
    await user.type(screen.getByLabelText('Имя спортсмена'), 'Иван Петров')
    await user.click(screen.getByRole('button', { name: 'Создать приглашение' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Сеть недоступна')

    await user.click(screen.getByRole('button', { name: 'Создать приглашение' }))
    expect(await screen.findByRole('dialog', { name: 'Ссылка готова' })).toBeVisible()
    expect(backend.createShareForNewClient).toHaveBeenCalledTimes(2)
    expect(backend.createShareForNewClient.mock.calls[0]?.[1]).toBe(
      backend.createShareForNewClient.mock.calls[1]?.[1],
    )
  })
})
