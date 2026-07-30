import { useEffect, useRef } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { AnalyticsIcon, ClientsIcon, ProfileIcon, ScheduleIcon } from '../shared/icons'
import { useAuth } from './auth-context'
import { isLightPilotPath } from './light-pilot-route'

// YAFIT-77: флаг светлого пилота. Выключен по умолчанию (в т.ч. в проде/iOS);
// включается заданием VITE_LIGHT_PILOT=1 в окружении сборки.
const LIGHT_PILOT_ENABLED = import.meta.env.VITE_LIGHT_PILOT === '1'

function isLightPilotRoute(pathname: string): boolean {
  return LIGHT_PILOT_ENABLED && isLightPilotPath(pathname)
}

export function AppLayout() {
  const { actor } = useAuth()
  const contentRef = useRef<HTMLDivElement>(null)
  const { pathname } = useLocation()

  useEffect(() => { contentRef.current?.scrollTo(0, 0) }, [pathname])

  // В live-режиме прячем нижнюю навигацию: во время тренировки приоритет —
  // текущий подход, таймер и завершение; таб-бар не должен конкурировать с
  // закреплённой панелью действий (BottomActionBar). Контент занимает всю высоту.
  const immersive = /\/live$/.test(pathname)
  const contentClass = immersive ? 'content content-immersive' : 'content'

  // YAFIT-77: после трёх групп раскатки флаг покрывает все известные маршруты.
  // Проверку маршрута сохраняем как предохранитель для новых экранов: они не
  // должны случайно считаться визуально проверенными.
  const frameClass = isLightPilotRoute(pathname) ? 'phone-frame theme-light' : 'phone-frame'

  if (actor?.role === 'client') return <div className={frameClass}><div className={contentClass} ref={contentRef}><Outlet /></div>{!immersive && <nav className="tab-bar" aria-label="Основная навигация">
    <NavLink to="/me"><ClientsIcon />Кабинет</NavLink>
    <NavLink to="/me/workouts"><ScheduleIcon />Тренировки</NavLink>
    <NavLink to="/me/progress"><AnalyticsIcon />Прогресс</NavLink>
    <NavLink to="/profile"><ProfileIcon />Профиль</NavLink>
  </nav>}</div>
  return <div className={frameClass}><div className={contentClass} ref={contentRef}><Outlet /></div>{!immersive && <nav className="tab-bar" aria-label="Основная навигация">
    <NavLink to="/clients"><ClientsIcon />Клиенты</NavLink>
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
