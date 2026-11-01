import { renderHook } from '@testing-library/react'
import { beforeEach, expect, it } from 'vitest'
import { readCoachCalendarRoute, useCoachCalendarDestination, useCoachFinanceDestination } from './coach-calendar-navigation'

beforeEach(() => sessionStorage.clear())

it('retains calendar date, range and filters across routes and isolates accounts', () => {
  const route = '?week=2026-12-28&range=2w&anchor=2027-01-04&client=client&status=planned'
  const { result, rerender } = renderHook(({ user, path, search }) => useCoachCalendarDestination(user, true, path, search), {
    initialProps: { user: 'first', path: '/today', search: route },
  })
  expect(result.current).toBe(`/today${route}`)
  rerender({ user: 'first', path: '/clients', search: '' })
  expect(result.current).toBe(`/today${route}`)
  rerender({ user: 'second', path: '/clients', search: '' })
  expect(result.current).toBe('/today')
  expect(readCoachCalendarRoute('first')).toBe(`/today${route}`)
  expect(readCoachCalendarRoute('second')).toBeNull()
})

it.each(['/today?view=compose', '/today?view=save', '/today?classic=1', '//example.com/today', 'https://example.com/today', '/today#other', '/schedule/templates'])('rejects non-calendar stored destinations %s', (value) => {
  sessionStorage.setItem('fit.coach-calendar-route.first', value)
  expect(readCoachCalendarRoute('first')).toBeNull()
})

it('does not retain a composer or disabled actor and remembers finance month/filter', () => {
  const calendar = renderHook(({ path, search, enabled }) => useCoachCalendarDestination('first', enabled, path, search), {
    initialProps: { path: '/today', search: '?date=2026-09-24', enabled: true },
  })
  calendar.rerender({ path: '/today', search: '?view=compose', enabled: true })
  expect(calendar.result.current).toBe('/today?date=2026-09-24')
  calendar.rerender({ path: '/today', search: '?date=2026-10-01', enabled: false })
  expect(readCoachCalendarRoute('first')).toBe('/today?date=2026-09-24')
  const finance = renderHook(({ path, search }) => useCoachFinanceDestination('first', true, path, search), {
    initialProps: { path: '/finance', search: '?month=2026-09&filter=overdue' },
  })
  finance.rerender({ path: '/clients/client/finance', search: '' })
  expect(finance.result.current).toBe('/finance?month=2026-09&filter=overdue')
})
