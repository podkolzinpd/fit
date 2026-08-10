import { useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { AnalyticsIcon, ClientsIcon, ProfileIcon, ScheduleIcon, SettingsIcon } from '../shared/icons'
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

  // В live-режиме прячем нижнюю навигацию: во время тренировки приоритет —
  // текущий подход, таймер и завершение; таб-бар не должен конкурировать с
  // закреплённой панелью действий (BottomActionBar). Контент занимает всю высоту.
  const immersive = /\/live$/.test(pathname)
  const contentClass = immersive ? 'content content-immersive' : 'content'

  const frameClass = `${theme === 'light' ? 'phone-frame theme-light' : 'phone-frame'}${redesignedStart && pathname === '/today' ? ' today-start-shell' : ''}${keyboardOpen ? ' keyboard-open' : ''}`

  if (actor?.role === 'client') return <div className={frameClass}><div className={contentClass} ref={contentRef}><Outlet /></div>{!immersive && <nav className="tab-bar" aria-label="Основная навигация">
    <NavLink to="/me" end><ClientsIcon />Кабинет</NavLink>
    <NavLink to="/me/workouts"><ScheduleIcon />Тренировки</NavLink>
    <NavLink to="/me/progress"><AnalyticsIcon />Прогресс</NavLink>
    <NavLink to="/me/profile"><ProfileIcon />Профиль</NavLink>
  </nav>}</div>
  // Редизайн: навигация тренера — текстовые табы сверху, ассистент в центре;
  // профиль доступен с любого таба через шестерёнку в той же строке.
  if (redesignedStart) return <div className={`${frameClass} trainer-top-shell`}>{!immersive && <nav className="top-tab-bar" aria-label="Основная навигация">
    <NavLink to="/clients" data-label="Клиенты">Клиенты</NavLink>
    <NavLink to="/today" data-label="Ассистент">Ассистент</NavLink>
    <NavLink to="/schedule" data-label="Расписание">Расписание</NavLink>
    <NavLink to="/profile" className="top-tab-settings" aria-label="Открыть профиль"><SettingsIcon /></NavLink>
  </nav>}<div className={contentClass} ref={contentRef}><Outlet /></div></div>
  return <div className={frameClass}><div className={contentClass} ref={contentRef}><Outlet /></div>{!immersive && <nav className="tab-bar trainer-tab-bar" aria-label="Основная навигация">
    <NavLink to="/today"><ScheduleIcon />Сегодня</NavLink>
    <NavLink to="/schedule"><ScheduleIcon />Расписание</NavLink>
    <NavLink to="/profile"><ProfileIcon />Профиль</NavLink>
  </nav>}</div>
}
