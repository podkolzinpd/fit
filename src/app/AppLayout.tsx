import { useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { AnalyticsIcon, ClientsIcon, HomeIcon, ProfileIcon, ScheduleIcon, TodayIcon } from '../shared/icons'
import { useAuth } from './auth-context'
import { useAppTheme } from './theme'
import { isTodayStartRedesignEnabled } from './feature-flags'

export function AppLayout() {
  const { actor } = useAuth()
  const theme = useAppTheme()
  const contentRef = useRef<HTMLDivElement>(null)
  const { pathname, search } = useLocation()
  const redesignedStart = isTodayStartRedesignEnabled()
  const [keyboardOpen, setKeyboardOpen] = useState(false)

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
    const update = () => setKeyboardOpen(window.innerHeight - viewport.height > 160)
    update()
    viewport.addEventListener('resize', update)
    viewport.addEventListener('scroll', update)
    return () => {
      viewport.removeEventListener('resize', update)
      viewport.removeEventListener('scroll', update)
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

  const frameClass = `${theme === 'light' ? 'phone-frame theme-light' : 'phone-frame'}${redesignedStart && pathname === '/today' ? ' today-start-shell' : ''}${liveSession ? ' live-session-shell' : ''}${workoutForm ? ' workout-form-shell' : ''}${keyboardOpen ? ' keyboard-open' : ''}`

  if (actor?.role === 'client') return <div className={frameClass}><div className={contentClass} ref={contentRef}><Outlet /></div>{!immersive && <nav className="tab-bar" aria-label="Основная навигация">
    <NavLink to="/me" end><HomeIcon />Кабинет</NavLink>
    <NavLink to="/me/workouts"><ScheduleIcon />Тренировки</NavLink>
    <NavLink to="/me/progress"><AnalyticsIcon />Прогресс</NavLink>
    <NavLink to="/me/profile"><ProfileIcon />Профиль</NavLink>
  </nav>}</div>
  return <div className={frameClass}><div className={contentClass} ref={contentRef}><Outlet /></div>{!immersive && <nav className="tab-bar trainer-tab-bar" aria-label="Основная навигация">
    <NavLink to="/today"><TodayIcon />Сегодня</NavLink>
    {redesignedStart && <NavLink to="/clients"><ClientsIcon />Клиенты</NavLink>}
    <NavLink to="/schedule"><ScheduleIcon />Расписание</NavLink>
    {!redesignedStart && <NavLink to="/profile"><ProfileIcon />Профиль</NavLink>}
  </nav>}</div>
}
