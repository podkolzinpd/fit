import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app/App'
import { AuthProvider } from './app/auth-context'
import { QueryProvider } from './app/query-provider'
import { APP_THEME } from './app/theme'
import './styles.css'

// Ставим тему до первого React-render, чтобы при стандартной светлой сборке
// не было краткого вспыхивания тёмного фона. Цвет системной панели браузера
// следует той же build-time настройке.
const lightTheme = APP_THEME === 'light'
document.documentElement.classList.toggle('theme-light', lightTheme)
document.querySelector('meta[name="theme-color"]')
  ?.setAttribute('content', lightTheme ? '#f7f4ef' : '#15131a')

createRoot(document.getElementById('root')!).render(<StrictMode><QueryProvider><AuthProvider><App /></AuthProvider></QueryProvider></StrictMode>)
