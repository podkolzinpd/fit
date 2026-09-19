import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import legalDocuments from '../../shared/legal-documents.json'
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
vi.mock('../../app/data-backend-context', () => ({
  useDataBackend: () => ({ source: 'supabase', legal }),
}))

function wrapper(children: ReactNode) {
  return <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter>{children}</MemoryRouter>
  </QueryClientProvider>
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

async function contentDigest(document: { title: string; blocks: unknown[] }) {
  const bytes = new TextEncoder().encode(canonicalJson({ title: document.title, blocks: document.blocks }))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

describe('legal pages', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAuth.mockReturnValue({ actor: null, signOut: vi.fn(() => Promise.resolve()) })
  })

  it('publishes readable terms and privacy pages without authentication', () => {
    const terms = render(wrapper(<TermsPage />))
    expect(screen.getByRole('heading', { level: 1, name: 'Условия использования сервиса Fit' })).toBeVisible()
    const privacyPolicyReferences = screen.getAllByRole('link', { name: 'Политикой конфиденциальности' })
    expect(privacyPolicyReferences).toHaveLength(2)
    for (const link of privacyPolicyReferences) expect(link).toHaveAttribute('href', '/legal/privacy')
    expect(screen.getByText('2.4. Тренеру может быть доступна функция ассистента (далее – Ассистент), позволяющая получить справочную информацию по отдельным вопросам, связанным с планированием тренировок. Ассистент предоставляет консультационные услуги. Рекомендации, даваемые Ассистентом, не являются медицинской консультацией.')).toBeVisible()
    expect(screen.queryByText(/Ассистент помогает разобрать/)).not.toBeInTheDocument()
    terms.unmount()

    render(wrapper(<PrivacyPage />))
    expect(screen.getByRole('heading', { level: 1, name: 'Политика конфиденциальности' })).toBeVisible()
    expect(screen.getByRole('table', { name: 'Перечень обрабатываемых персональных данных' })).toBeVisible()
    expect(screen.getByText('Сервис не передает персональные данные в третьи страны.')).toBeVisible()
    expect(screen.queryByText(/Supabase, Vercel и сервисы Yandex Cloud/)).not.toBeInTheDocument()
  })

  it('keeps the published text byte-for-byte aligned with the extracted document content', async () => {
    await expect(contentDigest(legalDocuments.terms)).resolves.toBe(legalDocuments.terms.sourceTextSha256)
    await expect(contentDigest(legalDocuments.privacy)).resolves.toBe(legalDocuments.privacy.sourceTextSha256)
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

  it('creates and cancels the current account deletion request through the selected backend', async () => {
    const user = userEvent.setup()
    useAuth.mockReturnValue({ actor: { userId: 'user-1' }, signOut: vi.fn(() => Promise.resolve()) })
    legal.getAccountDeletionStatus
      .mockResolvedValueOnce({ supported: true, request: null })
      .mockResolvedValueOnce({
        supported: true,
        request: {
          id: '8fc45130-9bcf-4b77-9ff7-f0872a354034',
          status: 'requested',
          requestedAt: '2026-09-19T10:00:00.000Z',
        },
      })
      .mockResolvedValueOnce({ supported: true, request: null })
    legal.requestAccountDeletion.mockResolvedValue('8fc45130-9bcf-4b77-9ff7-f0872a354034')
    legal.cancelAccountDeletionRequest.mockResolvedValue(undefined)
    render(wrapper(<AccountDeletionPage />))

    await user.click(await screen.findByRole('button', { name: 'Запросить удаление аккаунта' }))
    await user.click(await screen.findByRole('button', { name: 'Отправить запрос' }))
    expect(legal.requestAccountDeletion).toHaveBeenCalledOnce()
    expect(await screen.findByRole('button', { name: 'Отменить запрос' })).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Отменить запрос' }))
    expect(legal.cancelAccountDeletionRequest).toHaveBeenCalledOnce()
    expect(await screen.findByRole('button', { name: 'Запросить удаление аккаунта' })).toBeVisible()
  })
})
