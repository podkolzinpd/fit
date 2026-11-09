import type { TrainerConnectionConfirmation as ConfirmationDraft } from '../../shared/trainer-connection'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { RepositoryError } from '../../data/repositories/error'
import { TrainerConnectionConfirmation } from './TrainerConnectionConfirmation'

const initial = { clientId: 'athlete', currentRelationshipId: 'old-period', currentTrainer: { id: 'old', name: 'Анна' },
  trainer: { id: 'new', name: 'Иван' }, offerVersion: 'offer-v1' }
function fixture(preview = initial as import('../../shared/trainer-connection').TrainerConnectionPreview) {
  const repository = { preview: vi.fn().mockResolvedValue(preview), confirm: vi.fn<(draft: ConfirmationDraft) => Promise<string>>().mockResolvedValue('athlete') }
  const onSuccess = vi.fn()
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <TrainerConnectionConfirmation repository={repository} offer={{ source: 'chat', locator: 'chat-1' }} onSuccess={onSuccess} />
  </QueryClientProvider>)
  return { repository, onSuccess, user: userEvent.setup() }
}
describe('shared athlete consent', () => {
  it('compares each conflicting field without defaults and submits only explicit choices', async () => {
    const { repository, user } = fixture({ ...initial, mergeVersion: 'a'.repeat(64), mergeConflicts: [
      { key: 'progress:one:weight_kg', label: 'Вес, кг · 2026-11-09', account: 70, card: 72 },
      { key: 'goal:one', label: 'Текущая цель', account: 'Поддерживать форму', card: 'Подготовиться к старту' },
    ] })
    await user.click(screen.getByRole('button', { name: 'Подключиться' }))
    const connect = await screen.findByRole('button', { name: 'Сменить тренера' })
    expect(connect).toBeDisabled()
    expect(screen.getAllByRole('radio')).toHaveLength(4)
    for (const radio of screen.getAllByRole('radio')) expect(radio).not.toBeChecked()
    expect(screen.getByText('70')).toBeVisible()
    expect(screen.getByText('72')).toBeVisible()
    await user.click(screen.getAllByRole('radio', { name: /Из карточки тренера/ })[0]!)
    expect(connect).toBeDisabled()
    await user.click(screen.getAllByRole('radio', { name: /Из моего аккаунта/ })[1]!)
    await user.click(connect)
    await waitFor(() => expect(repository.confirm).toHaveBeenCalledWith(expect.objectContaining({
      mergeVersion: 'a'.repeat(64), mergeChoices: { 'progress:one:weight_kg': 'card', 'goal:one': 'account' },
    })))
  })
  it('clears merge decisions when stale data requires a new comparison', async () => {
    const { repository, user } = fixture({ ...initial, mergeVersion: 'a'.repeat(64), mergeConflicts: [
      { key: 'profile:height_cm', label: 'Рост, см', account: 170, card: 171 },
    ] })
    repository.confirm.mockRejectedValueOnce(new RepositoryError('connection_changed', 'Данные изменились'))
    await user.click(screen.getByRole('button', { name: 'Подключиться' }))
    await user.click(await screen.findByRole('radio', { name: /Из карточки тренера/ }))
    await user.click(screen.getByRole('button', { name: 'Сменить тренера' }))
    await user.click(await screen.findByRole('button', { name: 'Проверить снова' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Сменить тренера' })).toBeDisabled())
    for (const radio of screen.getAllByRole('radio')) expect(radio).not.toBeChecked()
  })
  it('previews both trainers, then requires a separate explicit confirmation', async () => {
    const { repository, onSuccess, user } = fixture()
    expect(repository.preview).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Подключиться' }))
    expect(await screen.findByText('Анна')).toBeInTheDocument()
    expect(screen.getByText('Иван')).toBeInTheDocument()
    expect(repository.confirm).not.toHaveBeenCalled()
    expect(screen.getByRole('switch', { name: 'Вся история тренировок' })).not.toBeChecked()
    await user.click(screen.getByRole('switch', { name: 'Вся история тренировок' }))
    await user.click(screen.getByRole('button', { name: 'Сменить тренера' }))
    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith('athlete'))
    expect(repository.confirm).toHaveBeenCalledWith(expect.objectContaining({ source: 'chat', locator: 'chat-1', expectedRelationshipId: 'old-period', offerVersion: 'offer-v1', shareHistory: true }))
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
