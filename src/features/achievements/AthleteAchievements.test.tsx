import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Workout } from '../../shared/domain'
import { localDate } from '../../shared/local-date'
import { AthleteAchievementHome, NewlyEarnedAchievements } from './AthleteAchievements'
import { computeAthleteAchievements } from '../../shared/athlete-achievements'

vi.mock('../../app/auth-context', () => ({ useAuth: () => ({ actor: { userId: 'athlete-1', role: 'client', timezone: 'Europe/Moscow' } }) }))

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
    const oldHistory = Array.from({ length: 9 }, (_, index) => ({ ...completed, id: `old-${index}`, completedAt: `2026-08-${String(index + 1).padStart(2, '0')}T12:00:00Z` }))
    view.rerender(<MemoryRouter><AthleteAchievementHome workouts={[completed, ...oldHistory]} loading={false} error={null} onRetry={() => undefined} /></MemoryRouter>)
    expect(screen.queryByText('В ритме')).not.toBeInTheDocument()

    const newWorkout = { ...completed, id: 'new', completedAt: new Date(Date.now() + 60_000).toISOString() }
    const withNewAward = [...oldHistory, newWorkout]
    view.rerender(<MemoryRouter><AthleteAchievementHome workouts={withNewAward} loading={false} error={null} onRetry={() => undefined} /></MemoryRouter>)
    expect(screen.getByText('В ритме')).toBeVisible()
    view.unmount()
    render(<MemoryRouter><AthleteAchievementHome workouts={withNewAward} loading={false} error={null} onRetry={() => undefined} /></MemoryRouter>)
    expect(screen.queryByText('В ритме')).not.toBeInTheDocument()
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
})
