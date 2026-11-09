import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TrainerNutritionConsent } from './TrainerNutritionConsent'
const repository = vi.hoisted(() => ({ consents: vi.fn(), setConsent: vi.fn() }))
vi.mock('../../app/auth-context', () => ({ useAuth: () => ({ actor: { userId: 'client', experiments: { nutrition: true } } }) }))
vi.mock('../../app/data-backend-context', () => ({ useDataBackend: () => ({ nutrition: repository }) }))
vi.mock('../../app/feature-flags', () => ({ isNutritionPilotEnabled: () => true }))
const connection = { clientId: 'card', trainerId: 'trainer', name: 'Тренер', connectionStartedAt: '2026-11-09T00:00:00Z', granted: false }
function mount() {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><TrainerNutritionConsent clientId="card" trainerId="trainer" /></QueryClientProvider>)
}
beforeEach(() => { vi.resetAllMocks(); repository.consents.mockResolvedValue([connection]) })
describe('trainer nutrition access setting', () => {
  it('uses the diary’s existing consent and reflects its persisted choice', async () => {
    repository.setConsent.mockImplementation(() => { repository.consents.mockResolvedValue([{ ...connection, granted: true }]); return Promise.resolve() })
    mount()
    const control = await screen.findByRole('switch', { name: 'Питание' })
    await userEvent.click(control)
    expect(repository.setConsent).toHaveBeenCalledWith(connection, true)
    expect(await screen.findByRole('switch', { checked: true })).toBeChecked()
  })
  it('retains the stored permission after a failed write', async () => {
    repository.setConsent.mockRejectedValue(new Error('offline'))
    mount()
    await userEvent.click(await screen.findByRole('switch', { name: 'Питание' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось обновить доступ к питанию')
    expect(screen.getByRole('switch')).not.toBeChecked()
  })
})
