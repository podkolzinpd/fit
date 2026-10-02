import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Workout } from '../../shared/domain'
import { localDate } from '../../shared/local-date'
import { AthleteAchievementHome, AthleteAchievementsPage, NewlyEarnedAchievements } from './AthleteAchievements'
import { computeAthleteAchievements, type AthleteAchievement } from '../../shared/athlete-achievements'

vi.mock('../../app/auth-context', () => ({ useAuth: () => ({ actor: { userId: 'athlete-1', role: 'client', timezone: 'Europe/Moscow' } }) }))

vi.mock('../../app/data-backend-context', () => ({ useDataBackend: () => ({ clients: { getMine: vi.fn() }, workouts: { list: vi.fn() } }) }))
afterEach(() => vi.useRealTimers())

const storage = new Map<string, string>()
beforeEach(() => {
  storage.clear()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value) },
  })
})

const completed = {
  id: 'workout-1', clientId: 'athlete-1', clientName: 'Аня', status: 'done',
  workoutDate: localDate('2026-09-29'), completedAt: '2026-09-29T12:00:00Z',
  startTime: null, endTime: null, startedAt: null, notes: null,
  stageId: null, stageTitle: null, version: 1, exercises: [],
} as Workout

describe('athlete achievement surfaces', () => {
  it('shows the first goal after actions, and only the newest historical award later', () => {
    const empty = render(<MemoryRouter><button>Надиктовать тренировку</button><AthleteAchievementHome workouts={[]} loading={false} error={null} onRetry={() => undefined} /></MemoryRouter>)
    expect(screen.getByText('До первой ачивки: 0 из 1')).toBeVisible()
    expect(screen.getByRole('link', { name: 'Все ачивки →' })).toHaveAttribute('href', '/me/achievements')
    empty.unmount()
    render(<MemoryRouter><AthleteAchievementHome workouts={[completed]} loading={false} error={null} onRetry={() => undefined} /></MemoryRouter>)
    expect(screen.getByText('Первый шаг')).toBeVisible()
    expect(screen.queryByText('До первой ачивки: 0 из 1')).not.toBeInTheDocument()
  })

  it('dismisses only the home card, persisting its award for the athlete', () => {
    const view = render(<MemoryRouter><AthleteAchievementHome workouts={[completed]} loading={false} error={null} onRetry={() => undefined} /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: 'Скрыть карточку ачивок' }))
    expect(screen.queryByText('Первый шаг')).not.toBeInTheDocument()
    view.unmount()
    render(<MemoryRouter><AthleteAchievementHome workouts={[completed]} loading={false} error={null} onRetry={() => undefined} /></MemoryRouter>)
    expect(screen.queryByText('Первый шаг')).not.toBeInTheDocument()
  })

  it('reopens once for a genuinely new award, not for an old history recalculation', () => {
    const view = render(<MemoryRouter><AthleteAchievementHome workouts={[completed]} loading={false} error={null} onRetry={() => undefined} /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: 'Скрыть карточку ачивок' }))
    const oldHistory = Array.from({ length: 9 }, (_, index) => ({ ...completed, id: `old-${index}`, completedAt: `2026-09-${20 + index}T12:00:00Z` }))
    view.rerender(<MemoryRouter><AthleteAchievementHome workouts={[completed, ...oldHistory]} loading={false} error={null} onRetry={() => undefined} /></MemoryRouter>)
    expect(screen.queryByText('Десятка тренировок')).not.toBeInTheDocument()

    const newWorkout = { ...completed, id: 'new', completedAt: new Date(Date.now() + 60_000).toISOString() }
    const withNewAward = [...oldHistory, newWorkout]
    view.rerender(<MemoryRouter><AthleteAchievementHome workouts={withNewAward} loading={false} error={null} onRetry={() => undefined} /></MemoryRouter>)
    expect(screen.getByText('Десятка тренировок')).toBeVisible()
    view.unmount()
    render(<MemoryRouter><AthleteAchievementHome workouts={withNewAward} loading={false} error={null} onRetry={() => undefined} /></MemoryRouter>)
    expect(screen.queryByText('Десятка тренировок')).not.toBeInTheDocument()
  })

  it('does not turn a history error into zero achievements', () => {
    render(<MemoryRouter><AthleteAchievementHome workouts={undefined} loading={false} error={new Error('offline')} onRetry={() => undefined} /></MemoryRouter>)
    expect(screen.getByText('Не удалось загрузить историю тренировок.')).toBeVisible()
    expect(screen.queryByText('До первой ачивки: 0 из 1')).not.toBeInTheDocument()
  })

  it('keeps a newly earned award below the existing workout report as a single nonblocking section', () => {
    const items = computeAthleteAchievements([completed], localDate('2026-09-30'))
    render(<MemoryRouter><NewlyEarnedAchievements items={items.filter((item) => item.sourceWorkoutId === completed.id)} /></MemoryRouter>)
    expect(screen.getByRole('region', { name: 'Новые ачивки' })).toHaveTextContent('Первый шаг')
  })

  it('distinguishes the two five-awards at compact size with different approved art and accessible names', () => {
    const items: AthleteAchievement[] = [
      { id: 'workouts-5', kind: 'workouts', title: 'Первая пятёрка', threshold: 5, description: 'Завершить 5 тренировок', earnedOn: localDate('2026-09-29'), earnedAt: completed.completedAt, sourceWorkoutId: completed.id, progress: 5, nearest: false },
      { id: 'records-5', kind: 'records', title: 'Рекорды копятся', threshold: 5, description: 'Установить личные рекорды в 5 разных тренировках', earnedOn: localDate('2026-09-29'), earnedAt: completed.completedAt, sourceWorkoutId: completed.id, progress: 5, nearest: false },
    ]
    render(<MemoryRouter><NewlyEarnedAchievements items={items} /></MemoryRouter>)
    const workoutsBadge = screen.getByRole('img', { name: 'Первая пятёрка: получена' })
    const recordsBadge = screen.getByRole('img', { name: 'Рекорды копятся: получена' })
    expect(workoutsBadge).toHaveClass('is-compact', 'badge-id-workouts-5')
    expect(recordsBadge).toHaveClass('is-compact', 'badge-id-records-5')
    expect(workoutsBadge.querySelector('.athlete-achievement-static-art')).toHaveStyle({ backgroundPosition: '0% 100%' })
    expect(recordsBadge.querySelector('.athlete-achievement-static-art')).toHaveStyle({ backgroundPosition: '100% 40%' })
    expect(workoutsBadge.querySelector('img')).not.toBeInTheDocument()
    expect(recordsBadge.querySelector('img')).not.toBeInTheDocument()
  })
  it('shows repeated monthly awards and resets current month progress without losing the award', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-02T12:00:00Z'))
    const history = ['08', '09'].flatMap((month) => Array.from({ length: 8 }, (_, index) => ({
      ...completed, id: `${month}-${index}`, completedAt: `2026-${month}-${String(index + 1).padStart(2, '0')}T12:00:00Z`,
    })))
    history.push({ ...completed, id: 'october', completedAt: '2026-10-01T12:00:00Z' })
    const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } })
    client.setQueryData(['my-client'], { id: 'athlete-1' })
    client.setQueryData(['workouts', 'athlete-1'], history)
    render(<QueryClientProvider client={client}><MemoryRouter><AthleteAchievementsPage /></MemoryRouter></QueryClientProvider>)
    const card = screen.getByRole('button', { name: 'Месяц в движении. Получений: 2. Открыть подробности' })
    expect(card).toHaveTextContent('×2')
    fireEvent.click(card)
    const detail = screen.getByRole('dialog', { name: 'Месяц в движении' })
    expect(detail).toHaveTextContent('В этом месяце: 1 из 8')
    expect(detail).toHaveTextContent('Получений: 2')
    expect(detail).toHaveTextContent('Последнее:')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(card).toHaveFocus()
    client.clear()
  })

})
