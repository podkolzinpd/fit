import type { TrainerConnectionConfirmation as ConfirmationDraft } from '../../shared/trainer-connection'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { RepositoryError } from '../../data/repositories/error'
import { TrainerConnectionConfirmation } from './TrainerConnectionConfirmation'

const initial = { clientId: 'athlete', currentRelationshipId: 'old-period', currentTrainer: { id: 'old', name: 'Анна' },
  trainer: { id: 'new', name: 'Иван' }, offerVersion: 'offer-v1' }
function fixture() {
  const repository = { preview: vi.fn().mockResolvedValue(initial), confirm: vi.fn<(draft: ConfirmationDraft) => Promise<string>>().mockResolvedValue('athlete') }
  const onSuccess = vi.fn()
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <TrainerConnectionConfirmation repository={repository} offer={{ source: 'chat', locator: 'chat-1' }} onSuccess={onSuccess} />
  </QueryClientProvider>)
  return { repository, onSuccess, user: userEvent.setup() }
}
describe('shared athlete consent', () => {
  it('previews both trainers, then requires a separate explicit confirmation', async () => {
    const { repository, onSuccess, user } = fixture()
    expect(repository.preview).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Подключиться' }))
    expect(await screen.findByText('Анна')).toBeInTheDocument()
    expect(screen.getByText('Иван')).toBeInTheDocument()
    expect(repository.confirm).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Сменить тренера' }))
    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith('athlete'))
    expect(repository.confirm).toHaveBeenCalledWith(expect.objectContaining({ source: 'chat', locator: 'chat-1', expectedRelationshipId: 'old-period', offerVersion: 'offer-v1' }))
  })
  it('retains the operation on a lost response, but demands a new preview after a stale confirmation', async () => {
    const { repository, user } = fixture()
    repository.confirm.mockRejectedValueOnce(new Error('Нет соединения')).mockRejectedValueOnce(new RepositoryError('connection_changed', 'Подключение изменилось'))
    await user.click(screen.getByRole('button', { name: 'Подключиться' }))
    await user.click(await screen.findByRole('button', { name: 'Сменить тренера' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Нет соединения')
    await user.click(screen.getByRole('button', { name: 'Сменить тренера' }))
    await screen.findByRole('button', { name: 'Проверить снова' })
    expect(repository.confirm.mock.calls[0]?.[0]).toEqual(repository.confirm.mock.calls[1]?.[0])
    expect(screen.queryByRole('button', { name: 'Сменить тренера' })).not.toBeInTheDocument()
    repository.preview.mockResolvedValue({ ...initial, currentRelationshipId: 'another-period', currentTrainer: { id: 'another', name: 'Ольга' } })
    await user.click(screen.getByRole('button', { name: 'Проверить снова' }))
    await screen.findByText('Ольга')
    expect(repository.confirm).toHaveBeenCalledTimes(2)
    await user.click(screen.getByRole('button', { name: 'Сменить тренера' }))
    expect(repository.confirm.mock.calls[2]?.[0]).toMatchObject({ expectedRelationshipId: 'another-period' })
    expect(repository.confirm.mock.calls[2]?.[0].operationId).not.toBe(repository.confirm.mock.calls[0]?.[0].operationId)
  })
})
