import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { AppRoot } from './app/AppRoot'
import { isMaintenanceModeEnabled } from './app/feature-flags'
import { applyAppTheme, getAppTheme } from './app/theme'
import { initializeWorkoutInactivityNotificationActions } from './features/workouts/workout-inactivity-reminder'
import '@fontsource-variable/onest/wght.css'
import './styles.css'

// Ставим сохранённую тему до первого React-render, чтобы при запуске и
// восстановлении сессии не было вспышки другой палитры.
applyAppTheme(getAppTheme())
if (!isMaintenanceModeEnabled()) initializeWorkoutInactivityNotificationActions()

createRoot(document.getElementById('root')!).render(<StrictMode><AppRoot /></StrictMode>)
