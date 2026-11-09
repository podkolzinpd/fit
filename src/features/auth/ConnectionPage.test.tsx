import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { ConnectionPage, ConnectionRequests, readConnectionCode, readFitConnectionTarget } from './ConnectionPage'
import { invitationAuthReturnPath } from './invitation-auth-return'

const { repository, person } = vi.hoisted(() => ({
  person: { id: 'trainer-id', name: 'Новый тренер', role: 'trainer' as const, connected: false, currentTrainer: { id: 'old-trainer', name: 'Прежний тренер' }, expectedRelationshipId: 'period-id', expectedRevision: '2026-11-07T00:00:00Z' },
  repository: { self: vi.fn(), rotate: vi.fn(), list: vi.fn(), status: vi.fn(), resolve: vi.fn(), preview: vi.fn(), send: vi.fn(), decide: vi.fn() },
}))
vi.mock('../../app/auth-context', () => ({ useAuth: () => ({ actor: { role: 'client', firstName: 'Спортсмен', userId: 'athlete' } }) }))
vi.mock('../../app/data-backend-context', () => ({ useDataBackend: () => ({ connectionDirectory: repository }) }))
function mount(node = <ConnectionPage />, entry = '/connect?code=1234567890ABCDEF') {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}><MemoryRouter initialEntries={[entry]}>{node}</MemoryRouter></QueryClientProvider>)
}
beforeEach(() => { vi.resetAllMocks(); repository.list.mockResolvedValue([]); repository.resolve.mockResolvedValue(person); repository.preview.mockResolvedValue(person) })
describe('simple connection flow', () => {
  it('opens search immediately without requesting the camera', () => {
    mount(<ConnectionPage />, '/connect')
    expect(screen.getByLabelText('Почта или Fit-код')).toBeVisible()
    expect(screen.queryByLabelText('Камера для QR-кода')).not.toBeInTheDocument()
  })
  it('keeps the request section visible when there are no requests', async () => {
    mount(<ConnectionRequests showEmpty />)
    expect(screen.getByRole('heading', { name: 'Запросы и приглашения' })).toBeVisible()
    expect(await screen.findByText('Запросов и приглашений пока нет')).toBeVisible()
  })
  it('reports a failed request load instead of calling the list empty', async () => {
    repository.list.mockRejectedValue(new Error('Сеть недоступна'))
    mount(<ConnectionRequests showEmpty />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось загрузить запросы')
    expect(screen.queryByText('Запросов и приглашений пока нет')).not.toBeInTheDocument()
  })
  it('accepts only Fit QR or exact code and preserves it through first login', () => {
    expect(readConnectionCode('https://fit-training.ru/connect?code=1234567890ABCDEF')).toBe('1234567890ABCDEF')
    expect(readConnectionCode('https://evil.example/connect?code=1234567890ABCDEF')).toBeNull()
    expect(readConnectionCode('javascript:alert(1)')).toBeNull()
    expect(invitationAuthReturnPath('/connect?code=1234567890ABCDEF')).toBe('/connect?code=1234567890ABCDEF')
    expect(invitationAuthReturnPath('/connect?code=1234567890ABCDEF&next=https://evil.example')).toBeNull()
  })
  it('routes personal and card-bound invitations without accepting external or malformed links', () => {
    const token = `ABCDEF123456.${'a'.repeat(64)}`
    expect(readFitConnectionTarget(`https://fit-training.ru/invite?token=${token}&source=yandex`)).toEqual({ path: `/invite?token=${token}&source=yandex` })
    expect(readFitConnectionTarget('ABCDEF123456')).toEqual({ path: '/join?code=ABCDEF123456' })
    expect(readFitConnectionTarget('https://fit-training.ru/invite')).toBeNull()
    expect(readFitConnectionTarget(`https://evil.example/invite?token=${token}`)).toBeNull()
    expect(readFitConnectionTarget(`https://fit-training.ru/invite?token=${token}&next=https://evil.example`)).toBeNull()
  })
  it('keeps terminal results visible after remount and allows fresh athlete consent', async () => {
    repository.list.mockResolvedValue([
      { id: 'old', status: 'declined', incoming: false, peerId: 'trainer-id', name: 'Другой тренер', role: 'trainer' },
      { id: 'renew', status: 'needs_confirmation', incoming: false, peerId: 'trainer-id', name: 'Новый тренер', role: 'trainer' },
    ])
    repository.send.mockResolvedValue({ id: 'renew', status: 'pending', incoming: false })
    const view = mount(<ConnectionRequests />)
    expect(await screen.findByText('Запрос отклонён')).toBeInTheDocument()
    view.unmount()
    mount(<ConnectionRequests />)
    expect(await screen.findByText('Запрос отклонён')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Подтвердить заново' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Сменить тренера' }))
    await waitFor(() => expect(repository.send).toHaveBeenCalledWith({ ...person, shareHistory: false, shareSoloHistory: false }))
    expect(repository.decide).not.toHaveBeenCalled()
  })
  it('shows that an opposite request needs my confirmation, not waiting for the other person', async () => {
    repository.send.mockResolvedValue({ id: 'incoming', status: 'pending', incoming: true })
    repository.status.mockResolvedValue({ status: 'pending' })
    mount()
    await userEvent.click(await screen.findByRole('button', { name: 'Сменить тренера' }))
    expect(await screen.findByText('Приглашает вас подключиться')).toBeInTheDocument()
    expect(screen.queryByText('Запрос отправлен. Ждём подтверждения.')).not.toBeInTheDocument()
  })
  it('shows switch consequences and sends the exact consent snapshot; a network error never shows success', async () => {
    repository.send.mockRejectedValueOnce(new Error('Нет соединения')).mockResolvedValueOnce({ status: 'pending' })
    mount()
    expect(await screen.findByText(/Сейчас ваш тренер — Прежний тренер/)).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Вся история тренировок' })).not.toBeChecked()
    await userEvent.click(screen.getByRole('button', { name: 'Сменить тренера' }))
    expect(await screen.findByText('Нет соединения')).toBeInTheDocument()
    expect(screen.queryByText(/Запрос отправлен/)).not.toBeInTheDocument()
    expect(repository.send).toHaveBeenCalledWith({ ...person, shareHistory: false, shareSoloHistory: false })
    await userEvent.click(screen.getByRole('button', { name: 'Сменить тренера' }))
    expect(await screen.findByText('Запрос отправлен. Ждём подтверждения.')).toBeInTheDocument()
  })
  it('previews an incoming request and asks for history consent before connection', async () => {
    const consent = { ...person, currentTrainer: null }
    repository.preview.mockResolvedValue(consent)
    const request = { id: 'request', status: 'pending', incoming: true, peerId: 'trainer-id', name: 'Новый тренер', role: 'trainer', expiresAt: '2026-11-14' }
    repository.list.mockResolvedValueOnce([request]).mockResolvedValue([])
    repository.decide.mockResolvedValue({ status: 'accepted' })
    mount(<ConnectionRequests />)
    await userEvent.click(await screen.findByRole('button', { name: 'Принять' }))
    expect(repository.decide).not.toHaveBeenCalled()
    expect(screen.getByRole('switch', { name: 'Вся история тренировок' })).not.toBeChecked()
    await userEvent.click(await screen.findByRole('button', { name: 'Подключить тренера' }))
    await waitFor(() => expect(repository.decide).toHaveBeenCalledWith('accept', 'request', { ...consent, shareHistory: false, shareSoloHistory: false }))
    expect(await screen.findByText('Подключение подтверждено')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Принять' })).not.toBeInTheDocument())
  })
  it('shows a refusal to the sender instead of leaving a permanent waiting message', async () => {
    repository.send.mockResolvedValue({ id: 'request-id', status: 'pending' })
    repository.status.mockResolvedValue({ status: 'declined' })
    mount()
    await userEvent.click(await screen.findByRole('button', { name: 'Сменить тренера' }))
    expect(await screen.findByText('Запрос отклонён')).toBeInTheDocument()
    expect(screen.queryByText('Вы подключены')).not.toBeInTheDocument()
  })
  it('cannot cancel a renewal while its fresh consent is still being checked', async () => {
    let finishPreview!: (value: typeof person) => void
    repository.preview.mockImplementationOnce(() => new Promise<typeof person>(resolve => { finishPreview = resolve })).mockResolvedValue(person)
    repository.list.mockResolvedValue([{ id: 'renew', status: 'needs_confirmation', incoming: false, peerId: 'trainer-id', name: 'Новый тренер', role: 'trainer' }])
    mount(<ConnectionRequests />)
    await userEvent.click(await screen.findByRole('button', { name: 'Подтвердить заново' }))
    expect(screen.getByRole('button', { name: 'Отменить предложение' })).toBeDisabled()
    expect(repository.decide).not.toHaveBeenCalled()
    finishPreview(person)
    expect(await screen.findByRole('button', { name: 'Сменить тренера' })).toBeVisible()
    expect(repository.send).not.toHaveBeenCalled()
  })
})
