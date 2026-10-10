import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { localDate } from '../../shared/local-date'
import { useWorkoutHistoryCalendar, useWorkoutPlannedCalendar } from './use-workout-history-calendar'

function CalendarControls() {
  const calendar = useWorkoutHistoryCalendar(localDate('2026-09-03'))
  const navigate = useNavigate()
  const location = useLocation()
  return <>
    <output>{location.pathname}{calendar.search}</output>
    <button onClick={() => calendar.showCalendar(localDate('2026-08-10'))}>Календарь</button>
    <button onClick={() => calendar.selectDate(localDate('2026-08-10'))}>День</button>
    <button onClick={() => calendar.shiftMonth(-1)}>Раньше</button>
    <button onClick={calendar.showList}>Список</button>
    <button onClick={() => navigate(-1)}>Назад</button>
  </>
}

describe('history calendar URL state', () => {
  it.each(['/me/workouts', '/clients/one/workouts'])('changes filters without adding navigation steps: %s', async (path) => {
    render(<MemoryRouter initialEntries={['/source', `${path}?context=keep`]} initialIndex={1}><Routes>
      <Route path="/source" element={<p>Исходный экран</p>} />
      <Route path={path} element={<CalendarControls />} />
    </Routes></MemoryRouter>)
    fireEvent.click(screen.getByText('Календарь'))
    expect(screen.getByRole('status')).toHaveTextContent(`${path}?context=keep&view=calendar&month=2026-08`)
    fireEvent.click(screen.getByText('День'))
    expect(screen.getByRole('status')).toHaveTextContent('date=2026-08-10')
    fireEvent.click(screen.getByText('Раньше'))
    expect(screen.getByRole('status')).toHaveTextContent('month=2026-07')
    expect(screen.getByRole('status')).not.toHaveTextContent('date=')
    fireEvent.click(screen.getByText('Список'))
    expect(screen.getByRole('status')).toHaveTextContent(`${path}?context=keep`)
    fireEvent.click(screen.getByText('Назад'))
    await waitFor(() => expect(screen.getByText('Исходный экран')).toBeVisible())
  })
})

function BothCalendarControls() {
  const history = useWorkoutHistoryCalendar(localDate('2026-09-03'))
  const planned = useWorkoutPlannedCalendar(localDate('2026-09-03'))
  const [params, setParams] = useSearchParams()
  return <>
    <output>{params.toString()}</output>
    <button onClick={() => planned.showCalendar(localDate('2026-10-11'))}>Планы календарём</button>
    <button onClick={() => planned.selectDate(localDate('2026-10-11'))}>Выбрать план</button>
    <button onClick={() => history.showCalendar(localDate('2026-08-10'))}>История календарём</button>
    <button onClick={() => setParams((current) => { const next = new URLSearchParams(current); next.set('tab', 'history'); return next }, { replace: true })}>История</button>
    <span>Планы: {planned.state.view}, {planned.state.month}, {planned.state.selectedDate}</span>
    <span>История: {history.state.view}, {history.state.month}</span>
  </>
}

describe('client planned and history calendar state', () => {
  it('preserves independent view, future month and selected date across tabs', () => {
    render(<MemoryRouter initialEntries={['/me/workouts?tab=current']}><Routes>
      <Route path="/me/workouts" element={<BothCalendarControls />} />
    </Routes></MemoryRouter>)

    fireEvent.click(screen.getByText('Планы календарём'))
    fireEvent.click(screen.getByText('Выбрать план'))
    fireEvent.click(screen.getByText('История календарём'))
    fireEvent.click(screen.getByText('История', { selector: 'button' }))

    expect(screen.getByText(/Планы: calendar, 2026-10-01, 2026-10-11/)).toBeVisible()
    expect(screen.getByText(/История: calendar, 2026-08-01/)).toBeVisible()
    expect(screen.getByRole('status')).toHaveTextContent('plannedDate=2026-10-11')
    expect(screen.getByRole('status')).toHaveTextContent('tab=history')
  })
})
