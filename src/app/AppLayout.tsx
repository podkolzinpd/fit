import { useEffect, useRef } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { AnalyticsIcon, ClientsIcon, ProfileIcon, ScheduleIcon } from '../shared/icons'
import { useAuth } from './auth-context'

export function AppLayout() {
  const { actor } = useAuth()
  const contentRef = useRef<HTMLDivElement>(null)
  const { pathname } = useLocation()

  useEffect(() => { contentRef.current?.scrollTo(0, 0) }, [pathname])

  if (actor?.role === 'client') return <div className="phone-frame"><div className="content" ref={contentRef}><Outlet /></div><nav className="tab-bar" aria-label="Основная навигация">
    <NavLink to="/me"><ClientsIcon />Кабинет</NavLink>
    <NavLink to="/me/workouts"><ScheduleIcon />Тренировки</NavLink>
    <NavLink to="/me/progress"><AnalyticsIcon />Прогресс</NavLink>
    <NavLink to="/profile"><ProfileIcon />Профиль</NavLink>
  </nav></div>
  return <div className="phone-frame"><div className="content" ref={contentRef}><Outlet /></div><nav className="tab-bar" aria-label="Основная навигация">
    <NavLink to="/clients"><ClientsIcon />Клиенты</NavLink>
    <NavLink to="/schedule"><ScheduleIcon />Расписание</NavLink>
    <NavLink to="/analytics"><AnalyticsIcon />Аналитика</NavLink>
    <NavLink to="/profile"><ProfileIcon />Профиль</NavLink>
  </nav></div>
}

export function ClientAppLayout() {
  return <div className="phone-frame client-shell"><div className="content"><Outlet /></div><nav className="tab-bar" aria-label="Навигация клиента">
    <NavLink to="/me/progress"><AnalyticsIcon />Прогресс</NavLink>
    <NavLink to="/me/profile"><ProfileIcon />Профиль</NavLink>
  </nav></div>
}
