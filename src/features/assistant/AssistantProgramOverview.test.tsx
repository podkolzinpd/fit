import { render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import { AssistantProgramOverview } from './AssistantProgramOverview'

const exercise = { exerciseRef: 'leg-press', name: 'Жим ногами', sets: 2, reps: 8, durationSec: null, rpe: 6.5, restSec: 90 }
it('shows all weeks, a dated fact and a single-week replacement in the overview', () => {
  const sessions = [21, 28, 35, 42].map((offset, index) => ({ day: new Date(Date.UTC(2026, 8, offset)).toISOString().slice(0, 10), week: index + 1, title: 'А',
    exercises: [{ ...exercise, ...(index === 2 ? { exerciseRef: 'squat', name: 'Приседания', reps: 10 } : {}) }] }))
  render(<AssistantProgramOverview payload={{ sessions, historyFacts: [{ source: 'system', ref: 'leg-press', recentExecutions: [{ date: '2026-09-14', sets: [{ reps: 8, weightKg: 40, durationSec: null }] }] }] }} />)
  expect(screen.getByText(/Недели 1–2: 2 подхода по 8 повторений/)).toBeVisible()
  expect(screen.getByText(/Неделя 3: Приседания/)).toBeVisible()
  expect(screen.getByText(/Результат в Fit от 2026-09-14/)).toHaveTextContent('40 кг')
  expect(screen.getByText(/нет записанного результата «Приседания»/)).toBeVisible()
})
it('does not invent history for a novice', () => {
  render(<AssistantProgramOverview payload={{ sessions: [{ day: '2026-09-21', week: 1, title: 'А', exercises: [exercise] }], historyFacts: [] }} />)
  expect(screen.getByText(/нет записанного результата этого упражнения для сравнения/)).toBeVisible()
})
it('groups unchanged weeks and shows the exercise progression explanation once', () => {
  const progressionNote = 'Первые две недели закрепляйте технику; затем добавьте одно повторение при целевом усилии.'
  const sessions = [21, 28, 35, 42].map((offset, index) => ({ day: new Date(Date.UTC(2026, 8, offset)).toISOString().slice(0, 10), week: index + 1, title: 'А',
    exercises: [{ ...exercise, progressionNote, reps: index < 2 ? 8 : 9 }] }))
  render(<AssistantProgramOverview payload={{ sessions, historyFacts: [] }} />)
  expect(screen.getByText(/Недели 1–2: 2 подхода по 8 повторений/)).toBeVisible()
  expect(screen.getByText(/Недели 3–4: 2 подхода по 9 повторений/)).toBeVisible()
  expect(screen.getAllByText(progressionNote, { exact: false })).toHaveLength(1)
  expect(screen.queryByText(/RPE/)).not.toBeInTheDocument()
})
