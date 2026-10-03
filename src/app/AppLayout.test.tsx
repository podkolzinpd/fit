import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppLayout, appViewportMetrics } from './AppLayout'

const authState = vi.hoisted(() => ({
  role: 'client' as 'client' | 'trainer',
  userId: 'user-1',
  theme: 'light' as 'light' | 'dark',
  trainerScheduleV2: false,
  fitLime: false,
}))

vi.mock('./auth-context', () => ({
  useAuth: () => ({ actor: {
    role: authState.role,
    userId: authState.userId,
    experiments: { trainerScheduleV2: authState.trainerScheduleV2, fitLime: authState.fitLime },
  } }),
}))

vi.mock('./data-backend-context', () => ({
  useDataBackend: () => ({ appFeedback: { submit: vi.fn() } }),
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

function ProgressQueryControl() {
  const navigate = useNavigate()
  const location = useLocation()
  return <><button type="button" onClick={() => navigate('/me/progress?mapZone=chest', { replace: true, preventScrollReset: true })}>Выбрать мышцу</button><output>{location.search}</output></>
}

function renderProgressQueryControl() {
  return render(<MemoryRouter initialEntries={['/me/progress']}>
    <Routes><Route element={<AppLayout />}><Route path="*" element={<ProgressQueryControl />} /></Route></Routes>
  </MemoryRouter>)
}

function iconName(link: HTMLElement) {
  return link.querySelector('svg')?.getAttribute('data-icon')
}

afterEach(() => {
  authState.role = 'client'
  authState.userId = 'user-1'
  authState.theme = 'light'
  authState.trainerScheduleV2 = false
  authState.fitLime = false
  vi.unstubAllEnvs()
  document.documentElement.className = ''
  document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')?.remove()
})

describe('AppLayout: единственная UI Identity', () => {
  it.each([
    ['client', '/me', 'client-home-identity'],
    ['client', '/me/progress', 'progress-identity'],
    ['client', '/me/workouts', 'client-workouts-identity'],
    ['client', '/me/profile', 'client-profile-shell-identity'],
    ['client', '/me/settings', 'client-profile-shell-identity'],
    ['client', '/me/edit', 'client-card-edit-identity'],
    ['client', '/me/goal', 'client-goal-identity'],
    ['client', '/me/finance', 'client-finance-identity'],
    ['trainer', '/today', 'trainer-today-identity'],
    ['trainer', '/clients', 'trainer-clients-identity'],
    ['trainer', '/clients/archive', 'trainer-clients-identity'],
    ['trainer', '/clients/client-1', 'trainer-client-detail-identity'],
    ['trainer', '/finance', 'trainer-finance-identity'],
    ['trainer', '/clients/client-1/finance', 'trainer-finance-identity'],
    ['trainer', '/clients/new', 'trainer-client-form-identity'],
    ['trainer', '/clients/client-1/edit', 'trainer-client-form-identity'],
    ['trainer', '/clients/client-1/goal', 'trainer-client-goal-identity'],
    ['trainer', '/clients/client-1/workouts', 'client-workouts-identity'],
    ['trainer', '/schedule', 'trainer-schedule-identity'],
    ['trainer', '/progress/client-1', 'trainer-progress-identity'],
    ['trainer', '/exercises', 'exercise-catalog-identity'],
    ['trainer', '/profile', 'trainer-profile-identity'],
    ['trainer', '/profile/settings', 'trainer-profile-identity'],
    ['trainer', '/profile/trainer', 'trainer-profile-identity'],
    ['client', '/assistant', 'assistant-identity'],
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

  it('применяет тёмную системную область только к Schedule V2 пилотного тренера', () => {
    const meta = document.createElement('meta')
    meta.name = 'apple-mobile-web-app-status-bar-style'
    meta.content = 'default'
    document.head.append(meta)
    authState.role = 'trainer'
    authState.trainerScheduleV2 = true

    const layout = renderLayout('/schedule')
    expect(document.documentElement).toHaveClass('schedule-v2-document')
    expect(meta).toHaveAttribute('content', 'black-translucent')

    layout.unmount()
    expect(document.documentElement).not.toHaveClass('schedule-v2-document')
    expect(meta).toHaveAttribute('content', 'default')
  })

  it('применяет Fit Lime до первого кадра только к согласованному календарю', () => {
    const meta = document.createElement('meta')
    meta.name = 'theme-color'
    meta.content = '#FBFAF7'
    document.head.append(meta)
    authState.role = 'trainer'
    authState.trainerScheduleV2 = true
    authState.fitLime = true

    const layout = renderLayout('/today?date=2026-09-25')
    expect(document.querySelector('.phone-frame')).toHaveClass('fit-lime-shell', 'fit-lime')
    expect(document.querySelector('.phone-frame')).not.toHaveClass('theme-light')
    expect(document.documentElement).toHaveClass('fit-lime-document')
    expect(document.documentElement).not.toHaveClass('theme-light')
    expect(meta).toHaveAttribute('content', '#000000')

    layout.unmount()
    expect(document.documentElement).not.toHaveClass('fit-lime-document')
    authState.fitLime = false
    renderLayout('/today?date=2026-09-25')
    expect(document.querySelector('.phone-frame')).not.toHaveClass('fit-lime-shell', 'fit-lime')
    expect(document.documentElement).toHaveClass('theme-light')
    meta.remove()
  })

  it('не перекрашивает неподтверждённые маршруты и шаги записи', () => {
    authState.role = 'trainer'
    authState.trainerScheduleV2 = true
    authState.fitLime = true
    const assistant = renderLayout('/assistant')
    expect(document.querySelector('.phone-frame')).toHaveClass('fit-lime-shell', 'assistant-identity')
    expect(document.documentElement).toHaveClass('fit-lime-document')
    assistant.unmount()
    const conversation = renderLayout('/chat/thread-1')
    expect(document.querySelector('.phone-frame')).toHaveClass('fit-lime-shell')
    expect(document.documentElement).toHaveClass('fit-lime-document')
    conversation.unmount()
    for (const step of ['compose', 'review', 'save']) {
      const entry = renderLayout(`/today?view=${step}`)
      expect(document.querySelector('.phone-frame')).toHaveClass('fit-lime-shell', 'workout-create-edit-identity')
      expect(document.documentElement).toHaveClass('fit-lime-document')
      entry.unmount()
    }
    const workoutForm = renderLayout('/workouts/new?client=client-1&date=2026-09-25')
    expect(document.querySelector('.phone-frame')).toHaveClass('fit-lime-shell', 'workout-create-edit-identity')
    expect(document.documentElement).toHaveClass('fit-lime-document')
    workoutForm.unmount()
    const workoutDetail = renderLayout('/workouts/workout-1?reply=1')
    expect(document.querySelector('.phone-frame')).toHaveClass('fit-lime-shell', 'workout-detail-history-identity')
    expect(document.documentElement).toHaveClass('fit-lime-document')
    workoutDetail.unmount()
    const liveWorkout = renderLayout('/workouts/workout-1/live')
    expect(document.querySelector('.phone-frame')).toHaveClass('fit-lime-shell', 'live-identity')
    expect(document.documentElement).toHaveClass('fit-lime-document')
    liveWorkout.unmount()
    const exerciseHistory = renderLayout('/workouts/workout-1/history/exercise-1')
    expect(document.querySelector('.phone-frame')).toHaveClass('fit-lime-shell', 'workout-detail-history-identity')
    expect(document.documentElement).toHaveClass('fit-lime-document')
    exerciseHistory.unmount()
    const clients = renderLayout('/clients/archive')
    expect(document.querySelector('.phone-frame')).toHaveClass('fit-lime-shell')
    expect(document.documentElement).toHaveClass('fit-lime-document')
    clients.unmount()
    const detail = renderLayout('/clients/client-1')
    expect(document.querySelector('.phone-frame')).toHaveClass('fit-lime-shell')
    expect(document.documentElement).toHaveClass('fit-lime-document')
    detail.unmount()
    for (const route of ['/clients/new', '/clients/client-1/edit', '/clients/client-1/goal', '/clients/client-1/workouts', '/progress/client-1?view=measurements', '/join']) {
      const layout = renderLayout(route)
      expect(document.querySelector('.phone-frame')).toHaveClass('fit-lime-shell')
      expect(document.documentElement).toHaveClass('fit-lime-document')
      layout.unmount()
    }
  })
})

describe('AppLayout navigation', () => {
  it.each(['/finance', '/clients/client-1/finance'])('сохраняет вкладку клиентов активной на финансовом маршруте %s', (route) => {
    authState.role = 'trainer'
    authState.trainerScheduleV2 = true
    renderLayout(route)

    const clients = screen.getByRole('navigation', { name: 'Основная навигация' }).querySelector('a[href="/clients"]')
    expect(clients).toHaveClass('active')
    expect(clients).toHaveAttribute('aria-current', 'page')
  })

  it('сохраняет активной вкладку клиентов на прогрессе только у Fit Lime тренера', () => {
    authState.role = 'trainer'
    authState.trainerScheduleV2 = true
    authState.fitLime = true
    const pilot = renderLayout('/progress/client-1?view=measurements')
    const clients = screen.getByRole('navigation', { name: 'Основная навигация' }).querySelector('a[href="/clients"]')
    expect(clients).toHaveClass('active')
    expect(clients).toHaveAttribute('aria-current', 'page')
    pilot.unmount()
    authState.fitLime = false
    renderLayout('/progress/client-1')
    expect(screen.getByRole('navigation', { name: 'Основная навигация' }).querySelector('a[href="/clients"]')).not.toHaveClass('active')
  })

  it('сохраняет порядок и активную вкладку пилотного тренера на обычных маршрутах', () => {
    vi.stubEnv('VITE_ASSISTANT_NAV_ENABLED', 'true')
    vi.stubEnv('VITE_ASSISTANT_NAV_PILOT_USER_IDS', 'pilot-trainer')
    authState.role = 'trainer'
    authState.userId = 'pilot-trainer'
    authState.trainerScheduleV2 = true
    for (const [route, active] of [
      ['/today?date=2026-09-24', 'Сегодня'],
      ['/schedule?week=2026-09-21', 'Расписание'],
      ['/clients', 'Клиенты'],
      ['/assistant', 'Ассистент'],
      ['/profile', null],
    ] as const) {
      const layout = renderLayout(route)
      const navigation = screen.getByRole('navigation', { name: 'Основная навигация' })
      const links = within(navigation).getAllByRole('link')
      expect(links.map((link) => link.textContent)).toEqual(['Сегодня', 'Расписание', 'Клиенты', 'Ассистент'])
      expect(links.filter((link) => link.getAttribute('aria-current') === 'page').map((link) => link.textContent)).toEqual(active ? [active] : [])
      layout.unmount()
    }
  })

  it('называет календарь Днём только при обоих флагах тренера', () => {
    authState.role = 'trainer'
    authState.trainerScheduleV2 = true
    authState.fitLime = true
    const lime = renderLayout('/today?date=2026-09-24')
    expect(screen.getByRole('link', { name: 'День' })).toHaveAttribute('aria-current', 'page')
    lime.unmount()
    authState.fitLime = false
    renderLayout('/today')
    expect(screen.getByRole('link', { name: 'Сегодня' })).toBeVisible()
    expect(screen.queryByRole('link', { name: 'День' })).not.toBeInTheDocument()
  })

  it('оставляет навигацию на вложенных экранах и скрывает её в полноэкранных шагах пилота', () => {
    authState.role = 'trainer'
    authState.trainerScheduleV2 = true
    for (const route of ['/clients/client-1', '/workouts/workout-1', '/profile']) {
      const layout = renderLayout(route)
      expect(screen.getByRole('navigation', { name: 'Основная навигация' })).toBeVisible()
      layout.unmount()
    }
    for (const route of ['/workouts/new', '/today?view=review', '/today?view=save', '/workouts/workout-1/live', '/chat/thread-1']) {
      const layout = renderLayout(route)
      expect(screen.queryByRole('navigation', { name: 'Основная навигация' })).not.toBeInTheDocument()
      layout.unmount()
    }
  })

  it('не сбрасывает позицию Progress при изменении параметров карты', async () => {
    renderProgressQueryControl()
    const content = document.querySelector('.content') as HTMLDivElement
    const scrollTo = vi.fn()
    Object.defineProperty(content, 'scrollTo', { configurable: true, value: scrollTo })
    await new Promise((resolve) => window.requestAnimationFrame(resolve))
    scrollTo.mockClear()

    await userEvent.setup().click(screen.getByRole('button', { name: 'Выбрать мышцу' }))
    await waitFor(() => expect(screen.getByText('?mapZone=chest')).toBeVisible())
    expect(scrollTo).not.toHaveBeenCalled()
  })

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

  it('сохраняет вкладку Кабинет активной в оплатах клиента', () => {
    renderLayout('/me/finance')
    const navigation = screen.getByRole('navigation', { name: 'Основная навигация' })
    expect(within(navigation).getByRole('link', { name: 'Кабинет' })).toHaveAttribute('aria-current', 'page')
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

describe('AppLayout: вкладка ассистента', () => {
  it('тренер из local allowlist видит вкладку и одноразовую подсказку', () => {
    vi.stubEnv('VITE_ASSISTANT_NAV_ENABLED', 'true')
    vi.stubEnv('VITE_ASSISTANT_NAV_PILOT_USER_IDS', 'pilot-trainer')
    authState.role = 'trainer'
    authState.userId = 'pilot-trainer'
    renderLayout('/today')
    const navigation = screen.getByRole('navigation', { name: 'Основная навигация' })
    expect(within(navigation).getAllByRole('link').map((link) => link.textContent)).toEqual(['Сегодня', 'Клиенты', 'Ассистент', 'Расписание'])
    expect(iconName(within(navigation).getByRole('link', { name: 'Ассистент' }))).toBe('assistant')
    expect(screen.getByRole('status')).toHaveTextContent('Ассистент теперь доступен')
  })

  it('показывает клиенту ассистента третьим пунктом того же меню', () => {
    vi.stubEnv('VITE_ASSISTANT_NAV_ENABLED', 'true')
    vi.stubEnv('VITE_ASSISTANT_NAV_PILOT_USER_IDS', 'pilot-client')
    authState.userId = 'pilot-client'
    renderLayout('/me')
    const navigation = screen.getByRole('navigation', { name: 'Основная навигация' })
    expect(within(navigation).getAllByRole('link').map((link) => link.textContent)).toEqual(['Кабинет', 'Тренировки', 'Ассистент', 'Прогресс', 'Профиль'])
    expect(iconName(within(navigation).getByRole('link', { name: 'Ассистент' }))).toBe('assistant')
    expect(screen.getByRole('status')).toHaveTextContent('Ассистент теперь доступен')
  })
})

describe('AppLayout: объявление победителю конкурса', () => {
  it('показывается только участнику пилота и не перебивает Live', () => {
    vi.stubEnv('VITE_CONTEST_WINNER_ENABLED', 'true')
    vi.stubEnv('VITE_CONTEST_WINNER_PILOT_USER_IDS', 'user-1')
    localStorage.clear()

    const home = renderLayout('/me')
    expect(screen.getByRole('dialog', { name: 'Вы выиграли персональную тренировку' })).toBeTruthy()
    home.unmount()

    const live = renderLayout('/workouts/workout-1/live')
    expect(screen.queryByRole('dialog')).toBeNull()
    live.unmount()

    authState.userId = 'user-2'
    renderLayout('/me')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('показывается тренеру из allowlist на рабочем экране', () => {
    vi.stubEnv('VITE_CONTEST_WINNER_ENABLED', 'true')
    vi.stubEnv('VITE_CONTEST_WINNER_PILOT_USER_IDS', 'user-1')
    localStorage.clear()
    authState.role = 'trainer'

    renderLayout('/today')
    expect(screen.getByRole('dialog', { name: 'Вы выиграли персональную тренировку' })).toBeTruthy()
  })
})
