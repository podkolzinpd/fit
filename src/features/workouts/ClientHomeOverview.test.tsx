import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import type { ClientGoal, Workout, WorkoutPersonalRecord, WorkoutRegularity } from '../../shared/domain'
import { localDate } from '../../shared/local-date'
import { ClientHomeOverview, clientHomeHighlight, clientHomeNextWorkout } from './ClientHomeOverview'

const today = localDate('2026-08-16')

function workout(patch: Partial<Workout> = {}): Workout {
  return {
    id: crypto.randomUUID(), clientId: 'client-1', clientName: 'Анна', workoutDate: today,
    startTime: null, endTime: null, startedAt: null, completedAt: null, status: 'planned',
    notes: null, stageId: null, stageTitle: null, version: 1, exercises: [], ...patch,
  }
}

const goal: ClientGoal = {
  id: 'goal-1', clientId: 'client-1', title: 'Вернуться к бегу', targetDate: null,
  status: 'active', version: 1, stages: [],
}

const week: WorkoutRegularity = {
  period: 'week', periodStart: localDate('2026-08-10'), periodEnd: today,
  plannedCount: 1, completedCount: 3, completedPlannedCount: 1,
  partialCount: 2, skippedCount: 0, completionPercent: 100,
}

const squatRecord: WorkoutPersonalRecord = {
  exerciseRef: 'squat', exerciseName: 'Присед', inputKind: 'strength',
  metric: 'weight_reps', primaryValue: 480, weightKg: 40, reps: 12,
}

describe('ClientHomeOverview', () => {
  it('prioritizes an active workout over the nearest trainer assignment', () => {
    const assigned = workout({ id: 'assigned', trainerId: 'trainer-1', workoutDate: localDate('2026-08-17') })
    const active = workout({ id: 'active', status: 'in_progress', startedAt: '2026-08-16T08:00:00Z' })
    expect(clientHomeNextWorkout([assigned, active], today)).toEqual({ kind: 'active', workout: active })
  })

  it('uses only the nearest future trainer assignment', () => {
    const own = workout({ id: 'own', createdBy: 'client-1' })
    const past = workout({ id: 'past', trainerId: 'trainer-1', workoutDate: localDate('2026-08-15') })
    const nearest = workout({ id: 'nearest', trainerId: 'trainer-1', workoutDate: localDate('2026-08-17') })
    const later = workout({ id: 'later', trainerId: 'trainer-1', workoutDate: localDate('2026-08-20') })
    expect(clientHomeNextWorkout([own, past, later, nearest], today)?.workout.id).toBe('nearest')
  })

  it('shows no more than one highlight and prefers feedback on the latest workout', () => {
    const latest = workout({ status: 'done', trainerReview: 'Отличная техника', hasPr: true })
    expect(clientHomeHighlight([latest], goal)?.kind).toBe('response')
  })

  it('explains the exact personal record and opens exercise progress', () => {
    const latest = workout({ id: 'latest', status: 'done', hasPr: true })
    render(<MemoryRouter><ClientHomeOverview today={today} workouts={[latest]} regularity={[week]} goal={goal} personalRecords={[squatRecord]} workoutsLoading={false} regularityLoading={false} error={null} onRetry={() => undefined} selfTraining={<button>Своя тренировка</button>} /></MemoryRouter>)
    expect(screen.getByRole('heading', { name: 'Присед: новый рекорд' })).toBeVisible()
    expect(screen.getByText('40 кг × 12 повт. · лучший подход')).toBeVisible()
    expect(screen.getByRole('link', { name: /Присед: новый рекорд/ })).toHaveAttribute('href', '/workouts/latest/history/squat')
  })

  it('renders the next action, week progress and one secondary highlight without dashes', () => {
    const assigned = workout({ id: 'assigned', trainerId: 'trainer-1', startTime: '18:30' })
    render(<MemoryRouter><ClientHomeOverview today={today} workouts={[assigned]} regularity={[week]} goal={goal} workoutsLoading={false} regularityLoading={false} error={null} onRetry={() => undefined} selfTraining={<button>Своя тренировка</button>} /></MemoryRouter>)
    expect(screen.getByRole('heading', { name: 'Тренировка на сегодня' })).toBeVisible()
    expect(screen.getByRole('link', { name: 'Открыть план' })).toBeVisible()
    expect(screen.getByRole('heading', { name: '3 тренировки' })).toBeVisible()
    expect(screen.getByText('1 по плану · 2 самостоятельно')).toBeVisible()
    expect(screen.getByText('В 2 тренировках часть упражнений не выполнена')).toBeVisible()
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Вернуться к бегу' })).toBeVisible()
    expect(screen.queryByText('—')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Своя тренировка' })).toBeVisible()
  })

  it('keeps the empty state useful and puts self-training first', () => {
    render(<MemoryRouter><ClientHomeOverview today={today} workouts={[]} regularity={[]} goal={null} workoutsLoading={false} regularityLoading={false} error={null} onRetry={() => undefined} selfTraining={<button>Начать свою тренировку</button>} /></MemoryRouter>)
    const selfAction = screen.getByRole('button', { name: 'Начать свою тренировку' })
    const weekTitle = screen.getByRole('heading', { name: 'Пока без тренировок' })
    expect(selfAction.compareDocumentPosition(weekTitle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByText('Здесь появится первая завершённая тренировка')).toBeVisible()
    expect(screen.queryByText('—')).not.toBeInTheDocument()
  })

  it('renders loading and retryable errors without hiding the main actions', () => {
    let retried = false
    render(<MemoryRouter><ClientHomeOverview today={today} workouts={undefined} regularity={undefined} goal={null} workoutsLoading regularityLoading error={new Error('Не удалось загрузить данные')} onRetry={() => { retried = true }} selfTraining={<button>Своя тренировка</button>} /></MemoryRouter>)
    expect(screen.getByText('Загружаем следующую тренировку…')).toHaveAttribute('role', 'status')
    expect(screen.getByText('Загружаем прогресс недели…')).toHaveAttribute('role', 'status')
    expect(screen.getByRole('alert')).toHaveTextContent('Не удалось загрузить данные')
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }))
    expect(retried).toBe(true)
    expect(screen.getByRole('button', { name: 'Своя тренировка' })).toBeVisible()
  })
})
