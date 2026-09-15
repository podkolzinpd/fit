import { render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import { AssistantProgramOverview } from './AssistantProgramOverview'

const exercise = { exerciseRef: 'leg-press', name: 'Жим ногами', sets: 2, reps: 8, durationSec: null, rpe: 6.5, restSec: 90 }
it('shows all weeks, a dated fact and a single-week replacement in the overview', () => {
  const sessions = [21, 28, 35, 42].map((offset, index) => ({ day: new Date(Date.UTC(2026, 8, offset)).toISOString().slice(0, 10), week: index + 1, title: 'А',
    exercises: [{ ...exercise, ...(index === 2 ? { exerciseRef: 'squat', name: 'Приседания', reps: 10 } : {}) }] }))
  render(<AssistantProgramOverview payload={{ sessions, historyFacts: [{ source: 'system', ref: 'leg-press', recentExecutions: [{ date: '2026-09-14', sets: [{ reps: 8, weightKg: 40, durationSec: null }] }] }] }} />)
  expect(screen.getByText(/Неделя 1: 2 × 8/)).toBeVisible()
  expect(screen.getByText(/Неделя 3: Приседания/)).toBeVisible()
  expect(screen.getByText(/последний факт в Fit 2026-09-14/)).toHaveTextContent('40 кг')
  expect(screen.getByText(/Приседания: сопоставимого факта в Fit нет/)).toBeVisible()
})
it('does not invent history for a novice', () => {
  render(<AssistantProgramOverview payload={{ sessions: [{ day: '2026-09-21', week: 1, title: 'А', exercises: [exercise] }], historyFacts: [] }} />)
  expect(screen.getByText(/сопоставимого факта в Fit нет/)).toBeVisible()
})
