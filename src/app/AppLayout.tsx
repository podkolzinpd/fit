import { useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { AnalyticsIcon, AssistantIcon, ClientsIcon, HomeIcon, ProfileIcon, ScheduleIcon, TodayIcon } from '../shared/icons'
import { useAuth } from './auth-context'
import { applyThemeVariant, resolveThemeVariant, themeVariantClass, useAppTheme } from './theme'
import { isAssistantNavPilotEnabled, isDarkThemePilotEnabled, isTodayStartRedesignEnabled } from './feature-flags'

export function appViewportMetrics(innerHeight: number, visualHeight: number) {
  return {
    keyboardOpen: innerHeight - visualHeight > 160,
  }
}

export function AppLayout() {
  const { actor } = useAuth()
  const theme = useAppTheme()
  const contentRef = useRef<HTMLDivElement>(null)
  const { pathname, search } = useLocation()
  const redesignedStart = isTodayStartRedesignEnabled()
  const [keyboardOpen, setKeyboardOpen] = useState(false)
  // main.tsx применяет тему до первого render, когда аккаунт ещё неизвестен.
  // Пилотный вариант подключается здесь — как только auth вернул actor и
  // allowlist можно проверить; вне allowlist вариант остаётся прежним тёмным.
  const themeVariant = resolveThemeVariant(theme, Boolean(actor && isDarkThemePilotEnabled(actor.userId)))

  useEffect(() => {
    // Класс живёт на <html>: фон вне рамки телефона и цвет системной панели
    // должны совпадать с палитрой внутри неё.
    applyThemeVariant(themeVariant)
  }, [themeVariant])

  useEffect(() => {
    // Route content can grow again while its draft is restored. Reset on the
    // next frame so iOS scroll anchoring cannot reopen Today below its primary
    // action after a longer form or review screen.
    const frame = window.requestAnimationFrame(() => contentRef.current?.scrollTo(0, 0))
    return () => window.cancelAnimationFrame(frame)
  }, [pathname, search])

  // На iOS окно не всегда меняет высоту при открытии клавиатуры. Visual
  // Viewport даёт её фактическую высоту: таб-бар не мешает вводу и CTA.
  useEffect(() => {
    const viewport = window.visualViewport
    if (!viewport) return
    const update = () => {
      const metrics = appViewportMetrics(window.innerHeight, viewport.height)
      setKeyboardOpen(metrics.keyboardOpen)
    }
    update()
    viewport.addEventListener('resize', update)
    viewport.addEventListener('scroll', update)
    window.addEventListener('resize', update)
    return () => {
      viewport.removeEventListener('resize', update)
      viewport.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
  }, [])

  // Создание, проверка, редактирование и live — один сфокусированный путь
  // тренировки. Нижняя навигация возвращается на списках и после выхода из
  // сценария, но внутри не конкурирует с текущим действием.
  const todayStep = (pathname === '/today' || pathname === '/me') && ['review', 'save'].includes(new URLSearchParams(search).get('view') ?? '')
  const liveSession = /\/live$/.test(pathname)
  const workoutForm = pathname === '/workouts/new' || /\/workouts\/[^/]+\/edit$/.test(pathname)
  const immersive = liveSession || workoutForm || todayStep
  const contentClass = immersive ? 'content content-immersive' : 'content'

  const frameClass = [
    'phone-frame',
    themeVariantClass(themeVariant),
    redesignedStart && pathname === '/today' ? 'today-start-shell' : '',
    liveSession ? 'live-session-shell' : '',
    workoutForm ? 'workout-form-shell' : '',
    keyboardOpen ? 'keyboard-open' : '',
  ].filter(Boolean).join(' ')
  if (actor?.role === 'client') return <div className={frameClass}><div className={contentClass} ref={contentRef}><Outlet /></div>{!immersive && <nav className="tab-bar client-tab-bar" aria-label="Основная навигация">
    <NavLink to="/me" end><HomeIcon />Кабинет</NavLink>
    <NavLink to="/me/workouts"><ScheduleIcon />Тренировки</NavLink>
    <NavLink to="/me/progress"><AnalyticsIcon />Прогресс</NavLink>
    {actor && isAssistantNavPilotEnabled(actor.userId) && <NavLink to="/assistant"><AssistantIcon />Ассистент</NavLink>}
    <NavLink to="/me/profile"><ProfileIcon />Профиль</NavLink>
  </nav>}</div>
  return <div className={frameClass}><div className={contentClass} ref={contentRef}><Outlet /></div>{!immersive && <nav className="tab-bar trainer-tab-bar" aria-label="Основная навигация">
    <NavLink to="/today"><TodayIcon />Сегодня</NavLink>
    {redesignedStart && <NavLink to="/clients"><ClientsIcon />Клиенты</NavLink>}
    {actor && isAssistantNavPilotEnabled(actor.userId) && <NavLink to="/assistant"><AssistantIcon />Ассистент</NavLink>}
    <NavLink to="/schedule"><ScheduleIcon />Расписание</NavLink>
    {!redesignedStart && <NavLink to="/profile"><ProfileIcon />Профиль</NavLink>}
  </nav>}</div>
}
