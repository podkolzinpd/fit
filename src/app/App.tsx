import { Navigate, Outlet, RouterProvider, createBrowserRouter, useLocation } from 'react-router-dom'
import { useAuth } from './auth-context'
import { AppLayout } from './AppLayout'
import { AuthCallbackPage, AuthPage, ForgotPasswordPage, ResetPasswordPage } from '../features/auth'
import { ClientDetailPage, ClientFormPage, ClientsPage } from '../features/clients'
import { ExercisesPage } from '../features/exercises'
import { AnalyticsPage, ProgressPage } from '../features/progress'
import { ProfilePage } from '../features/profile'
import { ClientWorkoutsPage, ExerciseHistoryPage, LiveWorkoutPage, SchedulePage, WorkoutDetailPage, WorkoutFormPage } from '../features/workouts'

function Protected() {
  const { actor, loading, error } = useAuth(); const location = useLocation()
  if (loading) return <main className="state">Восстанавливаем сессию…</main>
  if (!actor) return <Navigate to="/auth" state={{ from: location.pathname }} replace />
  if (error) return <main className="state error">{error}</main>
  return <Outlet />
}

const router = createBrowserRouter([
  { path: '/auth', element: <AuthPage /> },
  { path: '/auth/forgot', element: <ForgotPasswordPage /> },
  { path: '/auth/reset', element: <ResetPasswordPage /> },
  { path: '/auth/callback', element: <AuthCallbackPage /> },
  { element: <Protected />, children: [{ element: <AppLayout />, children: [
    { index: true, element: <Navigate to="/clients" replace /> },
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
  { path: '*', element: <Navigate to="/" replace /> },
])

export function App() { return <RouterProvider router={router} /> }
