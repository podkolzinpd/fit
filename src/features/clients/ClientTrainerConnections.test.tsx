import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ClientTrainerConnections } from './ClientTrainerConnections'

const repository = vi.hoisted(() => ({
  create: vi.fn(),
  removeTrainer: vi.fn(),
  list: vi.fn(),
  listTrainers: vi.fn(),
  revoke: vi.fn(),
}))
vi.mock('../../data/repositories/invitations.repository', () => ({ invitationsRepository: repository }))

const connectedTrainer = {
  trainerId: 'trainer-1', firstName: 'Александр', lastName: 'Ситников',
  joinedAt: '2026-08-28T10:00:00Z', isRoot: true,
}

function renderConnections() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}><ClientTrainerConnections clientId="client-1" /></QueryClientProvider>)
}

describe('ClientTrainerConnections safe disconnect', () => {
  beforeEach(() => {
    Object.values(repository).forEach((mock) => mock.mockReset())
    repository.list.mockResolvedValue([])
    repository.listTrainers.mockResolvedValue([connectedTrainer])
  })

  it('disconnects the current trainer only after a clear confirmation and keeps the client data message', async () => {
    const user = userEvent.setup()
    repository.listTrainers.mockResolvedValueOnce([connectedTrainer]).mockResolvedValue([])
    repository.removeTrainer.mockResolvedValue(undefined)
    renderConnections()

    expect(await screen.findByText('Александр Ситников')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Отключить' }))

    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveAccessibleName(/аккаунт, история тренировок, замеры и цели сохранятся/i)
    await user.click(within(dialog).getByRole('button', { name: 'Отключить' }))

    expect(repository.removeTrainer).toHaveBeenCalledWith('client-1', 'trainer-1')
    expect(await screen.findByText('Сейчас вы занимаетесь самостоятельно.')).toBeVisible()
    expect(screen.getByRole('status')).toHaveTextContent('Ваш аккаунт, тренировки, замеры и цели сохранены.')
  })

  it('keeps the trainer visible and explains a safe migration conflict', async () => {
    const user = userEvent.setup()
    repository.removeTrainer.mockRejectedValue(new Error(
      'Сейчас отключить тренера безопасно не получилось. Ваши данные не изменены. Попробуйте позже или напишите в поддержку.',
    ))
    renderConnections()

    await user.click(await screen.findByRole('button', { name: 'Отключить' }))
    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: 'Отключить' }))

    expect(await screen.findByText(/Ваши данные не изменены/)).toBeVisible()
    expect(screen.getByText('Александр Ситников')).toBeVisible()
  })

  it('refreshes the server list after removing the selected trainer and preserves another trainer', async () => {
    const user = userEvent.setup()
    repository.removeTrainer.mockResolvedValue(undefined)
    const otherTrainer = { ...connectedTrainer, trainerId: 'trainer-2', firstName: 'Другой', lastName: 'Тренер' }
    repository.listTrainers.mockResolvedValueOnce([connectedTrainer, otherTrainer]).mockResolvedValue([otherTrainer])
    renderConnections()

    const trainerName = await screen.findByText('Александр Ситников')
    await user.click(within(trainerName.closest('article')!).getByRole('button', { name: 'Отключить' }))
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Отключить' }))

    expect(await screen.findByRole('status')).toHaveTextContent('Тренер отключён')
    expect(screen.queryByText('Александр Ситников')).not.toBeInTheDocument()
    expect(screen.getByText('Другой Тренер')).toBeVisible()
    expect(screen.queryByText('Сейчас вы занимаетесь самостоятельно.')).not.toBeInTheDocument()
    expect(repository.removeTrainer).toHaveBeenCalledWith('client-1', 'trainer-1')
    expect(repository.listTrainers).toHaveBeenCalledTimes(2)
  })

  it('shows an explicit copy action next to a newly created trainer code', async () => {
    const user = userEvent.setup()
    repository.create.mockResolvedValue('ABC123DEF456')
    renderConnections()

    await user.click(screen.getByRole('button', { name: 'Пригласить тренера' }))

    expect(await screen.findByText(/Код для тренера:/)).toHaveTextContent('ABC123DEF456')
    expect(screen.getByRole('button', { name: 'Скопировать код для тренера' })).toBeVisible()
  })

})
