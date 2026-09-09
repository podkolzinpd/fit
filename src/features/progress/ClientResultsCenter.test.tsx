import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import type { Workout, WorkoutExercise } from '../../shared/domain'
import { localDate } from '../../shared/local-date'
import { ClientResultsCenter } from './ClientResultsCenter'
import { WeeklyTrainingLoad } from './WeeklyTrainingLoad'

function record(id: string, date: string, weight: number, reps = 10): Workout {
  const exercise: WorkoutExercise = { id: 'press', source: 'system', ref: 'press', name: 'Жим лёжа', muscleGroup: 'chest', inputKind: 'strength', position: 0, blockId: 'b', blockType: 'single', blockPreset: 'set', blockRounds: 1, restBetweenExercisesSec: 0, restBetweenRoundsSec: 0, restBetweenSetsSec: 0,
    sets: [{ id: 's', position: 0, confirmedAt: date + 'T10:00:00Z', fact: { weightKg: weight, reps }, version: 1 }] }
  return { id, clientId: 'c', clientName: 'Тест', workoutDate: localDate(date), status: 'done', completedAt: date + 'T10:00:00Z', startedAt: null, startTime: null, endTime: null, notes: null, stageId: null, stageTitle: null, version: 1, exercises: [exercise] }
}
const workouts = [record('old', '2026-07-01', 40), record('pr', '2026-08-01', 50), record('down', '2026-08-05', 45), record('reps', '2026-08-10', 50, 12)]
const props = { workouts, periodStart: localDate('2026-08-01'), periodEnd: localDate('2026-08-31'), loading: false, error: null, onRetry: vi.fn() }
function Source() { const location = useLocation(); const navigate = useNavigate(); return <><output>{JSON.stringify(location.state)}</output><button onClick={() => void navigate((location.state as { returnTo: string }).returnTo)}>Вернуться к результатам</button></> }
function renderCenter(overrides = {}, route = '/me/progress?period=1m&mapZone=chest') {
  return render(<MemoryRouter initialEntries={[route]}><Routes><Route path="/me/progress" element={<ClientResultsCenter {...props} {...overrides} />} /><Route path="/workouts/:id" element={<Source />} /></Routes></MemoryRouter>)
}

describe('result center and weekly work', () => {
  it('keeps detail collapsed and retains an earlier PR despite later decline', async () => {
    const user = userEvent.setup(); renderCenter()
    expect(screen.queryByRole('combobox')).toBeNull()
    await user.click(screen.getByText('Все результаты'))
    await user.selectOptions(await screen.findByLabelText('Показатель'), 'weight')
    expect(screen.getAllByRole('article')).toHaveLength(3)
    expect(screen.getByText('Личный рекорд')).toBeVisible()
    expect(screen.getByText('Результат снизился')).toBeVisible()
    expect(screen.getByText('Результат вырос')).toBeVisible()
    const pr = screen.getByText('Личный рекорд').closest('article')!
    expect(pr).toHaveTextContent('Было 40 кг')
    expect(within(pr).getByRole('link', { name: /Ранее/ })).toHaveAttribute('href', '/workouts/old')
  })
  it('restores exercise, metric, period and open center after visiting a previous source', async () => {
    const user = userEvent.setup(); renderCenter()
    await user.click(screen.getByText('Все результаты'))
    await user.selectOptions(await screen.findByLabelText('Упражнение'), 'system:press:strength')
    await user.selectOptions(screen.getByLabelText('Показатель'), 'weight')
    await user.click(within(screen.getByText('Личный рекорд').closest('article')!).getByRole('link', { name: /Ранее/ }))
    expect(screen.getByRole('status')).toHaveTextContent('period=1m&mapZone=chest')
    expect(screen.getByRole('status')).toHaveTextContent('resultMetric=weight#results-center')
    await user.click(screen.getByRole('button', { name: 'Вернуться к результатам' }))
    expect(await screen.findByLabelText('Упражнение')).toHaveValue('system:press:strength')
    expect(screen.getByLabelText('Показатель')).toHaveValue('weight')
    expect(document.getElementById('results-center')).toHaveAttribute('open')
  })
  it('separates fixed-weight reps and volume and explains actual sets', async () => {
    const user = userEvent.setup(); renderCenter()
    await user.click(screen.getByText('Все результаты'))
    await user.selectOptions(await screen.findByLabelText('Показатель'), 'fixed_reps')
    expect(screen.getByText('Личный рекорд').closest('article')).toHaveTextContent('Повторы при 50 кг: 12 повт.')
    expect(screen.getByText('Личный рекорд').closest('article')).toHaveTextContent('Было 10 повт.')
    await user.selectOptions(screen.getByLabelText('Показатель'), 'volume')
    const latest = screen.getAllByRole('article')[0]!
    await user.click(within(latest).getByText('Подходы, вес и повторы'))
    expect(within(latest).getByText('45 кг × 10 повт.')).toBeVisible()
    expect(within(latest).getByText('50 кг × 12 повт.')).toBeVisible()
    expect(within(latest).getByText('Итого: 600 кг')).toBeVisible()
    expect(latest).not.toHaveTextContent('не равно изменению силы')
  })
  it('exposes more results without losing older entries and resets pagination for a filter', async () => {
    const history = Array.from({ length: 15 }, (_, index) => record(`w${index}`, `2026-08-${String(index + 1).padStart(2, '0')}`, 50))
    const user = userEvent.setup(); renderCenter({ workouts: history })
    await user.click(screen.getByText('Все результаты'))
    await waitFor(() => expect(screen.getAllByRole('article')).toHaveLength(10))
    await user.click(screen.getByRole('button', { name: 'Показать ещё результаты' }))
    expect(screen.getAllByRole('article')).toHaveLength(20)
    await user.selectOptions(screen.getByLabelText('Показатель'), 'weight')
    expect(screen.getAllByRole('article')).toHaveLength(10)
    expect(screen.getByText('Показано 10 из 15 результатов.')).toBeVisible()
  })
  it('does not silently replace a missing exercise filter with all exercises', () => {
    renderCenter({}, '/me/progress?resultsOpen=1&resultExercise=missing&resultMetric=weight')
    expect(screen.getByRole('status')).toHaveTextContent('Выбери другое упражнение или показатель')
    expect(screen.queryByRole('article')).toBeNull()
  })
  it('keeps load failure actionable and avoids a fabricated empty result', async () => {
    const retry = vi.fn(); const user = userEvent.setup()
    renderCenter({ workouts: undefined, error: new Error('offline'), onRetry: retry }, '/me/progress?resultsOpen=1')
    expect(screen.getByRole('alert')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Повторить' }))
    expect(retry).toHaveBeenCalledOnce()
    expect(screen.queryByText('Нет результатов.')).toBeNull()
  })
  it('shows partial weeks and confirmed work after explicit disclosure', async () => {
    render(<WeeklyTrainingLoad {...props} today={localDate('2026-08-12')} />)
    expect(screen.queryByText(/Это записанная работа/)).toBeNull()
    await userEvent.setup().click(screen.getByText('Нагрузка по неделям'))
    expect(await screen.findAllByText('Часть недели')).toHaveLength(2)
    expect(screen.getByText('10 августа 2026 г. — 12 августа 2026 г.')).toBeVisible()
    expect(screen.getAllByText('1 подход')).toHaveLength(3)
  })
  it('recalculates records after editing and deleting their source without preserving a stale PR', () => {
    const view = (data: Workout[]) => <MemoryRouter initialEntries={['/me/progress?resultsOpen=1&resultMetric=weight']}><ClientResultsCenter {...props} workouts={data} /></MemoryRouter>
    const { rerender } = render(view(workouts))
    expect(screen.getByText('Личный рекорд').closest('article')).toHaveTextContent('50 кг')
    const edited = workouts.map((item) => item.id === 'pr' ? record('pr', '2026-08-01', 60) : item)
    rerender(view(edited))
    expect(screen.getByText('Личный рекорд').closest('article')).toHaveTextContent('60 кг')
    rerender(view(edited.filter((item) => item.id !== 'pr')))
    expect(screen.queryByRole('link', { name: '1 августа 2026 г.' })).toBeNull()
    const down = screen.getByRole('link', { name: '5 августа 2026 г.' }).closest('article')!
    expect(down).toHaveTextContent('Личный рекорд')
    expect(down).toHaveTextContent('Было 40 кг')
  })
  it('distinguishes pending history from an empty period and rejects unknown metrics', () => {
    const view = (overrides: object) => <MemoryRouter initialEntries={['/me/progress?resultsOpen=1']}><ClientResultsCenter {...props} {...overrides} /></MemoryRouter>
    const { rerender, unmount } = render(view({ workouts: undefined, loading: true }))
    expect(screen.getByRole('status')).toHaveTextContent('Загружаем результаты')
    rerender(view({ workouts: [] }))
    expect(screen.getByText('Нет результатов.')).toBeVisible()
    unmount()
    renderCenter({}, '/me/progress?resultsOpen=1&resultMetric=unavailable')
    expect(screen.getByRole('status')).toHaveTextContent('Выбери другое упражнение или показатель')
  })
  it('expands older weeks and distinguishes pending, failed and future-only ranges', async () => {
    const user = userEvent.setup(); const retry = vi.fn()
    const start = localDate('2026-05-01')
    const { rerender } = render(<WeeklyTrainingLoad {...props} periodStart={start} today={localDate('2026-08-12')} />)
    await user.click(screen.getByText('Нагрузка по неделям'))
    expect(document.querySelectorAll('.weekly-load-list > li')).toHaveLength(8)
    await user.click(screen.getByRole('button', { name: /Все недели/ }))
    expect(document.querySelectorAll('.weekly-load-list > li')).toHaveLength(16)
    rerender(<WeeklyTrainingLoad {...props} workouts={undefined} loading today={localDate('2026-08-12')} />)
    expect(screen.getByRole('status')).toHaveTextContent('Загружаем нагрузку')
    rerender(<WeeklyTrainingLoad {...props} error={new Error('offline')} onRetry={retry} today={localDate('2026-08-12')} />)
    await user.click(screen.getByRole('button', { name: 'Повторить' }))
    expect(retry).toHaveBeenCalledOnce()
    rerender(<WeeklyTrainingLoad {...props} today={localDate('2026-07-01')} />)
    expect(screen.getByText('За этот период пока нет данных.')).toBeVisible()
  })

  it('keeps both filters when input changes arrive before the route commits', () => {
    renderCenter({}, '/me/progress?resultsOpen=1&mapZone=chest')
    act(() => {
      fireEvent.change(screen.getByLabelText('Упражнение'), { target: { value: 'system:press:strength' } })
      fireEvent.change(screen.getByLabelText('Показатель'), { target: { value: 'weight' } })
    })
    expect(screen.getByLabelText('Упражнение')).toHaveValue('system:press:strength')
    expect(screen.getByLabelText('Показатель')).toHaveValue('weight')
    expect(screen.getAllByRole('article')).toHaveLength(3)
  })

})
