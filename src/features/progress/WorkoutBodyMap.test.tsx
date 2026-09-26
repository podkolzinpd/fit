import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import type { Gender, Workout, WorkoutExercise } from '../../shared/domain'
import { localDate } from '../../shared/local-date'
import { ClientBodyMapDisclosure, PeriodLoadMap, periodLoadMapLink } from './WorkoutBodyMap'
import { loadBodyMap } from './body-progress-map'
import { MapPanel } from './ClientBodyProgressMap'

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

function renderRoute(initial: string, overrides: { workouts?: Workout[]; gender?: Gender | null; loading?: boolean; error?: Error | null; retry?: () => void } = {}) {
  const workouts = overrides.workouts ?? [workout]
  const gender = overrides.gender === undefined ? 'male' : overrides.gender
  return render(<MemoryRouter initialEntries={[initial]}><Routes>
    <Route path="/me" element={<PeriodLoadMap workouts={workouts} gender={gender} clientId="client-1" periodStart={start} periodEnd={end} />} />
    <Route path="/me/progress" element={<ClientBodyMapDisclosure workouts={overrides.loading ? undefined : workouts} gender={gender} clientId="client-1" periodStart={start} periodEnd={end} loading={overrides.loading ?? false} error={overrides.error ?? null} onRetry={overrides.retry ?? vi.fn()} />} />
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
    expect(within(map).getByText(/Доля подтверждённых подходов/)).not.toBeVisible()
    expect(map).not.toHaveTextContent('Распределение')
    expect(within(map).queryByText('Жим лёжа')).toBeNull()
    expect(within(map).getByText('За последний месяц')).toBeVisible()
    expect(within(map).getByText('1 августа – 31 августа 2026')).toBeVisible()
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
    expect(document.querySelector('.body-progress-overlay')).toBeNull()
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

  it('keeps every zone available as a list when gender is missing', async () => {
    const user = userEvent.setup()
    renderRoute('/me', { gender: null })
    expect(document.querySelector('.body-progress-overlay')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Сзади' })).toBeNull()
    const zones = screen.getByRole('group', { name: 'Зоны тела' })
    await user.click(within(zones).getByRole('button', { name: 'Верх спины. Нагрузка зоны: 33%' }))
    expect(screen.getByRole('status')).toHaveTextContent('Верх спины33%')
    expect(screen.getByText('1 августа – 31 августа 2026')).toBeVisible()
  })

  it('lets the zone list select a region on the other side of the figure', async () => {
    const user = userEvent.setup()
    renderRoute('/me')
    await user.click(screen.getByText('Выбрать зону'))
    await user.click(within(screen.getByRole('group', { name: 'Зоны тела' })).getByRole('button', { name: 'Верх спины. Нагрузка зоны: 33%' }))
    expect(screen.getByRole('button', { name: 'Сзади' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('status')).toHaveTextContent('Верх спины33%')
  })

  it('falls back to the same zone values if the original photo cannot load', async () => {
    const user = userEvent.setup()
    renderRoute('/me')
    const image = document.querySelector('.body-progress-figure-image')!
    fireEvent.error(image)
    expect(document.querySelector('.body-progress-overlay')).toBeNull()
    expect(screen.getByText('Не удалось загрузить фигуру. Выберите зону из списка.')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Верх спины. Нагрузка зоны: 33%' }))
    expect(screen.getByRole('status')).toHaveTextContent('Верх спины33%')
  })

  it('paints specific muscles above broad fallback zones regardless of their percentage', () => {
    const mixed = { ...workout, exercises: [exercise('curl', 'Сгибание рук на бицепс', 'arms', 'strength', 8), exercise('generic', 'Движение руками', 'arms', 'strength', 1)] }
    const data = loadBodyMap([mixed], start, end)
    const props = { data, selected: data.regions[0], insightCandidates: [], variant: 'male' as const, side: 'front' as const, onSideChange: vi.fn(), onSelect: vi.fn(), onShowDetails: vi.fn() }
    const view = render(<MapPanel {...props} />)
    const zoneOrder = () => [...document.querySelectorAll('[data-body-zone]')].map((element) => element.getAttribute('data-body-zone'))
    expect(zoneOrder()).toEqual(['arms', 'biceps'])
    view.rerender(<MapPanel {...props} data={{ ...data, regions: [...data.regions].reverse() }} />)
    expect(zoneOrder()).toEqual(['arms', 'biceps'])
    expect(document.querySelector('feGaussianBlur')).toBeNull()
    const maskImage = document.querySelector('mask image')
    expect(maskImage).toHaveAttribute('href', '/illustrations/body-progress-athlete.png')
    expect(document.querySelector('.body-progress-figure-image')).toHaveAttribute('href', maskImage!.getAttribute('href'))
  })
})
