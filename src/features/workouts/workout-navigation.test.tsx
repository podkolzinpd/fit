import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { BrowserRouter, Link, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { hasWorkoutBackEntry, safeWorkoutReturnTo, useWorkoutBack, workoutListFallback } from './workout-navigation'

afterEach(() => window.history.replaceState(null, '', '/'))

function Detail() {
  const back = useWorkoutBack('/clients/client-1/workouts')
  return <button onClick={back}>Назад</button>
}

describe('workout navigation', () => {
  it.each([undefined, null, 'https://example.com', '//example.com', '/\\example.com', '/workouts/\\example.com', 'javascript:alert(1)', '/auth'])('rejects unsafe return path %s', (value) => {
    expect(safeWorkoutReturnTo(value)).toBeUndefined()
  })

  it.each(['/today', '/me/workouts?view=calendar&date=2026-09-01', '/clients/one/workouts', '/schedule?date=2026-08-10', '/workouts/one?reply=1', '/progress/one'])('keeps the complete internal source %s', (value) => {
    expect(safeWorkoutReturnTo(value)).toBe(value)
  })

  it('uses router history, not history length from unrelated pages', () => {
    window.history.replaceState({ idx: 0 }, '', '/')
    expect(hasWorkoutBackEntry()).toBe(false)
    window.history.replaceState({ idx: 2 }, '', '/')
    expect(hasWorkoutBackEntry()).toBe(true)
    window.history.replaceState({ idx: '2' }, '', '/')
    expect(hasWorkoutBackEntry()).toBe(false)
    expect(workoutListFallback(true, 'one')).toBe('/me/workouts')
    expect(workoutListFallback(false, 'one')).toBe('/clients/one/workouts')
    expect(workoutListFallback(false)).toBe('/clients')
  })

  it('pops to the original source and does not push a new list entry', async () => {
    window.history.replaceState({ idx: 0 }, '', '/clients/client-1/workouts?view=calendar&month=2026-08&date=2026-08-10')
    render(<BrowserRouter><Routes>
      <Route path="/clients/:id/workouts" element={<Link to="/workouts/one" state={{ returnTo: '/schedule' }}>Тренировка</Link>} />
      <Route path="/workouts/:id" element={<Detail />} />
    </Routes></BrowserRouter>)
    fireEvent.click(screen.getByRole('link', { name: 'Тренировка' }))
    fireEvent.click(screen.getByRole('button', { name: 'Назад' }))
    await waitFor(() => expect(window.location.pathname).toBe('/clients/client-1/workouts'))
    expect(window.location.search).toBe('?view=calendar&month=2026-08&date=2026-08-10')
    expect(hasWorkoutBackEntry()).toBe(false)
  })

  it('replaces a direct link with a safe client fallback', () => {
    window.history.replaceState({ idx: 0, usr: { returnTo: '//example.com' } }, '', '/workouts/one')
    render(<BrowserRouter><Routes>
      <Route path="/workouts/:id" element={<Detail />} />
      <Route path="/clients/:id/workouts" element={<p>История</p>} />
    </Routes></BrowserRouter>)
    fireEvent.click(screen.getByRole('button', { name: 'Назад' }))
    expect(screen.getByText('История')).toBeVisible()
    expect(hasWorkoutBackEntry()).toBe(false)
  })
})
