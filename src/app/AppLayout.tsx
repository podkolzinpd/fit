import { NavLink, Outlet } from 'react-router-dom'
import { AnalyticsIcon, ClientsIcon, ProfileIcon, ScheduleIcon } from '../shared/icons'

export function AppLayout() {
  return <div className="phone-frame"><div className="content"><Outlet /></div><nav className="tab-bar" aria-label="Основная навигация">
    <NavLink to="/clients"><ClientsIcon />Клиенты</NavLink>
    <NavLink to="/schedule"><ScheduleIcon />Расписание</NavLink>
    <NavLink to="/analytics"><AnalyticsIcon />Аналитика</NavLink>
    <NavLink to="/profile"><ProfileIcon />Профиль</NavLink>
  </nav></div>
}
