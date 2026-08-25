import { render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppLayout, appViewportMetrics } from './AppLayout'

const authState = vi.hoisted(() => ({
  role: 'client' as 'client' | 'trainer',
  userId: 'user-1',
  theme: 'light' as 'light' | 'dark',
}))

vi.mock('./auth-context', () => ({
  useAuth: () => ({ actor: { role: authState.role, userId: authState.userId } }),
}))
// Мокаем только выбор пользователя: разрешение варианта и применение класса
// остаются настоящими, иначе пилотная палитра не была бы проверена.
vi.mock('./theme', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./theme')>()),
  useAppTheme: () => authState.theme,
}))
// isDarkThemePilotEnabled и isAssistantNavPilotEnabled остаются настоящими:
// тесты пилотов управляют ими через vi.stubEnv и проверяют реальный проброс
// actor.userId в allowlist.
vi.mock('./feature-flags', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./feature-flags')>()),
  isTodayStartRedesignEnabled: () => true,
}))

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

afterEach(() => {
  authState.role = 'client'
  authState.userId = 'user-1'
  authState.theme = 'light'
  vi.unstubAllEnvs()
  document.documentElement.className = ''
})

describe('AppLayout navigation', () => {
  it('восстанавливает полную высоту оболочки после закрытия iOS-клавиатуры', () => {
    expect(appViewportMetrics(844, 508, 844)).toEqual({ height: 844, visibleHeight: 508, keyboardOpen: true })
    expect(appViewportMetrics(844, 843.6, 844)).toEqual({ height: 844, visibleHeight: 844, keyboardOpen: false })
    expect(appViewportMetrics(508, 508, 844)).toEqual({ height: 844, visibleHeight: 508, keyboardOpen: true })
    renderLayout('/today')
    expect(document.querySelector('.phone-frame')).not.toHaveAttribute('style')
  })

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

  it.each(['/workouts/new', '/workouts/workout-1/edit', '/today?view=review', '/me?view=save'])(
    'скрывает нижнюю навигацию внутри сфокусированного сценария %s',
    (path) => {
      renderLayout(path)
      expect(screen.queryByRole('navigation', { name: 'Основная навигация' })).not.toBeInTheDocument()
      expect(document.querySelector('.content')).toHaveClass('content-immersive')
    },
  )

  it('помечает live как отдельный мобильный сценарий', () => {
    renderLayout('/workouts/workout-1/live')
    expect(screen.queryByRole('navigation', { name: 'Основная навигация' })).not.toBeInTheDocument()
    expect(document.querySelector('.phone-frame')).toHaveClass('live-session-shell')
  })
})

describe('AppLayout: пилот тёмной палитры', () => {
  function enablePilotFor(userId: string) {
    vi.stubEnv('VITE_DARK_THEME_PILOT_ENABLED', 'true')
    vi.stubEnv('VITE_DARK_THEME_PILOT_USER_IDS', userId)
  }

  it('аккаунт из allowlist с тёмной темой получает пилотную палитру', () => {
    enablePilotFor('pilot-user')
    authState.userId = 'pilot-user'
    authState.theme = 'dark'
    renderLayout('/me')
    expect(document.querySelector('.phone-frame')).toHaveClass('theme-dark-pilot')
    expect(document.documentElement).toHaveClass('theme-dark-pilot')
  })

  it('аккаунт вне allowlist остаётся на прежней тёмной теме', () => {
    enablePilotFor('pilot-user')
    authState.userId = 'other-user'
    authState.theme = 'dark'
    renderLayout('/me')
    const frame = document.querySelector('.phone-frame')
    expect(frame).not.toHaveClass('theme-dark-pilot')
    expect(frame).not.toHaveClass('theme-light')
    expect(document.documentElement).not.toHaveClass('theme-dark-pilot')
  })

  it('при выключенном флаге пилот недоступен даже аккаунту из списка', () => {
    vi.stubEnv('VITE_DARK_THEME_PILOT_ENABLED', '')
    vi.stubEnv('VITE_DARK_THEME_PILOT_USER_IDS', 'pilot-user')
    authState.userId = 'pilot-user'
    authState.theme = 'dark'
    renderLayout('/me')
    expect(document.querySelector('.phone-frame')).not.toHaveClass('theme-dark-pilot')
  })

  it('со светлой темой пилотная палитра не подменяет выбор пользователя', () => {
    enablePilotFor('pilot-user')
    authState.userId = 'pilot-user'
    authState.theme = 'light'
    renderLayout('/me')
    const frame = document.querySelector('.phone-frame')
    expect(frame).toHaveClass('theme-light')
    expect(frame).not.toHaveClass('theme-dark-pilot')
    expect(document.documentElement).toHaveClass('theme-light')
  })
})

describe('AppLayout: пилот вкладки ассистента', () => {
  it('тренер из allowlist видит «Ассистент» в существующем нижнем таб-баре', () => {
    vi.stubEnv('VITE_ASSISTANT_NAV_ENABLED', 'true')
    vi.stubEnv('VITE_ASSISTANT_NAV_PILOT_USER_IDS', 'pilot-trainer')
    authState.role = 'trainer'
    authState.userId = 'pilot-trainer'
    renderLayout('/today')
    const navigation = screen.getByRole('navigation', { name: 'Основная навигация' })
    const links = within(navigation).getAllByRole('link')
    expect(links.map((link) => link.textContent)).toEqual(['Сегодня', 'Клиенты', 'Ассистент', 'Расписание'])
    expect(within(navigation).getByRole('link', { name: 'Ассистент' })).toHaveAttribute('href', '/assistant')
    expect(iconName(within(navigation).getByRole('link', { name: 'Ассистент' }))).toBe('assistant')
  })

  it('в live-режиме нижний таб-бар пилота скрыт', () => {
    vi.stubEnv('VITE_ASSISTANT_NAV_ENABLED', 'true')
    vi.stubEnv('VITE_ASSISTANT_NAV_PILOT_USER_IDS', 'pilot-trainer')
    authState.role = 'trainer'
    authState.userId = 'pilot-trainer'
    renderLayout('/workouts/w-1/live')
    expect(screen.queryByRole('navigation', { name: 'Основная навигация' })).toBeNull()
  })

  it('тренер вне allowlist получает прежнюю нижнюю навигацию без ассистента', () => {
    vi.stubEnv('VITE_ASSISTANT_NAV_ENABLED', 'true')
    vi.stubEnv('VITE_ASSISTANT_NAV_PILOT_USER_IDS', 'pilot-trainer')
    authState.role = 'trainer'
    authState.userId = 'other-trainer'
    renderLayout('/today')
    const navigation = screen.getByRole('navigation', { name: 'Основная навигация' })
    expect(within(navigation).getAllByRole('link').map((link) => link.textContent)).toEqual(['Сегодня', 'Клиенты', 'Расписание'])
    expect(within(navigation).queryByRole('link', { name: 'Ассистент' })).toBeNull()
  })

  it('клиент не получает trainer-only вкладку ассистента', () => {
    vi.stubEnv('VITE_ASSISTANT_NAV_ENABLED', 'true')
    vi.stubEnv('VITE_ASSISTANT_NAV_PILOT_USER_IDS', 'pilot-client')
    authState.role = 'client'
    authState.userId = 'pilot-client'
    renderLayout('/me')
    const navigation = screen.getByRole('navigation', { name: 'Основная навигация' })
    expect(within(navigation).getByRole('link', { name: 'Кабинет' })).toBeInTheDocument()
    expect(within(navigation).queryByRole('link', { name: 'Ассистент' })).toBeNull()
  })
})
