import { App } from './App'
import { AppErrorBoundary } from './error-boundary'
import { isMaintenanceModeEnabled } from './feature-flags'
import { QueryProvider } from './query-provider'
import { AuthProvider } from './auth-context'
import { DataBackendProvider } from './data-backend-context'
import { MaintenancePage } from './maintenance-page'
import { YandexAppSessionProvider } from './yandex-app-session-context'

export function AppRoot() {
  if (isMaintenanceModeEnabled()) return <MaintenancePage />

  return <AppErrorBoundary>
    <QueryProvider>
      <YandexAppSessionProvider>
        <AuthProvider>
          <DataBackendProvider>
            <App />
          </DataBackendProvider>
        </AuthProvider>
      </YandexAppSessionProvider>
    </QueryProvider>
  </AppErrorBoundary>
}
