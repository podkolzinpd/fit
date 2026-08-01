import { useEffect, useRef } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { AnalyticsIcon, ClientsIcon, ProfileIcon, ScheduleIcon } from '../shared/icons'
import { useAuth } from './auth-context'
import { useAppTheme } from './theme'

export function AppLayout() {
  const { actor } = useAuth()
  const theme = useAppTheme()
  const contentRef = useRef<HTMLDivElement>(null)
  const { pathname } = useLocation()

  useEffect(() => { contentRef.current?.scrollTo(0, 0) }, [pathname])

  // В live-режиме прячем нижнюю навигацию: во время тренировки приоритет —
  // текущий подход, таймер и завершение; таб-бар не должен конкурировать с
  // закреплённой панелью действий (BottomActionBar). Контент занимает всю высоту.
  const immersive = /\/live$/.test(pathname)
  const contentClass = immersive ? 'content content-immersive' : 'content'

  const frameClass = theme === 'light' ? 'phone-frame theme-light' : 'phone-frame'

  if (actor?.role === 'client') return <div className={frameClass}><div className={contentClass} ref={contentRef}><Outlet /></div>{!immersive && <nav className="tab-bar" aria-label="Основная навигация">
    <NavLink to="/me"><ClientsIcon />Кабинет</NavLink>
    <NavLink to="/me/workouts"><ScheduleIcon />Тренировки</NavLink>
    <NavLink to="/me/progress"><AnalyticsIcon />Прогресс</NavLink>
    <NavLink to="/profile"><ProfileIcon />Профиль</NavLink>
  </nav>}</div>
  return <div className={frameClass}><div className={contentClass} ref={contentRef}><Outlet /></div>{!immersive && <nav className="tab-bar" aria-label="Основная навигация">
    <NavLink to="/today"><ScheduleIcon />Сегодня</NavLink>
    <NavLink to="/schedule"><ScheduleIcon />Расписание</NavLink>
    <NavLink to="/analytics"><AnalyticsIcon />Аналитика</NavLink>
    <NavLink to="/profile"><ProfileIcon />Профиль</NavLink>
  </nav>}</div>
}

export function ClientAppLayout() {
  return <div className="phone-frame client-shell"><div className="content"><Outlet /></div><nav className="tab-bar" aria-label="Навигация клиента">
    <NavLink to="/me/progress"><AnalyticsIcon />Прогресс</NavLink>
    <NavLink to="/me/profile"><ProfileIcon />Профиль</NavLink>
  </nav></div>
}
