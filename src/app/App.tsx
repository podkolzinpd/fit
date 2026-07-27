import { Navigate, Outlet, RouterProvider, createBrowserRouter, useLocation } from 'react-router-dom'
import { useAuth } from './auth-context'
import { AppLayout, ClientAppLayout } from './AppLayout'
import { AuthCallbackPage, AuthPage, ForgotPasswordPage, ResetPasswordPage } from '../features/auth'
import { ClientDetailPage, ClientFormPage, ClientsPage } from '../features/clients'
import { ExercisesPage } from '../features/exercises'
import { AnalyticsPage, ProgressPage } from '../features/progress'
import { ProfilePage } from '../features/profile'
import { ClientWorkoutsPage, ExerciseHistoryPage, LiveWorkoutPage, SchedulePage, WorkoutDetailPage, WorkoutFormPage } from '../features/workouts'
import { ClientProfilePage, ClientProgressPage } from '../features/client-app'

function Protected() {
  const { actor, loading, error } = useAuth(); const location = useLocation()
  if (loading) return <main className="state">Восстанавливаем сессию…</main>
  if (!actor) return <Navigate to="/auth" state={{ from: location.pathname }} replace />
  if (error) return <main className="state error">{error}</main>
  return <Outlet />
}

function RoleProtected({ kind }: { kind: 'trainer' | 'client' }) {
  const { actor } = useAuth()
  if (!actor) return <Navigate to="/auth" replace />
  if (actor.kind !== kind) {
    return <Navigate to={actor.kind === 'client' ? '/me/progress' : '/clients'} replace />
  }
  return <Outlet />
}

function HomeRedirect() {
  const { actor } = useAuth()
  return <Navigate to={actor?.kind === 'client' ? '/me/progress' : '/clients'} replace />
}

const router = createBrowserRouter([
  { path: '/auth', element: <AuthPage /> },
  { path: '/auth/forgot', element: <ForgotPasswordPage /> },
  { path: '/auth/reset', element: <ResetPasswordPage /> },
  { path: '/auth/callback', element: <AuthCallbackPage /> },
  { element: <Protected />, children: [
    { index: true, element: <HomeRedirect /> },
    { element: <RoleProtected kind="trainer" />, children: [{ element: <AppLayout />, children: [
      { path: '/clients', element: <ClientsPage /> },
      { path: '/clients/new', element: <ClientFormPage /> },
      { path: '/clients/:clientId', element: <ClientDetailPage /> },
      { path: '/clients/:clientId/edit', element: <ClientFormPage /> },
      { path: '/clients/:clientId/workouts', element: <ClientWorkoutsPage /> },
      { path: '/schedule', element: <SchedulePage /> },
      { path: '/workouts/new', element: <WorkoutFormPage /> },
      { path: '/workouts/:workoutId', element: <WorkoutDetailPage /> },
      { path: '/workouts/:workoutId/edit', element: <WorkoutFormPage /> },
      { path: '/workouts/:workoutId/live', element: <LiveWorkoutPage /> },
      { path: '/workouts/:workoutId/history/:exerciseRef', element: <ExerciseHistoryPage /> },
      { path: '/analytics', element: <AnalyticsPage /> },
      { path: '/progress/:clientId', element: <ProgressPage /> },
      { path: '/exercises', element: <ExercisesPage /> },
      { path: '/profile', element: <ProfilePage /> },
    ] }] },
    { element: <RoleProtected kind="client" />, children: [{ element: <ClientAppLayout />, children: [
      { path: '/me/progress', element: <ClientProgressPage /> },
      { path: '/me/profile', element: <ClientProfilePage /> },
    ] }] },
  ] },
  { path: '*', element: <Navigate to="/" replace /> },
])

export function App() { return <RouterProvider router={router} /> }
