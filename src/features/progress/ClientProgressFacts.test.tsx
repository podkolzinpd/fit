import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import type { Workout, WorkoutExercise } from '../../shared/domain'
import { localDate } from '../../shared/local-date'
import { ClientCurrentWeek, ClientGoalFacts, ClientPeriodComparison, PeriodExerciseResults } from './ClientProgressFacts'

const start = localDate('2026-08-01'), end = localDate('2026-08-20')
function record(id: string, date: string, weight: number, ref = 'press', name = 'Жим лёжа'): Workout {
  const exercise: WorkoutExercise = { id: ref, source: 'system', ref, name, muscleGroup: 'chest', inputKind: 'strength', position: 0, blockId: ref, blockType: 'single', blockPreset: 'set', blockRounds: 1, restBetweenExercisesSec: 0, restBetweenRoundsSec: 0, restBetweenSetsSec: 0,
    sets: [{ id: 's', position: 0, confirmedAt: date + 'T10:00:00Z', fact: { weightKg: weight, reps: 10 }, version: 1 }] }
  return { id, clientId: 'c', clientName: 'Тест', workoutDate: localDate(date), status: 'done', startedAt: null, completedAt: date + 'T10:00:00Z', startTime: null, endTime: null, notes: null, stageId: null, stageTitle: null, version: 1, exercises: [exercise] }
}
const base = { periodStart: start, periodEnd: end, loading: false, error: null, onRetry: vi.fn() }
const wrapper = ({ children }: { children: React.ReactNode }) => <MemoryRouter initialEntries={['/me/progress?period=3m&mapZone=chest']}>{children}</MemoryRouter>
function Source() { const location = useLocation(); return <output>{JSON.stringify(location.state)}</output> }

describe('Client facts independent of AI', () => {
  it('compares a renamed exercise with its previous record and preserves source return context', async () => {
    const workouts = [record('old', '2026-07-01', 60), record('new', '2026-08-10', 65, 'press', 'Новое название'), record('different', '2026-08-11', 80, 'different', 'Жим лёжа')]
    render(<Routes><Route path="/me/progress" element={<PeriodExerciseResults {...base} workouts={workouts} />} /><Route path="/workouts/:id" element={<Source />} /></Routes>, { wrapper })
    const row = screen.getByRole('heading', { name: 'Новое название' }).closest('article')!
    expect(row).toHaveTextContent('65 кг × 10 повторов')
    expect(row).toHaveTextContent('Новый максимум веса · +5 кг')
    expect(row).toHaveTextContent('Прежний рекорд — 60 кг')
    expect(screen.queryByRole('heading', { name: 'Жим лёжа' })).toBeNull()
    await userEvent.setup().click(within(row).getByRole('link', { name: 'Открыть тренировку' }))
    expect(screen.getByRole('status')).toHaveTextContent('/me/progress?period=3m&mapZone=chest#results')
  })
  it('shows three different achievements and exposes the remaining achievements without duplicate metrics', async () => {
    const workouts = [record('old', '2026-07-01', 30), record('new', '2026-08-10', 40),
      ...['a', 'b', 'c'].flatMap((key) => [record(`${key}-old`, '2026-07-02', 10, key, key), record(`${key}-new`, '2026-08-15', 20, key, key)])]
    render(<PeriodExerciseResults {...base} workouts={workouts} />, { wrapper })
    for (const key of ['a', 'b', 'c']) expect(screen.getByRole('heading', { name: key })).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Жим лёжа' })).not.toBeVisible()
    await userEvent.setup().click(screen.getByText('Ещё достижения · 1'))
    expect(screen.getByRole('heading', { name: 'Жим лёжа' })).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Жим лёжа' }).closest('article')).toHaveTextContent('40 кг')
    expect(screen.queryByText(/Объём за тренировку/)).toBeNull()
  })
  it('does not present cardio facts as records and recalculates after deletion', () => {
    const duration = record('duration', '2026-08-10', 0)
    duration.exercises[0]!.inputKind = 'duration'; duration.exercises[0]!.sets[0]!.fact = { durationSec: 60 }
    const { rerender } = render(<PeriodExerciseResults {...base} workouts={[duration]} />, { wrapper })
    expect(screen.getByText('За этот период новых достижений нет.')).toBeVisible()
    rerender(<PeriodExerciseResults {...base} workouts={[]} />)
    expect(screen.getByText('За этот период новых достижений нет.')).toBeVisible()
  })
  it('shows result loading and actionable errors without false empty statistics', async () => {
    const retry = vi.fn()
    const { rerender } = render(<PeriodExerciseResults {...base} loading />, { wrapper })
    expect(screen.getByRole('status')).toHaveTextContent('Загружаем результаты')
    rerender(<PeriodExerciseResults {...base} error={new Error('offline')} onRetry={retry} />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Повторить' }))
    expect(retry).toHaveBeenCalledOnce()
  })
  it('uses the current Monday week and counts confirmed cardio and unknown work', () => {
    const unknown = record('unknown', '2026-08-18', 10); unknown.exercises[0]!.muscleGroup = 'other'
    const cardio = record('cardio', '2026-08-19', 0); cardio.exercises[0]!.inputKind = 'distance'; cardio.exercises[0]!.muscleGroup = 'cardio'; cardio.exercises[0]!.sets[0]!.fact = { distanceKm: 5 }
    render(<ClientCurrentWeek {...base} today={end} workouts={[record('previous', '2026-08-16', 10), unknown, cardio]} />)
    expect(screen.getByRole('region')).toHaveTextContent('17 августа 2026 г. — 23 августа 2026 г.')
    expect(screen.getByRole('region')).toHaveTextContent('2 тренировки')
    expect(screen.getByRole('region')).toHaveTextContent('2 подхода')
  })
  it('keeps week loading, retry and absence-of-records states explicit', async () => {
    const retry = vi.fn(); const { rerender } = render(<ClientCurrentWeek {...base} today={end} loading />)
    expect(screen.getByRole('status')).toBeVisible()
    rerender(<ClientCurrentWeek {...base} today={end} error={new Error('offline')} onRetry={retry} />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Повторить' }))
    expect(retry).toHaveBeenCalledOnce()
    rerender(<ClientCurrentWeek {...base} today={end} workouts={[]} />)
    expect(screen.getByText('Пока нет тренировок')).toBeVisible()
  })
  it('keeps goal loading and retry separate from a genuinely absent goal', async () => {
    const retry = vi.fn(); const { rerender } = render(<ClientGoalFacts {...base} today={end} entries={[]} workouts={[]} loading />, { wrapper })
    expect(screen.getByRole('status')).toBeVisible()
    rerender(<ClientGoalFacts {...base} today={end} entries={[]} workouts={[]} error={new Error('offline')} onRetry={retry} />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Повторить' }))
    expect(retry).toHaveBeenCalledOnce()
    rerender(<ClientGoalFacts {...base} today={end} entries={[]} workouts={[]} />)
    expect(screen.getByRole('link', { name: 'Добавить цель' })).toHaveAttribute('href', '/me/goal')
  })
  it('keeps period comparison collapsed with explicit loading, retry and baseline', async () => {
    const retry = vi.fn(); const { rerender } = render(<ClientPeriodComparison {...base} entries={[]} loading />)
    expect(screen.getByText('Сравниваем периоды…')).not.toBeVisible()
    await userEvent.setup().click(screen.getByText('Сравнить периоды'))
    expect(screen.getByRole('status')).toBeVisible()
    rerender(<ClientPeriodComparison {...base} entries={[]} error={new Error('offline')} onRetry={retry} />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Повторить' }))
    expect(retry).toHaveBeenCalledOnce()
    rerender(<ClientPeriodComparison {...base} entries={[]} workouts={[]} />)
    expect(screen.getByText('Сравнение появится, когда будут данные за два периода.')).toBeVisible()
  })
  it('retains period and body-map scope when a goal asks for a new measurement', () => {
    render(<ClientGoalFacts {...base} today={end} entries={[]} workouts={[]} goal={{ id: 'g', clientId: 'c', title: 'Вес', targetDate: null, status: 'active', version: 1, stages: [], criteria: [{ id: 'criterion', goalId: 'g', metric: 'weight', operation: 'decrease_to', targetValue: 70, rangeMin: null, rangeMax: null, unit: 'кг', baselineValue: null, baselineRecordedOn: null, confirmationStatus: 'confirmed', position: 0, version: 1 }] }} />, { wrapper })
    expect(screen.getByRole('link', { name: 'Добавить замер' })).toHaveAttribute('href', '/me/progress?period=3m&mapZone=chest#measurements')
  })

  it('promotes an earlier record over a newer decline and recent first results', () => {
    render(<PeriodExerciseResults {...base} workouts={[
      record('before', '2026-07-01', 40), record('pr', '2026-08-02', 60), record('decline', '2026-08-18', 50),
      ...['a', 'b', 'c'].map((key) => record(key, '2026-08-19', 20, key, key)),
    ]} />, { wrapper })
    const first = screen.getAllByRole('article')[0]!
    expect(first).toHaveTextContent('Жим лёжа')
    expect(first).toHaveTextContent('Новый максимум веса · +20 кг')
    expect(first).toHaveTextContent('Прежний рекорд — 40 кг')
    expect(within(first).getByRole('link', { name: 'Открыть тренировку' })).toHaveAttribute('href', '/workouts/pr')
  })
  it('does not substitute a recent decline when a period has no achievements', () => {
    render(<PeriodExerciseResults {...base} workouts={[
      record('before', '2026-07-01', 80), record('older', '2026-08-02', 60), record('latest', '2026-08-18', 50),
    ]} />, { wrapper })
    expect(screen.getByText('За этот период новых достижений нет.')).toBeVisible()
    expect(screen.queryByRole('article')).toBeNull()
  })

  it('selects the last completed record when achievements share a date', () => {
    const morning = record('morning', '2026-08-18', 60)
    const evening = { ...record('evening', '2026-08-18', 65), completedAt: '2026-08-18T20:00:00Z' }
    render(<PeriodExerciseResults {...base} workouts={[record('before', '2026-07-01', 40), morning, evening]} />, { wrapper })
    expect(screen.getAllByRole('article')[0]).toHaveTextContent('65 кг')
  })

})
