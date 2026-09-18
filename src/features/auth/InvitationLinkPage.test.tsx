import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { InvitationLinkPage } from './JoinPage'

const TOKEN = `AB12CD34EF56.${'a'.repeat(64)}`
interface MockAuthState {
  actor: { userId: string; role: 'client' | 'trainer' } | null
  loading: boolean
  signOut: () => Promise<void>
}
const preview = vi.hoisted(() => vi.fn())
const claim = vi.hoisted(() => vi.fn())
const signOut = vi.hoisted(() => vi.fn())
const authState = vi.hoisted(() => vi.fn<() => MockAuthState>())

vi.mock('../../app/auth-context', () => ({ useAuth: () => authState() }))
vi.mock('../../app/data-backend-context', () => ({
  useDataBackend: () => ({ invitationLinks: { preview, claim } }),
}))

function AuthProbe() {
  const location = useLocation()
  return <p>{JSON.stringify(location.state)}</p>
}

function renderPage(entry = `/invite?token=${TOKEN}`) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}>
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/invite" element={<InvitationLinkPage />} />
        <Route path="/auth" element={<AuthProbe />} />
        <Route path="/me" element={<p>client home</p>} />
      </Routes>
    </MemoryRouter>
  </QueryClientProvider>)
}

describe('InvitationLinkPage', () => {
  beforeEach(() => {
    preview.mockReset().mockResolvedValue({
      targetRole: 'client',
      inviterName: 'Анастасия',
      expiresAt: '2099-09-25T12:00:00.000Z',
      status: 'active',
    })
    claim.mockReset().mockResolvedValue('52500000-0000-4000-8000-000000000010')
    signOut.mockReset().mockResolvedValue(undefined)
    authState.mockReturnValue({ actor: null, loading: false, signOut })
  })

  it('previews an active link and carries it into registration without claiming', async () => {
    renderPage()

    expect(await screen.findByText('Анастасия приглашает вас тренироваться вместе в Fit.')).toBeVisible()
    expect(claim).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('link', { name: 'Зарегистрироваться' }))

    expect(await screen.findByText(new RegExp(`invite\\?token=${TOKEN}`))).toBeVisible()
    expect(screen.getByText(/"invitationRole":"client"/)).toBeVisible()
    expect(screen.getByText(/"mode":"register"/)).toBeVisible()
  })

  it('claims only after an authenticated user confirms', async () => {
    authState.mockReturnValue({
      actor: { userId: 'user-1', role: 'client' },
      loading: false,
      signOut,
    })
    renderPage()

    const action = await screen.findByRole('button', { name: 'Подключиться' })
    expect(claim).not.toHaveBeenCalled()
    fireEvent.click(action)

    expect(await screen.findByRole('heading', { name: 'Тренер подключён' })).toBeVisible()
    expect(claim).toHaveBeenCalledWith(TOKEN)
  })

  it('does not claim with the wrong account role and can switch accounts safely', async () => {
    authState.mockReturnValue({
      actor: { userId: 'user-1', role: 'trainer' },
      loading: false,
      signOut,
    })
    renderPage()

    expect(await screen.findByRole('alert')).toHaveTextContent('предназначено спортсмену')
    expect(screen.queryByRole('button', { name: 'Подключиться' })).not.toBeInTheDocument()
    expect(claim).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Войти под другим аккаунтом' }))
    await waitFor(() => expect(signOut).toHaveBeenCalledOnce())
    expect(await screen.findByText(/"invitationRole":"client"/)).toBeVisible()
  })

  it.each([
    ['claimed', 'Приглашение уже принято'],
    ['revoked', 'Приглашение отменено'],
    ['expired', 'Срок приглашения истёк'],
  ] as const)('shows the %s terminal invitation state', async (status, title) => {
    preview.mockResolvedValueOnce({
      targetRole: 'client',
      inviterName: 'Анастасия',
      expiresAt: '2099-09-25T12:00:00.000Z',
      status,
    })
    renderPage()

    expect(await screen.findByRole('heading', { name: title })).toBeVisible()
  })

  it('rejects a malformed link before the preview request', () => {
    renderPage('/invite?token=short')

    expect(screen.getByRole('heading', { name: 'Ссылка недействительна' })).toBeVisible()
    expect(preview).not.toHaveBeenCalled()
  })

  it('retries a temporary preview failure', async () => {
    preview
      .mockRejectedValueOnce(new Error('Проверьте интернет и попробуйте ещё раз.'))
      .mockResolvedValueOnce({
        targetRole: 'trainer',
        inviterName: 'Антон',
        expiresAt: '2099-09-25T12:00:00.000Z',
        status: 'active',
      })
    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: 'Повторить' }))
    await waitFor(() => expect(preview).toHaveBeenCalledTimes(2))
    expect(await screen.findByText('Антон приглашает вас стать тренером в Fit.')).toBeVisible()
  })
})
