import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { ConnectionPage, ConnectionRequests, readConnectionCode } from './ConnectionPage'
import { invitationAuthReturnPath } from './invitation-auth-return'

const { repository, person } = vi.hoisted(() => ({
  person: { id: 'trainer-id', name: 'Новый тренер', role: 'trainer' as const, connected: false, currentTrainer: { id: 'old-trainer', name: 'Прежний тренер' }, expectedRelationshipId: 'period-id', expectedRevision: '2026-11-07T00:00:00Z' },
  repository: { self: vi.fn(), rotate: vi.fn(), list: vi.fn(), status: vi.fn(), resolve: vi.fn(), preview: vi.fn(), send: vi.fn(), decide: vi.fn() },
}))
vi.mock('../../app/auth-context', () => ({ useAuth: () => ({ actor: { role: 'client', firstName: 'Спортсмен', userId: 'athlete' } }) }))
vi.mock('../../app/data-backend-context', () => ({ useDataBackend: () => ({ connectionDirectory: repository }) }))
function mount(node = <ConnectionPage />) {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}><MemoryRouter initialEntries={['/connect?code=1234567890ABCDEF']}>{node}</MemoryRouter></QueryClientProvider>)
}
beforeEach(() => { vi.resetAllMocks(); repository.list.mockResolvedValue([]); repository.resolve.mockResolvedValue(person); repository.preview.mockResolvedValue(person) })
describe('simple connection flow', () => {
  it('accepts only Fit QR or exact code and preserves it through first login', () => {
    expect(readConnectionCode('https://fit-training.ru/connect?code=1234567890ABCDEF')).toBe('1234567890ABCDEF')
    expect(readConnectionCode('https://evil.example/connect?code=1234567890ABCDEF')).toBeNull()
    expect(readConnectionCode('javascript:alert(1)')).toBeNull()
    expect(invitationAuthReturnPath('/connect?code=1234567890ABCDEF')).toBe('/connect?code=1234567890ABCDEF')
    expect(invitationAuthReturnPath('/connect?code=1234567890ABCDEF&next=https://evil.example')).toBeNull()
  })
  it('shows switch consequences and sends the exact consent snapshot; a network error never shows success', async () => {
    repository.send.mockRejectedValueOnce(new Error('Нет соединения')).mockResolvedValueOnce({ status: 'pending' })
    mount()
    expect(await screen.findByText(/Сейчас ваш тренер — Прежний тренер/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Запросить смену тренера' }))
    expect(await screen.findByText('Нет соединения')).toBeInTheDocument()
    expect(screen.queryByText(/Запрос отправлен/)).not.toBeInTheDocument()
    expect(repository.send).toHaveBeenCalledWith(person)
    await userEvent.click(screen.getByRole('button', { name: 'Запросить смену тренера' }))
    expect(await screen.findByText('Запрос отправлен. Ждём подтверждения.')).toBeInTheDocument()
  })
  it('previews incoming requests before allowing acceptance and removes them after success', async () => {
    const request = { id: 'request', status: 'pending', incoming: true, peerId: 'trainer-id', name: 'Новый тренер', role: 'trainer', expiresAt: '2026-11-14' }
    repository.list.mockResolvedValueOnce([request]).mockResolvedValue([])
    repository.decide.mockResolvedValue({ status: 'accepted' })
    mount(<ConnectionRequests />)
    await userEvent.click(await screen.findByRole('button', { name: 'Посмотреть' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Принять' }))
    await waitFor(() => expect(repository.decide).toHaveBeenCalledWith('accept', 'request', person))
    expect(await screen.findByText('Вы подключены')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Посмотреть' })).not.toBeInTheDocument())
  })
  it('shows a refusal to the sender instead of leaving a permanent waiting message', async () => {
    repository.send.mockResolvedValue({ id: 'request-id', status: 'pending' })
    repository.status.mockResolvedValue({ status: 'declined' })
    mount()
    await userEvent.click(await screen.findByRole('button', { name: 'Запросить смену тренера' }))
    expect(await screen.findByText('Запрос отклонён')).toBeInTheDocument()
    expect(screen.queryByText('Вы подключены')).not.toBeInTheDocument()
  })
})
