import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AccountDeletionPage, LegalAcceptanceGate, PrivacyPage, TermsPage } from './LegalPages'

type MockAuthState = { actor: { userId: string } | null; signOut: () => Promise<void> }
const useAuth = vi.hoisted(() => vi.fn<() => MockAuthState>())
const legal = vi.hoisted(() => ({
  getAcceptanceStatus: vi.fn(),
  acceptCurrent: vi.fn(),
  getAccountDeletionStatus: vi.fn(),
  requestAccountDeletion: vi.fn(),
  cancelAccountDeletionRequest: vi.fn(),
}))

vi.mock('../../app/auth-context', () => ({ useAuth: () => useAuth() }))
vi.mock('../../data/repositories/legal.repository', () => ({ legalRepository: legal }))

function wrapper(children: ReactNode) {
  return <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter>{children}</MemoryRouter>
  </QueryClientProvider>
}

describe('legal pages', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAuth.mockReturnValue({ actor: null, signOut: vi.fn(() => Promise.resolve()) })
  })

  it('publishes readable terms and privacy pages without authentication', () => {
    const terms = render(wrapper(<TermsPage />))
    expect(screen.getByRole('heading', { level: 1, name: 'Условия использования' })).toBeVisible()
    expect(screen.getByText(/Ассистент помогает разобрать/)).toBeVisible()
    terms.unmount()

    render(wrapper(<PrivacyPage />))
    expect(screen.getByRole('heading', { level: 1, name: 'Политика конфиденциальности' })).toBeVisible()
    expect(screen.getByText(/Supabase, Vercel и сервисы Yandex Cloud/)).toBeVisible()
  })

  it('asks a signed-out user to authenticate before a deletion request', () => {
    render(wrapper(<AccountDeletionPage />))
    expect(screen.getByRole('heading', { name: 'Сначала войдите' })).toBeVisible()
    expect(screen.getByRole('link', { name: 'Войти в Fit' })).toHaveAttribute('href', '/auth')
  })

  it('accepts current documents once and opens protected content', async () => {
    const user = userEvent.setup()
    useAuth.mockReturnValue({ actor: { userId: 'user-1' }, signOut: vi.fn(() => Promise.resolve()) })
    legal.getAcceptanceStatus.mockResolvedValue({ applicable: true, accepted: false, acceptedAt: null })
    legal.acceptCurrent.mockResolvedValue('2026-09-09T10:00:00Z')
    render(wrapper(<LegalAcceptanceGate><p>Приложение открыто</p></LegalAcceptanceGate>))

    await user.click(await screen.findByRole('button', { name: 'Принять и продолжить' }))
    expect(await screen.findByText('Приложение открыто')).toBeVisible()
    expect(legal.acceptCurrent).toHaveBeenCalledWith('existing_user')
  })
})
