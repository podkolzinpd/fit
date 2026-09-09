import { fireEvent, render, screen, within } from '@testing-library/react'
import type { ComponentProps } from 'react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import type { Workout, WorkoutExercise } from '../../shared/domain'
import { localDate } from '../../shared/local-date'
import { ClientBodyMapDisclosure, WorkoutLoadMap, workoutMapLink } from './WorkoutBodyMap'
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
  exercises: [exercise('press', 'Жим лёжа', 'chest', 'strength', 2), exercise('run', 'Бег', 'cardio', 'distance', 1), exercise('unknown', 'Неопределённое движение', 'other', 'strength', 1)] }

function Source() {
  const location = useLocation()
  const navigate = useNavigate()
  return <><h1>Исходная тренировка</h1><output>{JSON.stringify(location.state)}</output><button onClick={() => navigate(-1)}>Назад к карте</button></>
}

function renderRoute(initial: string) {
  return render(<MemoryRouter initialEntries={[initial]}><Routes>
    <Route path="/me" element={<WorkoutLoadMap workout={workout} compact />} />
    <Route path="/me/progress" element={<ClientBodyMapDisclosure workouts={[workout]} clientId="client-1" periodStart={localDate('2026-07-17')} periodEnd={localDate('2026-08-16')} loading={false} error={null} onRetry={vi.fn()} />} />
    <Route path="/workouts/:id" element={<Source />} />
  </Routes></MemoryRouter>)
}

describe('Home and Progress workout map', () => {
  it('accounts for cardio, unknown zones and confirmed sets without claiming they are zero work', () => {
    const unconfirmed = { ...workout, id: 'draft', exercises: workout.exercises.map((item) => ({ ...item, sets: item.sets.map((set) => ({ ...set, confirmedAt: null })) })) }
    const data = loadBodyMap([workout, unconfirmed, { ...workout, status: 'planned' }], '2026-08-10', '2026-08-10')
    expect(data.coverage).toEqual({ totalSets: 4, mappedSets: 2, cardioSets: 1, unknownSets: 1 })
    expect(data.regions.map((region) => [region.group, region.setCount, region.percent])).toEqual([['chest', 2, 100]])
    expect(loadBodyMap([workout], '2026-08-11', '2026-08-11').coverage.totalSets).toBe(0)
  })

  it('keeps the selected workout, mode, zone and dates through Home → Progress → source → back without AI', async () => {
    const user = userEvent.setup()
    renderRoute('/me')
    const map = screen.getByRole('region', { name: 'Распределение подходов' })
    await user.click(within(map).getByRole('button', { name: 'Грудь: 2 подхода' }))
    expect(within(map).queryByRole('button', { name: /Грудь\. Доля/ })).toBeNull()
    expect(within(map).getByText('Всего 4 подхода')).toBeVisible()
    expect(within(map).getByText(/Кардио: 1 подход/)).toHaveTextContent('5 км')
    const link = screen.getByRole('link', { name: 'Разбор нагрузки' })
    expect(link).toHaveAttribute('href', workoutMapLink(workout, 'chest'))
    await user.click(link)
    expect(document.querySelector('details')).toHaveAttribute('open')
    expect(screen.getByText(/10 августа 2026 г. · тренировка/)).toBeVisible()
    expect(screen.getByText('Жим лёжа: 2 подхода')).toBeVisible()
    await user.click(screen.getByRole('link', { name: 'Открыть тренировку' }))
    expect(screen.getByRole('heading', { name: 'Исходная тренировка' })).toBeVisible()
    expect(screen.getByRole('status')).toHaveTextContent('mapWorkout=last-workout')
    await user.click(screen.getByRole('button', { name: 'Назад к карте' }))
    expect(document.querySelector('details')).toHaveAttribute('open')
    expect(screen.getByRole('button', { name: 'Грудь: 2 подхода' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText(/10 августа 2026 г. · тренировка/)).toBeVisible()
  })

  it('keeps the full map collapsed on an ordinary visit', () => {
    renderRoute('/me/progress')
    expect(document.querySelector('details')).not.toHaveAttribute('open')
    expect(screen.queryByRole('region', { name: 'Распределение подходов' })).toBeNull()
  })

  it.each([
    '/me/progress?mapWorkout=deleted&mapMode=load&mapFrom=2026-08-10&mapTo=2026-08-10',
    '/me/progress?mapWorkout=last-workout&mapMode=load&mapFrom=2026-08-09&mapTo=2026-08-10',
    '/me/progress?mapWorkout=last-workout&mapMode=progress&mapFrom=2026-08-10&mapTo=2026-08-10',
  ])('does not silently substitute a period for an unavailable or changed scope: %s', (path) => {
    renderRoute(path)
    expect(screen.getByRole('alert')).toHaveTextContent('Эта тренировка недоступна или её дата изменилась')
    expect(screen.queryByRole('region', { name: 'Распределение подходов' })).toBeNull()
  })

  it('shows recorded work without a large empty figure when no zone is mapped', () => {
    render(<MemoryRouter><WorkoutLoadMap workout={{ ...workout, exercises: workout.exercises.slice(1) }} compact /></MemoryRouter>)
    expect(document.querySelector('svg')).toBeNull()
    expect(screen.getByText(/Кардио: 1 подход/)).toHaveTextContent('Без группы: 1 подход')
  })

  it('shows only complete confirmed cardio totals and falls back to set count for missing metrics', () => {
    const run = exercise('run', 'Бег', 'cardio', 'distance', 1)
    run.sets[0]!.fact = { distanceKm: 5, durationSec: 1800 }
    run.sets.push({ ...run.sets[0]!, id: 'draft', confirmedAt: null, fact: { distanceKm: 100, durationSec: 9000 } })
    const ui = () => <MemoryRouter><WorkoutLoadMap workout={{ ...workout, exercises: [run] }} compact /></MemoryRouter>
    const view = render(ui())
    expect(screen.getByText(/Кардио:/)).toHaveTextContent('Кардио: 1 подход · 30:00 · 5 км')
    run.sets.push({ ...run.sets[0]!, id: 'missing-values', fact: {} })
    view.rerender(ui())
    expect(screen.getByText(/Кардио:/)).toHaveTextContent(/^Кардио: 2 подхода$/)
  })

  it('keeps additional zones accessible and switches the selected zone with the side', async () => {
    const user = userEvent.setup()
    const several = { ...workout, exercises: [workout.exercises[0]!, exercise('row', 'Тяга верхнего блока', 'back', 'strength', 1),
      exercise('curl', 'Молот с гантелями', 'arms', 'strength', 1), exercise('bridge', 'Ягодичный мост', 'glutes', 'strength', 1), exercise('squat', 'Присед', 'legs', 'strength', 1)] }
    render(<MemoryRouter><WorkoutLoadMap workout={several} gender="female" compact /></MemoryRouter>)
    await user.click(screen.getByRole('button', { name: 'Сзади' }))
    expect(screen.getByRole('button', { name: 'Ягодицы: 1 подход' })).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByText('Показать все группы'))
    await user.click(screen.getByRole('button', { name: 'Верх спины: 1 подход' }))
    expect(screen.getByRole('link', { name: 'Разбор нагрузки' })).toHaveAttribute('href', workoutMapLink(workout, 'upper_back'))
    await user.click(screen.getByRole('button', { name: 'Спереди' }))
    expect(screen.getByRole('button', { name: 'Грудь: 2 подхода' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('supports keyboard and swipe selection on the full map', () => {
    const change = vi.fn()
    const several = { ...workout, exercises: [workout.exercises[0]!, exercise('row', 'Тяга верхнего блока', 'back', 'strength', 1)] }
    render(<MemoryRouter><WorkoutLoadMap workout={several} gender="male" zone="chest" onZoneChange={change} /></MemoryRouter>)
    const region = screen.getByRole('button', { name: 'Грудь. Доля подходов: 67%' })
    fireEvent.keyDown(region, { key: 'ArrowDown' })
    expect(change).not.toHaveBeenCalled()
    fireEvent.keyDown(region, { key: 'Enter' })
    fireEvent.keyDown(region, { key: ' ' })
    expect(change).toHaveBeenLastCalledWith('chest')
    const figure = document.querySelector('.body-progress-visual')!
    fireEvent.touchEnd(figure, { changedTouches: [{ clientX: 20 }] })
    fireEvent.touchStart(figure, { changedTouches: [{ clientX: 100 }] })
    fireEvent.touchEnd(figure, { changedTouches: [{ clientX: 90 }] })
    expect(change).toHaveBeenLastCalledWith('chest')
    fireEvent.touchStart(figure, { changedTouches: [{ clientX: 100 }] })
    fireEvent.touchEnd(figure, { changedTouches: [{ clientX: 20 }] })
    expect(change).toHaveBeenLastCalledWith('upper_back')
    fireEvent.touchStart(figure, { changedTouches: [{ clientX: 20 }] })
    fireEvent.touchEnd(figure, { changedTouches: [{ clientX: 100 }] })
    expect(change).toHaveBeenLastCalledWith('chest')
  })

  it('recovers from a failed request, rejects another client and explicitly clears a workout scope', async () => {
    const user = userEvent.setup()
    const retry = vi.fn()
    const panel = (overrides: Partial<ComponentProps<typeof ClientBodyMapDisclosure>>) => <MemoryRouter initialEntries={[workoutMapLink(workout, 'chest')]}>
      <ClientBodyMapDisclosure clientId="client-1" periodStart={localDate('2026-08-01')} periodEnd={localDate('2026-08-31')} loading={false} error={null} onRetry={retry} {...overrides} />
    </MemoryRouter>
    const view = render(panel({ error: new Error('offline') }))
    await user.click(screen.getByRole('button', { name: 'Повторить' }))
    expect(retry).toHaveBeenCalledOnce()
    view.rerender(panel({ loading: true }))
    expect(screen.getByRole('status')).toHaveTextContent('Загружаем карту')
    view.rerender(panel({ workouts: [{ ...workout, clientId: 'someone-else' }] }))
    expect(screen.getByRole('alert')).toHaveTextContent('Эта тренировка недоступна')
    view.rerender(panel({ workouts: [{ ...workout, exercises: [] }] }))
    expect(screen.getByText(/Для этой зоны больше нет/)).toBeVisible()
    expect(screen.getByText(/Нет выполненных подходов/)).toBeVisible()
    view.rerender(panel({ workouts: [workout] }))
    await user.click(screen.getByRole('button', { name: 'Перейти к карте за период' }))
    expect(screen.getAllByText('Карта тела')[0]).toBeVisible()
    expect(screen.getByText('1 августа 2026 г. — 31 августа 2026 г.')).toBeVisible()
    await user.click(screen.getAllByText('Карта тела')[0]!)
    expect(document.querySelector('details')).not.toHaveAttribute('open')
  })
})
