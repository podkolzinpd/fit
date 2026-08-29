import { useEffect, useRef } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { AnalyticsIcon, AssistantIcon, ClientsIcon, HomeIcon, ProfileIcon, ScheduleIcon, TodayIcon } from '../shared/icons'
import { useAuth } from './auth-context'
import { applyThemeVariant, resolveThemeVariant, themeVariantClass, useAppTheme } from './theme'
import { isAssistantNavPilotEnabled, isDarkThemePilotEnabled, isMonochromeUiEnabled, isTodayStartRedesignEnabled } from './feature-flags'
import { useAppViewport } from './app-viewport'

export { appViewportMetrics } from './app-viewport'

export function AppLayout() {
  const { actor } = useAuth()
  const theme = useAppTheme()
  const contentRef = useRef<HTMLDivElement>(null)
  const { pathname, search } = useLocation()
  const redesignedStart = isTodayStartRedesignEnabled()
  const { keyboardOpen } = useAppViewport()
  const todayStep = (pathname === '/today' || pathname === '/me') && ['review', 'save'].includes(new URLSearchParams(search).get('view') ?? '')
  const liveSession = /\/live$/.test(pathname)
  const workoutForm = pathname === '/workouts/new' || /\/workouts\/[^/]+\/edit$/.test(pathname)
  const workoutDetail = pathname !== '/workouts/new' && /\/workouts\/[^/]+$/.test(pathname)
  const exerciseHistory = /\/workouts\/[^/]+\/history\/[^/]+$/.test(pathname)
  const monochromeEnabled = isMonochromeUiEnabled(Boolean(actor?.featureFlags?.monochromePreview))
  const monochromeClientHome = monochromeEnabled && pathname === '/me' && !todayStep
  const monochromeLive = monochromeEnabled && liveSession
  const monochromeProgress = monochromeEnabled && pathname === '/me/progress'
  const monochromeClientGoal = monochromeEnabled && pathname === '/me/goal'
  const monochromeClientWorkouts = monochromeEnabled && pathname === '/me/workouts'
  const monochromeTrainerClientWorkouts = Boolean(monochromeEnabled && actor?.role === 'trainer' && /^\/clients\/[^/]+\/workouts$/.test(pathname))
  const monochromeClientProfile = monochromeEnabled && pathname === '/me/profile'
  const monochromeClientCardEdit = monochromeEnabled && pathname === '/me/edit'
  const monochromeWorkoutCreateEdit = monochromeEnabled && (workoutForm || todayStep)
  const monochromeWorkoutDetailHistory = monochromeEnabled && (workoutDetail || exerciseHistory)
  const monochromeTrainerToday = Boolean(monochromeEnabled && actor?.role === 'trainer' && pathname === '/today' && !todayStep)
  const monochromeTrainerClients = Boolean(monochromeEnabled && actor?.role === 'trainer' && pathname === '/clients')
  const monochromeTrainerClientDetail = Boolean(monochromeEnabled && actor?.role === 'trainer' && /^\/clients\/[^/]+$/.test(pathname) && pathname !== '/clients/new')
  const monochromeTrainerClientForm = Boolean(monochromeEnabled && actor?.role === 'trainer' && (pathname === '/clients/new' || /^\/clients\/[^/]+\/edit$/.test(pathname)))
  const monochromeTrainerClientGoal = Boolean(monochromeEnabled && actor?.role === 'trainer' && /^\/clients\/[^/]+\/goal$/.test(pathname))
  const monochromeTrainerSchedule = Boolean(monochromeEnabled && actor?.role === 'trainer' && pathname === '/schedule')
  const monochromeTrainerProgress = Boolean(monochromeEnabled && actor?.role === 'trainer' && /^\/progress\/[^/]+$/.test(pathname))
  const monochromeExerciseCatalog = Boolean(monochromeEnabled && actor?.role === 'trainer' && pathname === '/exercises')
  const monochromeTrainerProfile = Boolean(monochromeEnabled && actor?.role === 'trainer' && pathname === '/profile')
  const monochromeAuthJoin = monochromeEnabled && pathname === '/join'
  const monochromeAssistant = monochromeEnabled && pathname === '/assistant'
  const monochromeIdentity = monochromeClientHome || monochromeLive || monochromeProgress || monochromeClientGoal || monochromeClientWorkouts || monochromeTrainerClientWorkouts || monochromeClientProfile || monochromeClientCardEdit || monochromeWorkoutCreateEdit || monochromeWorkoutDetailHistory || monochromeTrainerToday || monochromeTrainerClients || monochromeTrainerClientDetail || monochromeTrainerClientForm || monochromeTrainerClientGoal || monochromeTrainerSchedule || monochromeTrainerProgress || monochromeExerciseCatalog || monochromeTrainerProfile || monochromeAuthJoin || monochromeAssistant
  // main.tsx применяет тему до первого render, когда аккаунт ещё неизвестен.
  // Пилотный вариант подключается здесь — как только auth вернул actor и
  // allowlist можно проверить; вне allowlist вариант остаётся прежним тёмным.
  // Monochrome dark — самостоятельная принятая палитра, а не прежний
  // фиолетовый dark-pilot. Identity-токены задают dark values сами; старый
  // pilot остаётся доступен только на legacy routes.
  const themeVariant = resolveThemeVariant(theme, !monochromeIdentity && Boolean(actor && isDarkThemePilotEnabled(actor.userId)))

  useEffect(() => {
    // Класс живёт на <html>: фон вне рамки телефона и цвет системной панели
    // должны совпадать с палитрой внутри неё.
    applyThemeVariant(themeVariant)
    const root = document.documentElement
    root.classList.toggle('identity-monochrome-preview', monochromeIdentity)
    if (monochromeIdentity) {
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'light' ? '#FBFAF7' : '#111214')
    }
    return () => {
      root.classList.remove('identity-monochrome-preview')
      applyThemeVariant(themeVariant)
    }
  }, [monochromeIdentity, theme, themeVariant])

  useEffect(() => {
    // Route content can grow again while its draft is restored. Reset on the
    // next frame so iOS scroll anchoring cannot reopen Today below its primary
    // action after a longer form or review screen.
    const frame = window.requestAnimationFrame(() => contentRef.current?.scrollTo(0, 0))
    return () => window.cancelAnimationFrame(frame)
  }, [pathname, search])

  // Создание, проверка, редактирование и live — один сфокусированный путь
  // тренировки. Нижняя навигация возвращается на списках и после выхода из
  // сценария, но внутри не конкурирует с текущим действием.
  const assistant = pathname === '/assistant'
  const immersive = liveSession || workoutForm || todayStep
  const contentClass = immersive ? 'content content-immersive' : 'content'

  const frameClass = [
    'phone-frame',
    themeVariantClass(themeVariant),
    redesignedStart && pathname === '/today' ? 'today-start-shell' : '',
    liveSession ? 'live-session-shell' : '',
    workoutForm ? 'workout-form-shell' : '',
    assistant ? 'assistant-shell' : '',
    monochromeIdentity ? 'identity-monochrome-preview' : '',
    monochromeClientHome ? 'client-home-identity' : '',
    monochromeLive ? 'live-identity' : '',
    monochromeProgress ? 'progress-identity' : '',
    monochromeClientGoal ? 'trainer-client-goal-identity client-goal-identity' : '',
    monochromeClientWorkouts || monochromeTrainerClientWorkouts ? 'client-workouts-identity' : '',
    monochromeClientProfile ? 'client-profile-shell-identity' : '',
    monochromeClientCardEdit ? 'client-card-edit-identity' : '',
    monochromeWorkoutCreateEdit ? 'workout-create-edit-identity' : '',
    monochromeWorkoutDetailHistory ? 'workout-detail-history-identity' : '',
    monochromeTrainerToday ? 'trainer-today-identity' : '',
    monochromeTrainerClients ? 'trainer-clients-identity' : '',
    monochromeTrainerClientDetail ? 'trainer-client-detail-identity' : '',
    monochromeTrainerClientForm ? 'trainer-client-form-identity' : '',
    monochromeTrainerClientGoal ? 'trainer-client-goal-identity' : '',
    monochromeTrainerSchedule ? 'trainer-schedule-identity' : '',
    monochromeTrainerProgress ? 'trainer-progress-identity' : '',
    monochromeExerciseCatalog ? 'exercise-catalog-identity' : '',
    monochromeTrainerProfile ? 'trainer-profile-identity' : '',
    monochromeAuthJoin ? 'auth-join-identity' : '',
    monochromeAssistant ? 'assistant-identity' : '',
    keyboardOpen ? 'keyboard-open' : '',
  ].filter(Boolean).join(' ')
  if (actor?.role === 'client') return <div className={frameClass}><div className={contentClass} ref={contentRef}><Outlet /></div>{!immersive && <nav className="tab-bar client-tab-bar" aria-label="Основная навигация">
    <NavLink to="/me" end><HomeIcon />Кабинет</NavLink>
    <NavLink to="/me/workouts"><ScheduleIcon />Тренировки</NavLink>
    <NavLink to="/me/progress"><AnalyticsIcon />Прогресс</NavLink>
    <NavLink to="/me/profile"><ProfileIcon />Профиль</NavLink>
  </nav>}</div>
  return <div className={frameClass}><div className={contentClass} ref={contentRef}><Outlet /></div>{!immersive && <nav className="tab-bar trainer-tab-bar" aria-label="Основная навигация">
    <NavLink to="/today"><TodayIcon />Сегодня</NavLink>
    {redesignedStart && <NavLink to="/clients"><ClientsIcon />Клиенты</NavLink>}
    {actor?.role === 'trainer' && isAssistantNavPilotEnabled(actor.userId, actor.email) && <NavLink to="/assistant"><AssistantIcon />Ассистент</NavLink>}
    <NavLink to="/schedule"><ScheduleIcon />Расписание</NavLink>
    {!redesignedStart && <NavLink to="/profile"><ProfileIcon />Профиль</NavLink>}
  </nav>}</div>
}
