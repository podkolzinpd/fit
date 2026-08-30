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
  useAuth: () => ({ actor: {
    role: authState.role,
    userId: authState.userId,
  } }),
}))

vi.mock('./theme', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./theme')>()),
  useAppTheme: () => authState.theme,
}))

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

describe('AppLayout: единственная UI Identity', () => {
  it.each([
    ['client', '/me', 'client-home-identity'],
    ['client', '/me/progress', 'progress-identity'],
    ['client', '/me/workouts', 'client-workouts-identity'],
    ['client', '/me/profile', 'client-profile-shell-identity'],
    ['client', '/me/edit', 'client-card-edit-identity'],
    ['client', '/me/goal', 'client-goal-identity'],
    ['trainer', '/today', 'trainer-today-identity'],
    ['trainer', '/clients', 'trainer-clients-identity'],
    ['trainer', '/clients/client-1', 'trainer-client-detail-identity'],
    ['trainer', '/clients/new', 'trainer-client-form-identity'],
    ['trainer', '/clients/client-1/edit', 'trainer-client-form-identity'],
    ['trainer', '/clients/client-1/goal', 'trainer-client-goal-identity'],
    ['trainer', '/clients/client-1/workouts', 'client-workouts-identity'],
    ['trainer', '/schedule', 'trainer-schedule-identity'],
    ['trainer', '/progress/client-1', 'trainer-progress-identity'],
    ['trainer', '/exercises', 'exercise-catalog-identity'],
    ['trainer', '/profile', 'trainer-profile-identity'],
    ['trainer', '/assistant', 'assistant-identity'],
  ] as const)('применяет identity для %s %s', (role, path, routeClass) => {
    authState.role = role
    renderLayout(path)

    expect(document.querySelector('.phone-frame')).toHaveClass('ui-identity', routeClass)
    expect(document.documentElement).toHaveClass('ui-identity')
  })

  it.each(['client', 'trainer'] as const)('применяет Live identity для %s', (role) => {
    authState.role = role
    renderLayout('/workouts/workout-1/live')

    expect(document.querySelector('.phone-frame')).toHaveClass('ui-identity', 'live-identity', 'live-session-shell')
  })

  it.each(['/workouts/new', '/workouts/workout-1/edit', '/today?view=review', '/me?view=save'])(
    'применяет Workout Create/Edit identity к %s',
    (path) => {
      renderLayout(path)
      expect(document.querySelector('.phone-frame')).toHaveClass('workout-create-edit-identity')
      expect(document.querySelector('.phone-frame')).not.toHaveClass('workout-detail-history-identity')
    },
  )

  it.each(['/workouts/workout-1', '/workouts/workout-1/history/bench-press'])(
    'применяет Workout Detail/History identity к %s',
    (path) => {
      renderLayout(path)
      expect(document.querySelector('.phone-frame')).toHaveClass('workout-detail-history-identity')
      expect(document.querySelector('.phone-frame')).not.toHaveClass('workout-create-edit-identity', 'live-identity')
    },
  )

  it('применяет принятую тёмную тему в единственной identity', () => {
    authState.theme = 'dark'
    renderLayout('/me')

    const frame = document.querySelector('.phone-frame')
    expect(frame).toHaveClass('ui-identity')
    expect(frame).not.toHaveClass('theme-light')
    expect(document.documentElement).toHaveClass('ui-identity')
  })

  it('ограничивает Join точным маршрутом', () => {
    const join = renderLayout('/join')
    expect(document.querySelector('.phone-frame')).toHaveClass('auth-join-identity')

    join.unmount()
    renderLayout('/assistant')
    expect(document.querySelectorAll('.auth-join-identity')).toHaveLength(0)
  })
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

  it.each(['/workouts/new', '/workouts/workout-1/edit', '/today?view=review', '/me?view=save', '/workouts/w-1/live'])(
    'скрывает нижнюю навигацию внутри сфокусированного сценария %s',
    (path) => {
      renderLayout(path)
      expect(screen.queryByRole('navigation', { name: 'Основная навигация' })).not.toBeInTheDocument()
      expect(document.querySelector('.content')).toHaveClass('content-immersive')
    },
  )
})

describe('AppLayout: пилот вкладки ассистента', () => {
  it('тренер из allowlist видит «Ассистент» в существующем нижнем таб-баре', () => {
    vi.stubEnv('VITE_ASSISTANT_NAV_ENABLED', 'true')
    vi.stubEnv('VITE_ASSISTANT_NAV_PILOT_USER_IDS', 'pilot-trainer')
    authState.role = 'trainer'
    authState.userId = 'pilot-trainer'
    renderLayout('/today')
    const navigation = screen.getByRole('navigation', { name: 'Основная навигация' })
    expect(within(navigation).getAllByRole('link').map((link) => link.textContent)).toEqual(['Сегодня', 'Клиенты', 'Ассистент', 'Расписание'])
    expect(iconName(within(navigation).getByRole('link', { name: 'Ассистент' }))).toBe('assistant')
  })

  it('не показывает trainer-only вкладку клиенту', () => {
    vi.stubEnv('VITE_ASSISTANT_NAV_ENABLED', 'true')
    vi.stubEnv('VITE_ASSISTANT_NAV_PILOT_USER_IDS', 'pilot-client')
    authState.userId = 'pilot-client'
    renderLayout('/me')
    const navigation = screen.getByRole('navigation', { name: 'Основная навигация' })
    expect(within(navigation).queryByRole('link', { name: 'Ассистент' })).toBeNull()
  })
})
