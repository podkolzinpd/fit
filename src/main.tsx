import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app/App'
import { AuthProvider } from './app/auth-context'
import { AppErrorBoundary } from './app/error-boundary'
import { QueryProvider } from './app/query-provider'
import { YandexAppSessionProvider } from './app/yandex-app-session-context'
import { applyAppTheme, getAppTheme } from './app/theme'
import '@fontsource-variable/onest/wght.css'
import './styles.css'

// Ставим сохранённую тему до первого React-render, чтобы при запуске и
// восстановлении сессии не было вспышки другой палитры.
applyAppTheme(getAppTheme())

createRoot(document.getElementById('root')!).render(<StrictMode><AppErrorBoundary><QueryProvider><AuthProvider><YandexAppSessionProvider><App /></YandexAppSessionProvider></AuthProvider></QueryProvider></AppErrorBoundary></StrictMode>)
