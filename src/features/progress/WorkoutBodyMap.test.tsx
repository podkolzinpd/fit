import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import type { Workout, WorkoutExercise } from '../../shared/domain'
import { localDate } from '../../shared/local-date'
import { ClientBodyMapDisclosure, PeriodLoadMap, periodLoadMapLink } from './WorkoutBodyMap'
import { loadBodyMap } from './body-progress-map'

vi.mock('../../app/auth-context', () => ({ useAuth: () => ({ actor: { userId: 'map-viewer', role: 'client' } }) }))

function exercise(ref: string, name: string, muscleGroup: WorkoutExercise['muscleGroup'], inputKind: WorkoutExercise['inputKind'], count: number): WorkoutExercise {
  return { id: ref, ref, source: 'custom', customExerciseId: ref, name, muscleGroup, inputKind, position: 0, blockId: ref,
    blockType: 'single', blockPreset: 'set', blockRounds: 1, restBetweenExercisesSec: 0, restBetweenRoundsSec: 0, restBetweenSetsSec: 0,
    sets: Array.from({ length: count }, (_, index) => ({ id: `${ref}-${index}`, position: index, version: 1, confirmedAt: '2026-08-10T10:00:00Z', fact: inputKind === 'distance' ? { distanceKm: 5 } : { weightKg: 40, reps: 10 } })) }
}

const workout: Workout = { id: 'last-workout', clientId: 'client-1', clientName: 'Тест', workoutDate: localDate('2026-08-10'),
  status: 'done', startedAt: '2026-08-10T09:00:00Z', completedAt: '2026-08-10T10:00:00Z', startTime: null, endTime: null,
  notes: null, stageId: null, stageTitle: null, version: 1,
  exercises: [exercise('press', 'Жим лёжа', 'chest', 'strength', 2), exercise('row', 'Тяга верхнего блока', 'back', 'strength', 1)] }

const start = localDate('2026-08-01')
const end = localDate('2026-08-31')

function renderRoute(initial: string, overrides: { workouts?: Workout[]; loading?: boolean; error?: Error | null; retry?: () => void } = {}) {
  const workouts = overrides.workouts ?? [workout]
  return render(<MemoryRouter initialEntries={[initial]}><Routes>
    <Route path="/me" element={<PeriodLoadMap workouts={workouts} clientId="client-1" periodStart={start} periodEnd={end} />} />
    <Route path="/me/progress" element={<ClientBodyMapDisclosure workouts={overrides.loading ? undefined : workouts} clientId="client-1" periodStart={start} periodEnd={end} loading={overrides.loading ?? false} error={overrides.error ?? null} onRetry={overrides.retry ?? vi.fn()} />} />
  </Routes></MemoryRouter>)
}

describe('Home and Progress period load map', () => {
  it('calculates percentages only from completed confirmed work in the selected period', () => {
    const unconfirmed = { ...workout, id: 'draft', exercises: workout.exercises.map((item) => ({ ...item, sets: item.sets.map((set) => ({ ...set, confirmedAt: null })) })) }
    const outside = { ...workout, id: 'outside', workoutDate: localDate('2026-07-31') }
    const data = loadBodyMap([workout, unconfirmed, outside, { ...workout, status: 'planned' }], start, end)
    expect(data.regions.map((region) => [region.group, region.percent])).toEqual([['chest', 67], ['upper_back', 33]])
  })

  it('shows only the period body map with a visible zone percentage on Home', async () => {
    const user = userEvent.setup()
    renderRoute('/me')
    const map = screen.getByRole('region', { name: 'Нагрузка по телу' })
    expect(within(map).getByRole('heading', { name: 'Нагрузка по телу' })).toBeVisible()
    expect(within(map).getByRole('status')).toHaveTextContent('Грудь67%')
    expect(map).not.toHaveTextContent('подход')
    expect(map).not.toHaveTextContent('Распределение')
    expect(within(map).queryByText('Жим лёжа')).toBeNull()
    await user.click(within(map).getByRole('button', { name: 'Сзади' }))
    expect(within(map).getByRole('status')).toHaveTextContent('Верх спины33%')
    expect(screen.getByRole('link', { name: 'Открыть в прогрессе' })).toHaveAttribute('href', periodLoadMapLink())
  })

  it('opens the period map in Progress directly in load mode without workout scope', async () => {
    const user = userEvent.setup()
    renderRoute('/me')
    await user.click(screen.getByRole('link', { name: 'Открыть в прогрессе' }))
    expect(document.querySelector('details')).toHaveAttribute('open')
    expect(screen.getByText('1 августа 2026 г. — 31 августа 2026 г.')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Нагрузка' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('heading', { name: 'Нагрузка по телу' })).toBeVisible()
    expect(screen.getByRole('status')).toHaveTextContent('Грудь67%')
    expect(screen.queryByText(/тренировка$/)).toBeNull()
  })

  it('keeps the period map collapsed on an ordinary Progress visit', () => {
    renderRoute('/me/progress')
    expect(document.querySelector('details')).not.toHaveAttribute('open')
  })

  it('shows a compact factual empty state without inventing percentages', () => {
    const cardio = { ...workout, exercises: [exercise('run', 'Бег', 'cardio', 'distance', 1)] }
    renderRoute('/me', { workouts: [cardio] })
    expect(document.querySelector('svg')).toBeNull()
    expect(screen.getByText('Нет данных для карты нагрузки.')).toBeVisible()
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('retries a failed period request and exposes loading without a workout fallback', async () => {
    const user = userEvent.setup()
    const retry = vi.fn()
    const view = renderRoute(periodLoadMapLink(), { error: new Error('offline'), retry })
    await user.click(screen.getByRole('button', { name: 'Повторить' }))
    expect(retry).toHaveBeenCalledOnce()
    view.unmount()
    renderRoute(periodLoadMapLink(), { loading: true })
    expect(screen.getByRole('status')).toHaveTextContent('Загружаем карту')
  })
})
