import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app/App'
import { AuthProvider } from './app/auth-context'
import { AppErrorBoundary } from './app/error-boundary'
import { QueryProvider } from './app/query-provider'
import { applyAppTheme, getAppTheme } from './app/theme'
import './styles.css'

// Ставим сохранённую тему до первого React-render, чтобы при запуске и
// восстановлении сессии не было вспышки другой палитры.
applyAppTheme(getAppTheme())

createRoot(document.getElementById('root')!).render(<StrictMode><AppErrorBoundary><QueryProvider><AuthProvider><App /></AuthProvider></QueryProvider></AppErrorBoundary></StrictMode>)
