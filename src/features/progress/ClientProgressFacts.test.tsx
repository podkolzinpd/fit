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
  it('compares renamed exact exercises with history before the selected period and preserves source return context', async () => {
    const workouts = [record('old', '2026-07-01', 60), record('new', '2026-08-10', 50, 'press', 'Новое название'), record('different', '2026-08-11', 80, 'different', 'Жим лёжа')]
    render(<Routes><Route path="/me/progress" element={<PeriodExerciseResults {...base} workouts={workouts} />} /><Route path="/workouts/:id" element={<Source />} /></Routes>, { wrapper })
    const row = screen.getByRole('heading', { name: 'Новое название' }).closest('article')!
    expect(row).toHaveTextContent('Меньше прошлого результата')
    expect(row).toHaveTextContent('Ранее: 60 кг')
    expect(screen.getByRole('heading', { name: 'Жим лёжа' }).closest('article')).toHaveTextContent('Точка отсчёта')
    await userEvent.setup().click(within(row).getByRole('link', { name: /Ранее/ }))
    expect(screen.getByRole('status')).toHaveTextContent('/me/progress?period=3m&mapZone=chest#results')
  })
  it('chooses the latest workout per exercise and exposes more than three without duplicate metrics', async () => {
    const workouts = [record('old', '2026-08-01', 30), record('new', '2026-08-10', 40), ...['a', 'b', 'c'].map((key) => record(key, '2026-08-15', 20, key, key))]
    render(<PeriodExerciseResults {...base} workouts={workouts} />, { wrapper })
    expect(screen.getByRole('heading', { name: 'Жим лёжа' })).not.toBeVisible()
    await userEvent.setup().click(screen.getByText('Все упражнения · 4'))
    expect(screen.getAllByRole('heading', { level: 4 })).toHaveLength(4)
    expect(screen.getByRole('heading', { name: 'Жим лёжа' }).closest('article')).toHaveTextContent('40 кг')
    expect(screen.queryByText(/Объём за тренировку/)).toBeNull()
  })
  it('retains supported reps and cardio metrics and recalculates after deletion', () => {
    const duration = record('duration', '2026-08-10', 0)
    duration.exercises[0]!.inputKind = 'duration'; duration.exercises[0]!.sets[0]!.fact = { durationSec: 60 }
    const { rerender } = render(<PeriodExerciseResults {...base} workouts={[duration]} />, { wrapper })
    expect(screen.getByText(/Время/)).toHaveTextContent('60 сек')
    rerender(<PeriodExerciseResults {...base} workouts={[]} />)
    expect(screen.getByText(/За выбранный период пока нет подтверждённых результатов/)).toBeVisible()
  })
  it('shows result loading and actionable errors without false empty statistics', async () => {
    const retry = vi.fn()
    const { rerender } = render(<PeriodExerciseResults {...base} loading />, { wrapper })
    expect(screen.getByRole('status')).toHaveTextContent('Сравниваем записи')
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
    expect(screen.getByRole('region')).toHaveTextContent('Подтверждённые подходы на сегодня: 2')
  })
  it('keeps week loading, retry and absence-of-records states explicit', async () => {
    const retry = vi.fn(); const { rerender } = render(<ClientCurrentWeek {...base} today={end} loading />)
    expect(screen.getByRole('status')).toBeVisible()
    rerender(<ClientCurrentWeek {...base} today={end} error={new Error('offline')} onRetry={retry} />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Повторить' }))
    expect(retry).toHaveBeenCalledOnce()
    rerender(<ClientCurrentWeek {...base} today={end} workouts={[]} />)
    expect(screen.getByText('Нет завершённых записей')).toBeVisible()
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
    await userEvent.setup().click(screen.getByText('Сравнение периодов'))
    expect(screen.getByRole('status')).toBeVisible()
    rerender(<ClientPeriodComparison {...base} entries={[]} error={new Error('offline')} onRetry={retry} />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Повторить' }))
    expect(retry).toHaveBeenCalledOnce()
    rerender(<ClientPeriodComparison {...base} entries={[]} workouts={[]} />)
    expect(screen.getByText('Сравнение появится, когда будут данные за два периода.')).toBeVisible()
  })
  it('retains period and body-map scope when a goal asks for a new measurement', () => {
    render(<ClientGoalFacts {...base} today={end} entries={[]} workouts={[]} goal={{ id: 'g', clientId: 'c', title: 'Вес', targetDate: null, status: 'active', version: 1, stages: [], criteria: [{ id: 'criterion', goalId: 'g', metric: 'weight', operation: 'decrease_to', targetValue: 70, rangeMin: null, rangeMax: null, unit: 'кг', baselineValue: null, baselineRecordedOn: null, confirmationStatus: 'confirmed', position: 0, version: 1 }] }} />, { wrapper })
    expect(screen.getByRole('link', { name: 'Добавить актуальный замер' })).toHaveAttribute('href', '/me/progress?period=3m&mapZone=chest#measurements')
  })

})
