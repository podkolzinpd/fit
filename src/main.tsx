import { StrictMode, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { AppRoot } from './app/AppRoot'
import { isMaintenanceModeEnabled } from './app/feature-flags'
import { applyAppTheme, getAppTheme } from './app/theme'
import { initializeWorkoutInactivityNotificationActions } from './features/workouts/workout-inactivity-reminder'
import '@fontsource-variable/onest/wght.css'
import './styles.css'
import './styles/fit-lime-components.css'
import './styles/fit-lime-shell.css'
import './styles/fit-lime-today.css'
import './styles/fit-lime-schedule.css'
import './styles/fit-lime-actions.css'
import './styles/fit-lime-inbox.css'
import './styles/fit-lime-chat.css'
import './styles/fit-lime-clients.css'
import './styles/fit-lime-client-detail.css'
import './styles/fit-lime-client-forms.css'
import './styles/fit-lime-client-goal.css'
import './styles/fit-lime-progress-history.css'
import './styles/fit-lime-profile.css'
import './styles/fit-lime-exercises.css'
import './styles/fit-lime-workout-form.css'
import './styles/fit-lime-workout-entry.css'
import './styles/fit-lime-workout-detail.css'
import './styles/fit-lime-workout-live.css'

declare global {
  interface Window {
    __fitMarkAppStarted?: () => void
  }
}

// Ставим сохранённую тему до первого React-render, чтобы при запуске и
// восстановлении сессии не было вспышки другой палитры.
applyAppTheme(getAppTheme())
if (!isMaintenanceModeEnabled()) initializeWorkoutInactivityNotificationActions()

function AppStartedSignal() {
  useEffect(() => window.__fitMarkAppStarted?.(), [])
  return null
}

createRoot(document.getElementById('root')!).render(<StrictMode>
  <AppRoot />
  <AppStartedSignal />
</StrictMode>)

// Убираем технический параметр после автоматического восстановления старого
// закэшированного entry-файла, не затрагивая остальные параметры маршрута.
const startupUrl = new URL(window.location.href)
if (startupUrl.searchParams.has('fit-recover')) {
  startupUrl.searchParams.delete('fit-recover')
  window.history.replaceState(
    window.history.state,
    '',
    `${startupUrl.pathname}${startupUrl.search}${startupUrl.hash}`,
  )
}
