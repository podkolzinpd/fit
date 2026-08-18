import { render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppLayout } from './AppLayout'

const authState = vi.hoisted(() => ({ role: 'client' as 'client' | 'trainer' }))

vi.mock('./auth-context', () => ({
  useAuth: () => ({ actor: { role: authState.role } }),
}))
vi.mock('./theme', () => ({ useAppTheme: () => 'light' }))
vi.mock('./feature-flags', () => ({ isTodayStartRedesignEnabled: () => true }))

function renderLayout(path: string) {
  return render(<MemoryRouter initialEntries={[path]}>
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="*" element={<div>Содержимое</div>} />
      </Route>
    </Routes>
  </MemoryRouter>)
}

function iconName(link: HTMLElement) {
  return link.querySelector('svg')?.getAttribute('data-icon')
}

afterEach(() => { authState.role = 'client' })

describe('AppLayout navigation', () => {
  it('показывает Кабинет клиента как домашний раздел', () => {
    renderLayout('/me')
    const navigation = screen.getByRole('navigation', { name: 'Основная навигация' })
    expect(iconName(within(navigation).getByRole('link', { name: 'Кабинет' }))).toBe('home')
    expect(iconName(within(navigation).getByRole('link', { name: 'Тренировки' }))).toBe('schedule')
  })

  it('различает Сегодня и Расписание тренера', () => {
    authState.role = 'trainer'
    renderLayout('/today')
    const navigation = screen.getByRole('navigation', { name: 'Основная навигация' })
    const todayIcon = iconName(within(navigation).getByRole('link', { name: 'Сегодня' }))
    const scheduleIcon = iconName(within(navigation).getByRole('link', { name: 'Расписание' }))
    expect(todayIcon).toBe('today')
    expect(scheduleIcon).toBe('schedule')
    expect(todayIcon).not.toBe(scheduleIcon)
  })
})
