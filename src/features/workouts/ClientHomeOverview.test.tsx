import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import type { ClientGoal, Workout, WorkoutPersonalRecord, WorkoutRegularity } from '../../shared/domain'
import { localDate } from '../../shared/local-date'
import { ClientHomeOverview, clientHomeHighlight, clientHomeNextWorkout, clientHomePastPlans } from './ClientHomeOverview'

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

  it('uses the nearest saved plan regardless of who created it', () => {
    const own = workout({ id: 'own', createdBy: 'client-1', workoutDate: localDate('2026-08-17') })
    const past = workout({ id: 'past', trainerId: 'trainer-1', workoutDate: localDate('2026-08-15') })
    const later = workout({ id: 'later', trainerId: 'trainer-1', workoutDate: localDate('2026-08-20') })
    expect(clientHomeNextWorkout([past, later, own], today)?.workout.id).toBe('own')
  })

  it('keeps past plans in a newest-first action queue', () => {
    const older = workout({ id: 'older', workoutDate: localDate('2026-08-10') })
    const newer = workout({ id: 'newer', workoutDate: localDate('2026-08-15') })
    const cancelled = workout({ id: 'cancelled', status: 'cancelled', workoutDate: localDate('2026-08-14') })
    expect(clientHomePastPlans([older, cancelled, newer], today).map((item) => item.id)).toEqual(['newer', 'older'])
  })

  it('shows one neutral past-plan action when there is no active or today plan', () => {
    const past = workout({ id: 'past', workoutDate: localDate('2026-08-15') })
    const older = workout({ id: 'older', workoutDate: localDate('2026-08-10') })
    render(<MemoryRouter><ClientHomeOverview today={today} workouts={[older, past]} regularity={[]} goal={null} workoutsLoading={false} regularityLoading={false} error={null} onRetry={() => undefined} selfTraining={<button>Своя тренировка</button>} /></MemoryRouter>)
    expect(screen.getByText('ПЛАН НА 15 августа 2026 г.')).toBeVisible()
    expect(screen.getByRole('link', { name: /Выбрать действие/ })).toHaveAttribute('href', '/workouts/past')
    expect(screen.getByText('Ещё планов: 1')).toBeVisible()
    expect(screen.queryByText(/пропущ/i)).not.toBeInTheDocument()
  })

  it('shows no more than one highlight and prefers feedback on the latest workout', () => {
    const latest = workout({ status: 'done', trainerReview: 'Отличная техника', hasPr: true })
    expect(clientHomeHighlight([latest], goal)?.kind).toBe('response')
  })

  it('explains the exact personal record and opens exercise progress', () => {
    const latest = workout({ id: 'latest', status: 'done', hasPr: true })
    render(<MemoryRouter><ClientHomeOverview today={today} workouts={[latest]} regularity={[week]} goal={goal} personalRecords={[squatRecord]} workoutsLoading={false} regularityLoading={false} error={null} onRetry={() => undefined} selfTraining={<button>Своя тренировка</button>} /></MemoryRouter>)
    expect(screen.getByText('НОВЫЙ ЛИЧНЫЙ РЕКОРД')).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Присед' })).toBeVisible()
    expect(screen.getByText('40 кг × 12 повт.')).toBeVisible()
    expect(screen.getByRole('link', { name: /Присед/ })).toHaveAttribute('href', '/workouts/latest/history/squat')
  })

  it('renders the next action, week progress and one secondary highlight without dashes', () => {
    const assigned = workout({
      id: 'assigned', trainerId: 'trainer-1', startTime: '18:30',
      exercises: [
        { id: 'row', source: 'system', ref: 'row', name: 'Гребной тренажёр', muscleGroup: 'cardio', inputKind: 'distance', position: 0, blockId: 'row', blockType: 'single', blockPreset: 'set', blockRounds: 1, restBetweenExercisesSec: 0, restBetweenRoundsSec: 90, restBetweenSetsSec: 90, sets: [] },
        { id: 'press', source: 'system', ref: 'press', name: 'Жим гантелей лёжа', muscleGroup: 'chest', inputKind: 'strength', position: 1, blockId: 'press', blockType: 'single', blockPreset: 'set', blockRounds: 1, restBetweenExercisesSec: 0, restBetweenRoundsSec: 90, restBetweenSetsSec: 90, sets: [] },
        { id: 'plank', source: 'system', ref: 'plank', name: 'Планка', muscleGroup: 'core', inputKind: 'duration', position: 2, blockId: 'plank', blockType: 'single', blockPreset: 'set', blockRounds: 1, restBetweenExercisesSec: 0, restBetweenRoundsSec: 90, restBetweenSetsSec: 90, sets: [] },
      ],
    })
    render(<MemoryRouter><ClientHomeOverview today={today} workouts={[assigned]} regularity={[week]} goal={goal} workoutsLoading={false} regularityLoading={false} error={null} onRetry={() => undefined} selfTraining={<button>Своя тренировка</button>} /></MemoryRouter>)
    expect(screen.getByText('СЕГОДНЯ')).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Тренировка по плану' })).toBeVisible()
    expect(screen.getByText('3 упражнения · Гребной тренажёр, Жим гантелей лёжа и ещё 1')).toBeVisible()
    expect(screen.getByRole('link', { name: 'Открыть план' })).toHaveClass('secondary')
    expect(screen.getByRole('link', { name: 'Открыть план' })).not.toHaveClass('primary')
    expect(screen.getByRole('heading', { name: '1 из 1 по плану' })).toBeVisible()
    expect(screen.getByText('Всего состоялось 3 тренировки · 2 самостоятельно')).toBeVisible()
    expect(screen.queryByText(/часть упражнений не выполнена/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/пропущено/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Вернуться к бегу' })).toBeVisible()
    expect(screen.queryByText('—')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Своя тренировка' })).toBeVisible()
  })

  it('reserves the filled primary action for continuing an active workout', () => {
    const active = workout({ id: 'active', status: 'in_progress', startedAt: '2026-08-16T08:00:00Z' })
    render(<MemoryRouter><ClientHomeOverview today={today} workouts={[active]} regularity={[]} goal={null} workoutsLoading={false} regularityLoading={false} error={null} onRetry={() => undefined} selfTraining={<button>Своя тренировка</button>} /></MemoryRouter>)
    expect(screen.getByRole('link', { name: 'Продолжить' })).toHaveClass('primary')
  })

  it('names tomorrow instead of presenting a future assignment as current', () => {
    const assigned = workout({ id: 'tomorrow', trainerId: 'trainer-1', workoutDate: localDate('2026-08-17'), startTime: '07:20' })
    render(<MemoryRouter><ClientHomeOverview today={today} workouts={[assigned]} regularity={[{ ...week, completedCount: 2, completedPlannedCount: 0 }]} goal={null} workoutsLoading={false} regularityLoading={false} error={null} onRetry={() => undefined} selfTraining={<button>Своя тренировка</button>} /></MemoryRouter>)
    expect(screen.getByText('ЗАВТРА')).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Следующая тренировка' })).toBeVisible()
    expect(screen.getByRole('link', { name: /Следующая тренировка Завтра, 07:20/ })).toHaveAttribute('href', '/workouts/tomorrow')
    expect(screen.queryByRole('link', { name: 'Открыть план' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '0 из 1 по плану' })).toBeVisible()
    expect(screen.getByText('Всего состоялось 2 тренировки · 2 самостоятельно')).toBeVisible()
    expect(screen.getByRole('link', { name: 'Прогресс ›' })).toHaveAttribute('href', '/me/progress')
  })

  it('counts a partially completed planned workout as an attended workout', () => {
    render(<MemoryRouter><ClientHomeOverview today={today} workouts={[]} regularity={[{ ...week, plannedCount: 3, completedCount: 3, completedPlannedCount: 3, partialCount: 2 }]} goal={null} workoutsLoading={false} regularityLoading={false} error={null} onRetry={() => undefined} selfTraining={<button>Своя тренировка</button>} /></MemoryRouter>)
    expect(screen.getByRole('heading', { name: '3 из 3 по плану' })).toBeVisible()
    expect(screen.getByText('Все запланированные тренировки состоялись')).toBeVisible()
    expect(screen.queryByText(/частично|не выполн/i)).not.toBeInTheDocument()
  })

  it('explains the value on first run without hiding the main action', () => {
    render(<MemoryRouter><ClientHomeOverview today={today} workouts={[]} regularity={[]} goal={null} workoutsLoading={false} regularityLoading={false} error={null} onRetry={() => undefined} selfTraining={<button>Начать свою тренировку</button>} /></MemoryRouter>)
    expect(screen.getByRole('heading', { name: 'Тренируйтесь и следите за прогрессом' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Начать свою тренировку' })).toBeVisible()
    expect(screen.getByText('Fit поможет увидеть')).toBeVisible()
    expect(screen.getByRole('link', { name: 'Подключиться по приглашению' })).toHaveAttribute('href', '/join')
    expect(screen.queryByText('ЭТА НЕДЕЛЯ')).not.toBeInTheDocument()
    expect(screen.queryByText('Пока без тренировок')).not.toBeInTheDocument()
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
