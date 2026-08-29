import { render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppLayout, appViewportMetrics } from './AppLayout'

const authState = vi.hoisted(() => ({
  role: 'client' as 'client' | 'trainer',
  userId: 'user-1',
  theme: 'light' as 'light' | 'dark',
  monochromePreview: false,
}))

vi.mock('./auth-context', () => ({
  useAuth: () => ({ actor: {
    role: authState.role,
    userId: authState.userId,
    featureFlags: { monochromePreview: authState.monochromePreview },
  } }),
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

beforeEach(() => {
  // Большинство route-scope тестов проверяют прежний персональный контракт.
  // Production default ON покрывается отдельной rollout-группой ниже.
  vi.stubEnv('VITE_MONOCHROME_ROLLOUT_MODE', 'preview')
})

afterEach(() => {
  authState.role = 'client'
  authState.userId = 'user-1'
  authState.theme = 'light'
  authState.monochromePreview = false
  vi.unstubAllEnvs()
  document.documentElement.className = ''
})

describe('AppLayout: monochrome preview route scope', () => {
  it('applies the identity only to Client Home for an enabled session', () => {
    authState.monochromePreview = true
    renderLayout('/me')

    expect(document.querySelector('.phone-frame')).toHaveClass('identity-monochrome-preview', 'client-home-identity')
    expect(document.documentElement).toHaveClass('identity-monochrome-preview')
  })

  it('keeps Client Home unchanged when the server flag is off', () => {
    renderLayout('/me')

    expect(document.querySelector('.phone-frame')).not.toHaveClass('identity-monochrome-preview')
    expect(document.documentElement).not.toHaveClass('identity-monochrome-preview')
  })

  it.each(['client', 'trainer'] as const)('applies the Live identity to an enabled %s session', (role) => {
    authState.role = role
    authState.monochromePreview = true
    renderLayout('/workouts/workout-1/live')

    expect(document.querySelector('.phone-frame')).toHaveClass('identity-monochrome-preview', 'live-identity', 'live-session-shell')
    expect(document.documentElement).toHaveClass('identity-monochrome-preview')
  })

  it('keeps Live unchanged when the server flag is off', () => {
    renderLayout('/workouts/workout-1/live')

    expect(document.querySelector('.phone-frame')).toHaveClass('live-session-shell')
    expect(document.querySelector('.phone-frame')).not.toHaveClass('identity-monochrome-preview', 'live-identity')
    expect(document.documentElement).not.toHaveClass('identity-monochrome-preview')
  })

  it('applies the Progress identity only to an enabled client route', () => {
    authState.role = 'client'
    authState.monochromePreview = true
    renderLayout('/me/progress')

    expect(document.querySelector('.phone-frame')).toHaveClass('identity-monochrome-preview', 'progress-identity')
    expect(document.querySelector('.phone-frame')).not.toHaveClass('client-home-identity', 'live-identity')
    expect(document.documentElement).toHaveClass('identity-monochrome-preview')
  })

  it('keeps Progress unchanged when the server flag is off', () => {
    authState.role = 'client'
    renderLayout('/me/progress')

    expect(document.querySelector('.phone-frame')).not.toHaveClass('identity-monochrome-preview', 'progress-identity')
    expect(document.documentElement).not.toHaveClass('identity-monochrome-preview')
  })

  it('applies the My Workouts identity only to the enabled list route', () => {
    authState.role = 'client'
    authState.monochromePreview = true
    renderLayout('/me/workouts')

    expect(document.querySelector('.phone-frame')).toHaveClass('identity-monochrome-preview', 'client-workouts-identity')
    expect(document.querySelector('.phone-frame')).not.toHaveClass('client-home-identity', 'live-identity', 'progress-identity')
    expect(document.documentElement).toHaveClass('identity-monochrome-preview')
  })

  it('keeps My Workouts unchanged when the server flag is off', () => {
    authState.role = 'client'
    renderLayout('/me/workouts')

    expect(document.querySelector('.phone-frame')).not.toHaveClass('identity-monochrome-preview', 'client-workouts-identity')
    expect(document.documentElement).not.toHaveClass('identity-monochrome-preview')
  })

  it('applies the Client Profile identity only to the enabled route', () => {
    authState.role = 'client'
    authState.monochromePreview = true
    renderLayout('/me/profile')

    expect(document.querySelector('.phone-frame')).toHaveClass('identity-monochrome-preview', 'client-profile-shell-identity')
    expect(document.querySelector('.phone-frame')).not.toHaveClass('client-home-identity', 'live-identity', 'progress-identity', 'client-workouts-identity')
    expect(document.documentElement).toHaveClass('identity-monochrome-preview')
  })

  it('keeps Client Profile unchanged when the server flag is off', () => {
    authState.role = 'client'
    renderLayout('/me/profile')

    expect(document.querySelector('.phone-frame')).not.toHaveClass('identity-monochrome-preview', 'client-profile-shell-identity')
    expect(document.documentElement).not.toHaveClass('identity-monochrome-preview')
  })

  it('applies the Client Card Edit identity only to the enabled self-edit route', () => {
    authState.role = 'client'
    authState.monochromePreview = true
    renderLayout('/me/edit')

    expect(document.querySelector('.phone-frame')).toHaveClass('identity-monochrome-preview', 'client-card-edit-identity')
    expect(document.querySelector('.phone-frame')).not.toHaveClass('client-home-identity', 'client-profile-shell-identity')
    expect(document.documentElement).toHaveClass('identity-monochrome-preview')
  })

  it('keeps Client Card Edit unchanged when the server flag is off', () => {
    authState.role = 'client'
    renderLayout('/me/edit')

    expect(document.querySelector('.phone-frame')).not.toHaveClass('identity-monochrome-preview', 'client-card-edit-identity')
    expect(document.documentElement).not.toHaveClass('identity-monochrome-preview')
  })

  it.each(['/workouts/new', '/workouts/workout-1/edit', '/today?view=review', '/me?view=save'])(
    'applies the Workout Create/Edit identity to the enabled route %s',
    (path) => {
      authState.monochromePreview = true
      renderLayout(path)

      expect(document.querySelector('.phone-frame')).toHaveClass('identity-monochrome-preview', 'workout-create-edit-identity')
      expect(document.querySelector('.phone-frame')).not.toHaveClass('client-home-identity', 'workout-detail-history-identity')
      expect(document.documentElement).toHaveClass('identity-monochrome-preview')
    },
  )

  it.each(['/workouts/new', '/workouts/workout-1/edit', '/today?view=review', '/me?view=save'])(
    'keeps Workout Create/Edit unchanged when the server flag is off on %s',
    (path) => {
      renderLayout(path)

      expect(document.querySelector('.phone-frame')).not.toHaveClass('identity-monochrome-preview', 'workout-create-edit-identity')
      expect(document.documentElement).not.toHaveClass('identity-monochrome-preview')
    },
  )

  it.each(['/workouts/workout-1', '/workouts/workout-1/history/bench-press'])(
    'applies the Workout Detail/History identity to the enabled route %s',
    (path) => {
      authState.monochromePreview = true
      renderLayout(path)

      expect(document.querySelector('.phone-frame')).toHaveClass('identity-monochrome-preview', 'workout-detail-history-identity')
      expect(document.querySelector('.phone-frame')).not.toHaveClass('workout-create-edit-identity', 'live-identity')
      expect(document.documentElement).toHaveClass('identity-monochrome-preview')
    },
  )

  it.each(['/workouts/workout-1', '/workouts/workout-1/history/bench-press'])(
    'keeps Workout Detail/History unchanged when the server flag is off on %s',
    (path) => {
      renderLayout(path)

      expect(document.querySelector('.phone-frame')).not.toHaveClass('identity-monochrome-preview', 'workout-detail-history-identity')
      expect(document.documentElement).not.toHaveClass('identity-monochrome-preview')
    },
  )

  it('applies Trainer Today identity only to the enabled compose route', () => {
    authState.role = 'trainer'
    authState.monochromePreview = true
    renderLayout('/today')

    expect(document.querySelector('.phone-frame')).toHaveClass('identity-monochrome-preview', 'trainer-today-identity')
    expect(document.querySelector('.phone-frame')).not.toHaveClass('workout-create-edit-identity', 'client-home-identity')
    expect(document.documentElement).toHaveClass('identity-monochrome-preview')
  })

  it('keeps Trainer Today unchanged when the server flag is off', () => {
    authState.role = 'trainer'
    renderLayout('/today')

    expect(document.querySelector('.phone-frame')).not.toHaveClass('identity-monochrome-preview', 'trainer-today-identity')
    expect(document.documentElement).not.toHaveClass('identity-monochrome-preview')
  })

  it.each(['/today?view=review', '/today?view=save'])(
    'keeps the accepted Workout Create/Edit identity isolated from Trainer Today on %s',
    (path) => {
      authState.role = 'trainer'
      authState.monochromePreview = true
      renderLayout(path)

      expect(document.querySelector('.phone-frame')).toHaveClass('identity-monochrome-preview', 'workout-create-edit-identity')
      expect(document.querySelector('.phone-frame')).not.toHaveClass('trainer-today-identity')
    },
  )

  it('applies Trainer Clients identity only to the enabled list route', () => {
    authState.role = 'trainer'
    authState.monochromePreview = true
    renderLayout('/clients')

    expect(document.querySelector('.phone-frame')).toHaveClass('identity-monochrome-preview', 'trainer-clients-identity')
    expect(document.querySelector('.phone-frame')).not.toHaveClass('trainer-today-identity')
  })

  it('keeps Trainer Clients unchanged when the server flag is off', () => {
    authState.role = 'trainer'
    renderLayout('/clients')

    expect(document.querySelector('.phone-frame')).not.toHaveClass('identity-monochrome-preview', 'trainer-clients-identity')
    expect(document.documentElement).not.toHaveClass('identity-monochrome-preview')
  })

  it.each(['/clients/new', '/clients/client-1', '/clients/client-1/edit'])(
    'does not leak Trainer Clients list identity into %s',
    (path) => {
      authState.role = 'trainer'
      authState.monochromePreview = true
      renderLayout(path)

      expect(document.querySelector('.phone-frame')).not.toHaveClass('trainer-clients-identity')
    },
  )

  it('applies Trainer Client Detail identity only to the enabled exact detail route', () => {
    authState.role = 'trainer'
    authState.monochromePreview = true
    renderLayout('/clients/client-1')

    expect(document.querySelector('.phone-frame')).toHaveClass('identity-monochrome-preview', 'trainer-client-detail-identity')
    expect(document.querySelector('.phone-frame')).not.toHaveClass('trainer-clients-identity')
  })

  it('keeps Trainer Client Detail unchanged when the server flag is off', () => {
    authState.role = 'trainer'
    renderLayout('/clients/client-1')

    expect(document.querySelector('.phone-frame')).not.toHaveClass('identity-monochrome-preview', 'trainer-client-detail-identity')
  })

  it.each(['/clients/new', '/clients/client-1/edit', '/clients/client-1/goal', '/clients/client-1/workouts'])(
    'does not leak Trainer Client Detail identity into %s',
    (path) => {
      authState.role = 'trainer'
      authState.monochromePreview = true
      renderLayout(path)

      expect(document.querySelector('.phone-frame')).not.toHaveClass('trainer-client-detail-identity')
    },
  )

  it.each(['/clients/new', '/clients/client-1/edit'])(
    'applies Trainer Client Form identity to the enabled route %s',
    (path) => {
      authState.role = 'trainer'
      authState.monochromePreview = true
      renderLayout(path)

      expect(document.querySelector('.phone-frame')).toHaveClass('identity-monochrome-preview', 'trainer-client-form-identity')
      expect(document.querySelector('.phone-frame')).not.toHaveClass('trainer-client-detail-identity', 'trainer-clients-identity')
    },
  )

  it.each(['/clients/new', '/clients/client-1/edit'])(
    'keeps Trainer Client Form unchanged when the flag is off on %s',
    (path) => {
      authState.role = 'trainer'
      renderLayout(path)

      expect(document.querySelector('.phone-frame')).not.toHaveClass('identity-monochrome-preview', 'trainer-client-form-identity')
    },
  )

  it.each(['/clients', '/clients/client-1', '/clients/client-1/goal', '/clients/client-1/workouts'])(
    'does not leak Trainer Client Form identity into %s',
    (path) => {
      authState.role = 'trainer'
      authState.monochromePreview = true
      renderLayout(path)

      expect(document.querySelector('.phone-frame')).not.toHaveClass('trainer-client-form-identity')
    },
  )

  it('applies Trainer Client Goal identity only to the enabled exact goal route', () => {
    authState.role = 'trainer'
    authState.monochromePreview = true
    renderLayout('/clients/client-1/goal')

    expect(document.querySelector('.phone-frame')).toHaveClass('identity-monochrome-preview', 'trainer-client-goal-identity')
    expect(document.querySelector('.phone-frame')).not.toHaveClass('trainer-client-detail-identity', 'trainer-client-form-identity', 'trainer-clients-identity')
  })

  it('keeps Trainer Client Goal unchanged when the server flag is off', () => {
    authState.role = 'trainer'
    renderLayout('/clients/client-1/goal')

    expect(document.querySelector('.phone-frame')).not.toHaveClass('identity-monochrome-preview', 'trainer-client-goal-identity')
    expect(document.documentElement).not.toHaveClass('identity-monochrome-preview')
  })

  it.each(['/clients', '/clients/new', '/clients/client-1', '/clients/client-1/edit', '/clients/client-1/workouts', '/clients/client-1/progress'])(
    'does not leak Trainer Client Goal identity into %s',
    (path) => {
      authState.role = 'trainer'
      authState.monochromePreview = true
      renderLayout(path)

      expect(document.querySelector('.phone-frame')).not.toHaveClass('trainer-client-goal-identity')
    },
  )

  it('applies Trainer Schedule identity only to the enabled exact schedule route', () => {
    authState.role = 'trainer'
    authState.monochromePreview = true
    renderLayout('/schedule')

    expect(document.querySelector('.phone-frame')).toHaveClass('identity-monochrome-preview', 'trainer-schedule-identity')
    expect(document.querySelector('.phone-frame')).not.toHaveClass('trainer-today-identity', 'trainer-clients-identity')
  })

  it('keeps Trainer Schedule unchanged when the server flag is off', () => {
    authState.role = 'trainer'
    renderLayout('/schedule')

    expect(document.querySelector('.phone-frame')).not.toHaveClass('identity-monochrome-preview', 'trainer-schedule-identity')
    expect(document.documentElement).not.toHaveClass('identity-monochrome-preview')
  })

  it.each(['/today', '/clients', '/profile', '/exercises', '/progress/client-1', '/workouts/new'])(
    'does not leak Trainer Schedule identity into %s',
    (path) => {
      authState.role = 'trainer'
      authState.monochromePreview = true
      renderLayout(path)

      expect(document.querySelector('.phone-frame')).not.toHaveClass('trainer-schedule-identity')
    },
  )

  it.each(['/progress/client-1', '/progress/client-1?view=running', '/progress/client-1?view=measurements'])(
    'applies Trainer Progress identity to the enabled route state %s',
    (path) => {
      authState.role = 'trainer'
      authState.monochromePreview = true
      renderLayout(path)

      expect(document.querySelector('.phone-frame')).toHaveClass('identity-monochrome-preview', 'trainer-progress-identity')
      expect(document.querySelector('.phone-frame')).not.toHaveClass('progress-identity', 'trainer-schedule-identity')
    },
  )

  it('keeps Trainer Progress unchanged when the server flag is off', () => {
    authState.role = 'trainer'
    renderLayout('/progress/client-1')

    expect(document.querySelector('.phone-frame')).not.toHaveClass('identity-monochrome-preview', 'trainer-progress-identity')
    expect(document.documentElement).not.toHaveClass('identity-monochrome-preview')
  })

  it.each(['/today', '/clients', '/schedule', '/profile', '/exercises', '/clients/client-1', '/workouts/new', '/me/progress'])(
    'does not leak Trainer Progress identity into %s',
    (path) => {
      authState.role = 'trainer'
      authState.monochromePreview = true
      renderLayout(path)

      expect(document.querySelector('.phone-frame')).not.toHaveClass('trainer-progress-identity')
    },
  )

  it('applies Exercise Catalog identity only to the enabled trainer route', () => {
    authState.role = 'trainer'
    authState.monochromePreview = true
    renderLayout('/exercises')

    expect(document.querySelector('.phone-frame')).toHaveClass('identity-monochrome-preview', 'exercise-catalog-identity')
    expect(document.querySelector('.phone-frame')).not.toHaveClass('trainer-progress-identity', 'trainer-schedule-identity')
  })

  it('keeps Exercise Catalog unchanged when the server flag is off', () => {
    authState.role = 'trainer'
    renderLayout('/exercises')

    expect(document.querySelector('.phone-frame')).not.toHaveClass('identity-monochrome-preview', 'exercise-catalog-identity')
    expect(document.documentElement).not.toHaveClass('identity-monochrome-preview')
  })

  it.each(['/today', '/clients', '/schedule', '/profile', '/progress/client-1', '/workouts/new', '/me/progress'])(
    'does not leak Exercise Catalog identity into %s',
    (path) => {
      authState.role = 'trainer'
      authState.monochromePreview = true
      renderLayout(path)

      expect(document.querySelector('.phone-frame')).not.toHaveClass('exercise-catalog-identity')
    },
  )

  it('applies Trainer Profile identity only to the enabled trainer route', () => {
    authState.role = 'trainer'
    authState.monochromePreview = true
    renderLayout('/profile')

    expect(document.querySelector('.phone-frame')).toHaveClass('identity-monochrome-preview', 'trainer-profile-identity')
    expect(document.querySelector('.phone-frame')).not.toHaveClass('exercise-catalog-identity', 'client-profile-shell-identity')
  })

  it('keeps Trainer Profile unchanged when the server flag is off', () => {
    authState.role = 'trainer'
    renderLayout('/profile')

    expect(document.querySelector('.phone-frame')).not.toHaveClass('identity-monochrome-preview', 'trainer-profile-identity')
    expect(document.documentElement).not.toHaveClass('identity-monochrome-preview')
  })

  it('does not apply Trainer Profile identity to the client profile route', () => {
    authState.role = 'client'
    authState.monochromePreview = true
    renderLayout('/me/profile')

    expect(document.querySelector('.phone-frame')).toHaveClass('client-profile-shell-identity')
    expect(document.querySelector('.phone-frame')).not.toHaveClass('trainer-profile-identity')
  })

  it.each(['/today', '/clients', '/schedule', '/exercises', '/progress/client-1', '/join', '/workouts/new'])(
    'does not leak Trainer Profile identity into %s',
    (path) => {
      authState.role = 'trainer'
      authState.monochromePreview = true
      renderLayout(path)

      expect(document.querySelector('.phone-frame')).not.toHaveClass('trainer-profile-identity')
    },
  )
})

describe('AppLayout: global monochrome rollout', () => {
  it('enables a migrated route for every user in production mode', () => {
    vi.stubEnv('VITE_MONOCHROME_ROLLOUT_MODE', 'on')
    authState.monochromePreview = false
    renderLayout('/me')

    expect(document.querySelector('.phone-frame')).toHaveClass('identity-monochrome-preview', 'client-home-identity')
  })

  it('uses one global off switch even when personal preview is enabled', () => {
    vi.stubEnv('VITE_MONOCHROME_ROLLOUT_MODE', 'off')
    authState.monochromePreview = true
    renderLayout('/me')

    expect(document.querySelector('.phone-frame')).not.toHaveClass('identity-monochrome-preview', 'client-home-identity')
  })

  it('keeps accepted monochrome dark independent from the old purple pilot', () => {
    vi.stubEnv('VITE_MONOCHROME_ROLLOUT_MODE', 'on')
    vi.stubEnv('VITE_DARK_THEME_PILOT_ENABLED', 'true')
    vi.stubEnv('VITE_DARK_THEME_PILOT_USER_IDS', 'user-1')
    authState.theme = 'dark'
    renderLayout('/me')

    expect(document.querySelector('.phone-frame')).toHaveClass('identity-monochrome-preview')
    expect(document.querySelector('.phone-frame')).not.toHaveClass('theme-dark-pilot')
    expect(document.documentElement).not.toHaveClass('theme-dark-pilot')
  })

  it('migrates Join as an exact auth route without leaking into other routes', () => {
    vi.stubEnv('VITE_MONOCHROME_ROLLOUT_MODE', 'on')
    const join = renderLayout('/join')
    expect(document.querySelector('.phone-frame')).toHaveClass('identity-monochrome-preview', 'auth-join-identity')

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

  it('помечает ассистента как отдельную viewport-оболочку', () => {
    authState.role = 'trainer'
    renderLayout('/assistant')
    expect(document.querySelector('.phone-frame')).toHaveClass('assistant-shell')
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
