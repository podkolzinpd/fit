import { useEffect, useRef } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { AnalyticsIcon, AssistantIcon, ClientsIcon, HomeIcon, ProfileIcon, ScheduleIcon, TodayIcon } from '../shared/icons'
import { useAuth } from './auth-context'
import { Coachmark } from '../shared/ui'
import { applyAppTheme, applyMonochromeThemeColor, applyThemeVariant, resolveThemeVariant, themeVariantClass, useAppTheme } from './theme'
import { isAssistantNavPilotEnabled, isTodayStartRedesignEnabled } from './feature-flags'
import { useAppViewport } from './app-viewport'
import { isTrainerScheduleV2CalendarRoute, isTrainerScheduleV2Enabled } from './trainer-schedule-v2'

export { appViewportMetrics } from './app-viewport'

export function AppLayout() {
  const { actor } = useAuth()
  const theme = useAppTheme()
  const contentRef = useRef<HTMLDivElement>(null)
  const { pathname, search } = useLocation()
  const redesignedStart = isTodayStartRedesignEnabled()
  const { keyboardOpen } = useAppViewport()
  const trainerScheduleV2 = isTrainerScheduleV2Enabled(actor)
  const trainerScheduleV2Route = trainerScheduleV2 && isTrainerScheduleV2CalendarRoute(pathname, search)
  const todayStep = (pathname === '/today' || pathname === '/me') && ['review', 'save'].includes(new URLSearchParams(search).get('view') ?? '')
  const liveSession = /\/live$/.test(pathname)
  const workoutForm = pathname === '/workouts/new' || /\/workouts\/[^/]+\/edit$/.test(pathname)
  const workoutDetail = pathname !== '/workouts/new' && /\/workouts\/[^/]+$/.test(pathname)
  const exerciseHistory = /\/workouts\/[^/]+\/history\/[^/]+$/.test(pathname)
  const monochromeClientHome = pathname === '/me' && !todayStep
  const monochromeLive = liveSession
  const monochromeProgress = pathname === '/me/progress'
  const monochromeClientGoal = pathname === '/me/goal'
  const monochromeClientWorkouts = pathname === '/me/workouts'
  const monochromeTrainerClientWorkouts = Boolean(actor?.role === 'trainer' && /^\/clients\/[^/]+\/workouts$/.test(pathname))
  const monochromeClientProfile = pathname === '/me/profile' || pathname === '/me/settings'
  const monochromeClientCardEdit = pathname === '/me/edit'
  const monochromeWorkoutCreateEdit = workoutForm || todayStep
  const monochromeWorkoutDetailHistory = workoutDetail || exerciseHistory
  const monochromeTrainerToday = Boolean(actor?.role === 'trainer' && pathname === '/today' && !todayStep)
  const monochromeTrainerClients = Boolean(actor?.role === 'trainer' && (pathname === '/clients' || pathname === '/clients/archive'))
  const monochromeTrainerClientDetail = Boolean(actor?.role === 'trainer' && /^\/clients\/[^/]+$/.test(pathname) && !['/clients/new', '/clients/archive'].includes(pathname))
  const monochromeTrainerClientForm = Boolean(actor?.role === 'trainer' && (pathname === '/clients/new' || /^\/clients\/[^/]+\/edit$/.test(pathname)))
  const monochromeTrainerClientGoal = Boolean(actor?.role === 'trainer' && /^\/clients\/[^/]+\/goal$/.test(pathname))
  const monochromeTrainerSchedule = Boolean(actor?.role === 'trainer' && pathname === '/schedule')
  const monochromeTrainerProgress = Boolean(actor?.role === 'trainer' && /^\/progress\/[^/]+$/.test(pathname))
  const monochromeExerciseCatalog = Boolean(actor?.role === 'trainer' && pathname === '/exercises')
  const monochromeTrainerProfile = Boolean(actor?.role === 'trainer' && (pathname === '/profile' || pathname === '/profile/settings'))
  const monochromeAuthJoin = pathname === '/join'
  const monochromeAssistant = pathname === '/assistant'
  const themeVariant = resolveThemeVariant(theme)
  const routeStep = todayStep
    ? search
    : monochromeTrainerProgress
      ? new URLSearchParams(search).get('view') ?? ''
      : ''

  useEffect(() => {
    // Класс живёт на <html>: фон вне рамки телефона и цвет системной панели
    // должны совпадать с палитрой внутри неё.
    applyThemeVariant(themeVariant)
    const root = document.documentElement
    root.classList.add('ui-identity')
    applyMonochromeThemeColor(theme)
    root.classList.toggle('schedule-v2-document', trainerScheduleV2Route)
    const appleStatusBar = document.querySelector<HTMLMetaElement>('meta[name="apple-mobile-web-app-status-bar-style"]')
    const previousAppleStatusBar = appleStatusBar?.content ?? 'default'
    if (trainerScheduleV2Route) {
      document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute('content', '#080908')
      appleStatusBar?.setAttribute('content', 'black-translucent')
    } else {
      appleStatusBar?.setAttribute('content', 'default')
    }
    return () => {
      root.classList.remove('schedule-v2-document')
      appleStatusBar?.setAttribute('content', previousAppleStatusBar)
      applyAppTheme(theme)
    }
  }, [theme, themeVariant, trainerScheduleV2Route])

  useEffect(() => {
    // Route content can grow again while its draft is restored. Reset on the
    // next frame so iOS scroll anchoring cannot reopen Today below its primary
    // action after a longer form or review screen.
    const clientsScrollKey = pathname === '/clients' ? 'fit.clientsListScroll'
      : pathname === '/clients/archive' ? 'fit.clientsArchiveListScroll' : null
    if (clientsScrollKey && window.sessionStorage?.getItem(clientsScrollKey)) return
    const frame = window.requestAnimationFrame(() => contentRef.current?.scrollTo(0, 0))
    return () => window.cancelAnimationFrame(frame)
  }, [pathname, routeStep])

  // Создание, проверка, редактирование и live — один сфокусированный путь
  // тренировки. Нижняя навигация возвращается на списках и после выхода из
  // сценария, но внутри не конкурирует с текущим действием.
  const assistant = pathname === '/assistant'
  const chat = pathname === '/chat' || pathname.startsWith('/chat/')
  const immersive = liveSession || workoutForm || todayStep || chat
  const contentClass = immersive ? 'content content-immersive' : 'content'

  const frameClass = [
    'phone-frame',
    themeVariantClass(themeVariant),
    redesignedStart && pathname === '/today' ? 'today-start-shell' : '',
    liveSession ? 'live-session-shell' : '',
    workoutForm ? 'workout-form-shell' : '',
    assistant ? 'assistant-shell' : '',
    'ui-identity',
    monochromeClientHome ? 'client-home-identity' : '',
    monochromeLive ? 'live-identity' : '',
    monochromeProgress ? 'progress-identity' : '',
    monochromeClientGoal ? 'trainer-client-goal-identity client-goal-identity' : '',
    monochromeClientWorkouts || monochromeTrainerClientWorkouts ? 'client-workouts-identity' : '',
    monochromeClientProfile ? 'client-profile-shell-identity' : '',
    monochromeClientCardEdit ? 'client-card-edit-identity' : '',
    monochromeWorkoutCreateEdit ? 'workout-create-edit-identity' : '',
    monochromeWorkoutDetailHistory ? 'workout-detail-history-identity' : '',
    monochromeTrainerToday && !trainerScheduleV2Route ? 'trainer-today-identity' : '',
    monochromeTrainerClients ? 'trainer-clients-identity' : '',
    monochromeTrainerClientDetail ? 'trainer-client-detail-identity' : '',
    monochromeTrainerClientForm ? 'trainer-client-form-identity' : '',
    monochromeTrainerClientGoal ? 'trainer-client-goal-identity' : '',
    monochromeTrainerSchedule && !trainerScheduleV2Route ? 'trainer-schedule-identity' : '',
    trainerScheduleV2Route ? 'trainer-schedule-v2-shell' : '',
    monochromeTrainerProgress ? 'trainer-progress-identity' : '',
    monochromeExerciseCatalog ? 'exercise-catalog-identity' : '',
    monochromeTrainerProfile ? 'trainer-profile-identity' : '',
    monochromeAuthJoin ? 'auth-join-identity' : '',
    monochromeAssistant ? 'assistant-identity' : '',
    chat ? 'chat-identity' : '',
    keyboardOpen ? 'keyboard-open' : '',
  ].filter(Boolean).join(' ')
  if (actor?.role === 'client') return <div className={frameClass}><div className={contentClass} ref={contentRef}><Outlet /></div>{!immersive && <nav className="tab-bar client-tab-bar" aria-label="Основная навигация">
    <NavLink to="/me" end><HomeIcon />Кабинет</NavLink>
    <NavLink to="/me/workouts"><ScheduleIcon />Тренировки</NavLink>
    {isAssistantNavPilotEnabled(actor.userId, actor.email) && <Coachmark
      id="client-assistant-2026-09"
      userId={actor.userId}
      title="Ассистент теперь доступен"
      description="Пишите или диктуйте: ассистент подготовит запись вашей тренировки и попросит подтверждение."
    >
      <NavLink to="/assistant"><AssistantIcon />Ассистент</NavLink>
    </Coachmark>}
    <NavLink to="/me/progress"><AnalyticsIcon />Прогресс</NavLink>
    <NavLink to="/me/profile"><ProfileIcon />Профиль</NavLink>
  </nav>}</div>
  return <div className={frameClass}><div className={contentClass} ref={contentRef}><Outlet /></div>{!immersive && <nav className="tab-bar trainer-tab-bar" aria-label="Основная навигация">
    <NavLink to="/today"><TodayIcon />Сегодня</NavLink>
    {trainerScheduleV2Route && <NavLink to="/schedule"><ScheduleIcon />Расписание</NavLink>}
    {(redesignedStart || trainerScheduleV2Route) && <NavLink to="/clients"><ClientsIcon />Клиенты</NavLink>}
    {actor?.role === 'trainer' && isAssistantNavPilotEnabled(actor.userId, actor.email) && <Coachmark
      id="assistant-all-trainers-2026-09"
      userId={actor.userId}
      title="Ассистент теперь доступен"
      description="Диктуйте или пишите: ассистент подготовит запись тренировки и попросит подтверждение."
    >
      <NavLink to="/assistant"><AssistantIcon />Ассистент</NavLink>
    </Coachmark>}
    {!trainerScheduleV2Route && <NavLink to="/schedule"><ScheduleIcon />Расписание</NavLink>}
    {!redesignedStart && !trainerScheduleV2Route && <NavLink to="/profile"><ProfileIcon />Профиль</NavLink>}
  </nav>}</div>
}
