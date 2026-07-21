import { NavLink, Outlet } from 'react-router-dom'

export function AppLayout() {
  return <div className="phone-frame"><div className="content"><Outlet /></div><nav className="tab-bar" aria-label="Основная навигация"><NavLink to="/clients">Клиенты</NavLink><NavLink to="/schedule">Расписание</NavLink><NavLink to="/analytics">Аналитика</NavLink><NavLink to="/profile">Профиль</NavLink></nav></div>
}
