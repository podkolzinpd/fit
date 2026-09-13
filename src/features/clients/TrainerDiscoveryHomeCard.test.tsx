import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TrainerDiscoveryPromptAction, TrainerDiscoveryPromptPreference, TrainerMembership } from '../../shared/domain'
import { TrainerDiscoveryHomeCard } from './TrainerDiscoveryHomeCard'

const repository = vi.hoisted(() => ({
  listTrainers: vi.fn<(clientId: string) => Promise<TrainerMembership[]>>(),
  getPromptPreference: vi.fn<() => Promise<TrainerDiscoveryPromptPreference>>(),
  setPromptPreference: vi.fn<(action: TrainerDiscoveryPromptAction) => Promise<TrainerDiscoveryPromptPreference>>(),
}))

vi.mock('../../app/data-backend-context', () => ({
  useDataBackend: () => ({
    invitations: { listTrainers: repository.listTrainers },
    trainerDiscovery: {
      getPromptPreference: repository.getPromptPreference,
      setPromptPreference: repository.setPromptPreference,
    },
  }),
}))

const visible: TrainerDiscoveryPromptPreference = { state: 'visible', remindAt: null, updatedAt: null }

function renderCard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}><MemoryRouter><TrainerDiscoveryHomeCard clientId="client-1" /></MemoryRouter></QueryClientProvider>)
}

describe('TrainerDiscoveryHomeCard', () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
    repository.listTrainers.mockReset().mockResolvedValue([])
    repository.getPromptPreference.mockReset().mockResolvedValue(visible)
    repository.setPromptPreference.mockReset().mockResolvedValue({ state: 'snoozed', remindAt: '2026-10-12T10:00:00.000Z', updatedAt: '2026-09-12T10:00:00.000Z' })
  })

  it('shows one clear catalog action only after both server checks succeed', async () => {
    renderCard()

    expect(screen.queryByRole('heading', { name: 'Нужен тренер?' })).not.toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'Нужен тренер?' })).toBeVisible()
    expect(screen.getByRole('link', { name: 'Найти тренера' })).toHaveAttribute('href', '/me/trainers')
  })

  it('does not request or show the prompt for a connected client', async () => {
    repository.listTrainers.mockResolvedValue([{ trainerId: 'trainer-1', firstName: 'Анна', lastName: null, joinedAt: '2026-09-01T10:00:00.000Z', isRoot: true }])
    renderCard()

    await waitFor(() => expect(repository.listTrainers).toHaveBeenCalledWith('client-1'))
    expect(repository.getPromptPreference).not.toHaveBeenCalled()
    expect(screen.queryByText('Нужен тренер?')).not.toBeInTheDocument()
  })

  it.each(['snoozed', 'dismissed'] as const)('keeps a %s preference hidden', async (state) => {
    repository.getPromptPreference.mockResolvedValue({ state, remindAt: state === 'snoozed' ? '2026-10-12T10:00:00.000Z' : null, updatedAt: '2026-09-12T10:00:00.000Z' })
    renderCard()

    await waitFor(() => expect(repository.getPromptPreference).toHaveBeenCalled())
    expect(screen.queryByText('Нужен тренер?')).not.toBeInTheDocument()
  })

  it('confirms that the card will return in one month', async () => {
    const user = userEvent.setup()
    renderCard()
    await user.click(await screen.findByRole('button', { name: 'Напомнить через месяц' }))

    expect(await screen.findByRole('status')).toHaveTextContent('Напомним через месяц.')
    expect(repository.setPromptPreference).toHaveBeenCalledWith('snooze')
  })

  it('asks before permanently hiding the card', async () => {
    const user = userEvent.setup()
    repository.setPromptPreference.mockResolvedValue({ state: 'dismissed', remindAt: null, updatedAt: '2026-09-12T10:00:00.000Z' })
    renderCard()
    await user.click(await screen.findByRole('button', { name: 'Неинтересно' }))

    expect(repository.setPromptPreference).not.toHaveBeenCalled()
    expect(screen.getByRole('alertdialog', { name: 'Больше не показывать эту карточку?' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Больше не показывать' }))

    expect(await screen.findByRole('status')).toHaveTextContent('Карточка больше не появится.')
    expect(repository.setPromptPreference).toHaveBeenCalledWith('dismiss')
  })

  it('restores the card with a short retryable error when saving fails', async () => {
    const user = userEvent.setup()
    repository.setPromptPreference.mockRejectedValue(new Error('network'))
    renderCard()
    await user.click(await screen.findByRole('button', { name: 'Неинтересно' }))
    await user.click(screen.getByRole('button', { name: 'Больше не показывать' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось сохранить. Попробуйте ещё раз.')
    expect(screen.getByRole('heading', { name: 'Нужен тренер?' })).toBeVisible()
    expect(repository.setPromptPreference).toHaveBeenCalledWith('dismiss')
  })

  it('supports disabling only the home card', async () => {
    vi.stubEnv('VITE_TRAINER_DISCOVERY_HOME_ENABLED', 'false')
    renderCard()

    await waitFor(() => expect(repository.listTrainers).not.toHaveBeenCalled())
    expect(screen.queryByText('Нужен тренер?')).not.toBeInTheDocument()
  })
})
