import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { createElement } from 'react'
import type { Workout } from './domain'
import { localDate } from './local-date'
import { latestWorkoutFact, workoutResults } from './workout-results'
import { PersonalWorkoutResult } from './PersonalWorkoutResult'

function workout(id: string, weight = 40, reps = 10, patch: Partial<Workout> = {}): Workout {
  return { id, clientId: 'client', clientName: 'Тест', workoutDate: localDate('2026-09-08'),
    completedAt: `2026-09-08T${id === 'a' ? '08' : '10'}:00:00Z`, startedAt: null, startTime: null, endTime: null,
    status: 'done', notes: null, stageId: null, stageTitle: null, version: 1,
    exercises: [{ id: `ex-${id}`, source: 'system', ref: 'squat', name: 'Присед', inputKind: 'strength', muscleGroup: 'legs', position: 0,
      blockId: 'block', blockType: 'single', blockPreset: 'set', blockRounds: 1, restBetweenExercisesSec: 0, restBetweenRoundsSec: 0, restBetweenSetsSec: 0,
      sets: [{ id: `set-${id}`, position: 0, version: 1, confirmedAt: '2026-09-08T08:00:00Z', fact: { weightKg: weight, reps } }],
    }], ...patch }
}

describe('personal workout facts', () => {
  it.each([[45, '40 → 45 кг · +5 кг'], [35, '40 → 35 кг · −5 кг'], [40, '40 → 40 кг']])('compares %s kg inline on Home without a misleading previous-workout link', (weight, comparison) => {
    render(createElement(MemoryRouter, {}, createElement(PersonalWorkoutResult, { home: true, workouts: [workout('a'), workout('b', weight)] })))
    expect(screen.getByText((_, element) => element?.tagName === 'P' && element.textContent === comparison)).toBeVisible()
    expect(screen.getByText(/К прошлому результату/)).toBeVisible()
    expect(screen.getByRole('link', { name: 'Открыть тренировку' })).toHaveAttribute('href', '/workouts/b')
    expect(screen.queryByRole('link', { name: 'Сравнить' })).toBeNull()
  })
  it('keeps a first Home result without invented comparison, and handles loading and empty history', () => {
    const ui = (props: { workouts?: Workout[]; loading?: boolean }) => createElement(MemoryRouter, {}, createElement(PersonalWorkoutResult, { home: true, ...props }))
    const view = render(ui({ workouts: [workout('a')] }))
    expect(screen.getByText('Первый результат')).toBeVisible()
    expect(screen.queryByText(/К прошлому результату/)).toBeNull()
    view.rerender(ui({ loading: true }))
    expect(screen.getByRole('status')).toHaveTextContent('Загружаем результат')
    view.rerender(ui({ workouts: [] }))
    expect(screen.getByText('Здесь появится результат после первой тренировки.')).toBeVisible()
  })
  it('has no invented fact without workouts or confirmed values', () => {
    expect(latestWorkoutFact([])).toEqual({})
    const empty = workout('a'); empty.exercises[0]!.sets[0]!.confirmedAt = null
    expect(latestWorkoutFact([empty]).result).toBeUndefined()
    expect(latestWorkoutFact([workout('a', 40, 10, { status: 'planned' })]).workout).toBeUndefined()
  })
  it('uses a baseline before a real record, including separate same-day workouts', () => {
    const first = workout('a'); const next = workout('b', 45)
    expect(latestWorkoutFact([first]).result?.state).toBe('baseline')
    const fact = latestWorkoutFact([next, first]).result!
    expect(fact).toMatchObject({ metric: 'weight', value: 45, state: 'record', previous: { value: 40, workout: { id: 'a' } } })
    expect(latestWorkoutFact([first, next])).toEqual(latestWorkoutFact([next, first]))
  })
  it('retains ref identity across rename, isolates another exercise and athlete', () => {
    const first = workout('a'); const renamed = workout('b', 45)
    renamed.exercises[0]!.name = 'Новое название'
    expect(latestWorkoutFact([first, renamed]).result?.state).toBe('record')
    renamed.exercises[0]!.ref = 'another-squat'
    expect(latestWorkoutFact([first, renamed]).result?.state).toBe('baseline')
    expect(latestWorkoutFact([first, workout('b', 45, 10, { clientId: 'other' })]).result?.state).toBe('baseline')
  })
  it('checks all history, reports stable and decline, recalculates edits/deletes', () => {
    const oldest = workout('0', 60, 10, { workoutDate: localDate('2026-01-01') })
    const first = workout('a', 40); const next = workout('b', 45)
    expect(latestWorkoutFact([oldest, first, next]).result).toMatchObject({ state: 'increase', previous: { value: 40 }, previousBest: { value: 60 } })
    expect(latestWorkoutFact([oldest, first, next, workout('c', 65)]).result).toMatchObject({ state: 'record', previous: { value: 45 }, previousBest: { value: 60 } })
    expect(latestWorkoutFact([first, workout('b', 40)]).result?.state).toBe('stable')
    expect(latestWorkoutFact([first, workout('b', 35)]).result?.state).toBe('decrease')
    expect(latestWorkoutFact([workout('a', 50), next]).result?.state).toBe('decrease')
    expect(latestWorkoutFact([next]).result?.state).toBe('baseline')
    expect(latestWorkoutFact([first]).workout?.id).toBe('a')
  })
  it('separates fixed-weight reps and total volume, ignores unconfirmed plans', () => {
    const first = workout('a'); const next = workout('b', 40, 12)
    next.exercises[0]!.sets.push({ ...next.exercises[0]!.sets[0]!, id: 'unconfirmed', confirmedAt: null, fact: { weightKg: 200, reps: 20 } })
    const result = workoutResults([first, next]).filter((item) => item.workout.id === 'b')
    expect(result.find((item) => item.metric === 'weight')?.value).toBe(40)
    expect(result.find((item) => item.metric === 'weight')).toMatchObject({ value: 40, performedReps: 12 })
    expect(result.find((item) => item.metric === 'fixed_reps')).toMatchObject({ value: 12, fixedWeight: 40, performedReps: 12, previousBest: { value: 10 }, state: 'record' })
    expect(result.find((item) => item.metric === 'volume')?.value).toBe(480)
    expect(latestWorkoutFact([first, next]).result?.metric).toBe('fixed_reps')
  })
  it('does not fabricate volume from missing reps or first PRs in cardio', () => {
    const first = workout('a'); first.exercises[0]!.sets[0]!.fact.reps = undefined
    expect(workoutResults([first])).toEqual([])
    const run = workout('b'); run.exercises[0]!.inputKind = 'distance'; run.exercises[0]!.sets[0]!.fact = { distanceKm: 5 }
    expect(latestWorkoutFact([run]).result).toMatchObject({ value: 5, unit: 'км', state: 'baseline' })
  })
  it('links both exact sources and replaces stale facts with a retry on error', () => {
    const data = [workout('a'), workout('b', 45)]
    const props = { workouts: data }
    const ui = (extra = {}) => createElement(MemoryRouter, {}, createElement(PersonalWorkoutResult, { ...props, ...extra }))
    const view = render(ui())
    expect(screen.getByRole('link', { name: 'Открыть' })).toHaveAttribute('href', '/workouts/b')
    expect(screen.getByRole('link', { name: 'Сравнить' })).toHaveAttribute('href', '/workouts/a')
    let retried = false
    view.rerender(ui({ error: new Error('offline'), onRetry: () => { retried = true } }))
    expect(screen.queryByText('Личный рекорд')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }))
    expect(retried).toBe(true)
  })
})
