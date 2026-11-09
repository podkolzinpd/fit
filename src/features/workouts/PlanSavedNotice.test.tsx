import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { PlanSavedNotice } from './PlanSavedNotice'

afterEach(() => vi.useRealTimers())

function Calendar() {
  const location = useLocation(), navigate = useNavigate()
  return <><PlanSavedNotice /><pre>{JSON.stringify(location.state)}</pre><p>{location.search}</p><button onClick={() => void navigate(-1)}>Предыдущий день</button><button onClick={() => void navigate('/today?date=2026-11-09')}>Другой день</button><button onClick={() => void navigate('/other')}>Открыть</button></>
}
function Other() {
  const navigate = useNavigate()
  return <button onClick={() => void navigate(-1)}>Вернуться</button>
}
function mount() {
  return render(<MemoryRouter initialEntries={[{ pathname: '/today', search: '?date=2026-11-08', state: { savedPlanId: '10000000-0000-4000-8000-000000000003', retainedContext: 'keep' } }]}><Routes>
    <Route path="/today" element={<Calendar />} /><Route path="/other" element={<Other />} />
  </Routes></MemoryRouter>)
}

it('consumes only the receipt and keeps its actions available without changing calendar context', () => {
  vi.useFakeTimers()
  act(() => { mount() })
  expect(screen.getByRole('status')).toHaveTextContent('План сохранён')
  expect(screen.getByRole('link', { name: 'Открыть' })).toHaveAttribute('href', '/workouts/10000000-0000-4000-8000-000000000003')
  expect(screen.getByRole('button', { name: 'Скрыть подтверждение' })).toBeVisible()
  expect(screen.getByRole('status')).toBeVisible()
  expect(screen.getByRole('status').parentElement?.querySelector('pre')).toHaveTextContent('{"retainedContext":"keep"}')
  expect(screen.getByText('?date=2026-11-08')).toBeInTheDocument()
  act(() => vi.advanceTimersByTime(10000))
  expect(screen.getByRole('status')).toBeVisible()
  expect(screen.getByRole('link', { name: 'Открыть' })).toBeVisible()
})

it('does not replay the receipt when returning to the same calendar history entry', () => {
  act(() => { mount() })
  fireEvent.click(screen.getByRole('button', { name: 'Открыть' }))
  fireEvent.click(screen.getByRole('button', { name: 'Вернуться' }))
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
  expect(screen.getByText('?date=2026-11-08')).toBeInTheDocument()
})

it('keeps the existing dismissal action without clearing calendar context', () => {
  act(() => { mount() })
  fireEvent.click(screen.getByRole('button', { name: 'Скрыть подтверждение' }))
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
  expect(screen.getByText('?date=2026-11-08')).toBeInTheDocument()
})

it('dismisses the receipt on a calendar context change and does not replay it on back', () => {
  act(() => { mount() })
  fireEvent.click(screen.getByRole('button', { name: 'Другой день' }))
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Предыдущий день' }))
  expect(screen.getByText('?date=2026-11-08')).toBeInTheDocument()
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
})
