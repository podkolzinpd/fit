import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { PlanSavedNotice } from './PlanSavedNotice'

afterEach(() => vi.useRealTimers())

function Calendar() {
  const location = useLocation(), navigate = useNavigate()
  return <><PlanSavedNotice /><pre>{JSON.stringify(location.state)}</pre><p>{location.search}</p><button onClick={() => void navigate('/other')}>Открыть</button></>
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

it('consumes only the receipt and removes its feedback without changing calendar context', () => {
  vi.useFakeTimers()
  act(() => { mount() })
  expect(screen.getByRole('status')).toHaveTextContent('План сохранён')
  expect(screen.getByRole('status').querySelector('button, a')).toBeNull()
  expect(screen.getByRole('status').textContent).toBe('План сохранён')
  expect(screen.getByRole('status')).toBeVisible()
  expect(screen.getByRole('status').parentElement?.querySelector('pre')).toHaveTextContent('{"retainedContext":"keep"}')
  expect(screen.getByText('?date=2026-11-08')).toBeInTheDocument()
  act(() => vi.advanceTimersByTime(3000))
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
})

it('does not replay the receipt when returning to the same calendar history entry', () => {
  act(() => { mount() })
  fireEvent.click(screen.getByRole('button', { name: 'Открыть' }))
  fireEvent.click(screen.getByRole('button', { name: 'Вернуться' }))
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
  expect(screen.getByText('?date=2026-11-08')).toBeInTheDocument()
})
