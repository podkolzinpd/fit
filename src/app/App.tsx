import { Navigate, Outlet, RouterProvider, createBrowserRouter, useLocation } from 'react-router-dom'
import { useAuth } from './auth-context'
import { trackPageView } from '../shared/yandex-metrika'
import { AppLayout } from './AppLayout'
import { trainerHomePath } from './feature-flags'
import { AuthCallbackPage, AuthPage, ForgotPasswordPage, JoinPage, ResetPasswordPage } from '../features/auth'
import { ClientProfilePage } from '../features/client-app'
import { ClientDetailPage, ClientFormPage, ClientsPage, GoalPage, MyClientEditPage, MyClientPage, MyProgressPage, MyWorkoutsPage } from '../features/clients'
import { ExercisesPage } from '../features/exercises'
import { ProgressPage } from '../features/progress'
import { ProfilePage } from '../features/profile'
import { ClientWorkoutsPage, ExerciseHistoryPage, LiveWorkoutPage, SchedulePage, TodayPage, WorkoutDetailPage, WorkoutFormPage } from '../features/workouts'

function Protected() {
  const { actor, loading, error } = useAuth(); const location = useLocation()
  if (loading) return <main className="state">Восстанавливаем сессию…</main>
  if (!actor) return <Navigate to="/auth" state={{ from: location.pathname }} replace />
  if (error) return <main className="state error">{error}</main>
  return <Outlet />
}

function TrainerOnly() {
  const { actor } = useAuth()
  return actor?.role === 'trainer' ? <Outlet /> : <Navigate to="/me" replace />
}

function ClientOnly() {
  const { actor } = useAuth()
  return actor?.role === 'client' ? <Outlet /> : <Navigate to={trainerHomePath()} replace />
}

function Home() {
  const { actor } = useAuth()
  return <Navigate to={actor?.role === 'client' ? '/me' : trainerHomePath()} replace />
}

const router = createBrowserRouter([
  { path: '/auth', element: <AuthPage /> },
  { path: '/auth/forgot', element: <ForgotPasswordPage /> },
  { path: '/auth/reset', element: <ResetPasswordPage /> },
  { path: '/auth/callback', element: <AuthCallbackPage /> },
  { element: <Protected />, children: [{ element: <AppLayout />, children: [
    { index: true, element: <Home /> },
    { path: '/join', element: <JoinPage /> },
    { element: <ClientOnly />, children: [
      { path: '/me', element: <MyClientPage /> },
      { path: '/me/edit', element: <MyClientEditPage /> },
      { path: '/me/workouts', element: <MyWorkoutsPage /> },
      { path: '/me/progress', element: <MyProgressPage /> },
      { path: '/me/profile', element: <ClientProfilePage /> },
    ] },
    { path: '/workouts/new', element: <WorkoutFormPage /> },
    { path: '/workouts/:workoutId/edit', element: <WorkoutFormPage /> },
    { path: '/workouts/:workoutId', element: <WorkoutDetailPage /> },
    { path: '/workouts/:workoutId/live', element: <LiveWorkoutPage /> },
    { element: <TrainerOnly />, children: [
      { path: '/today', element: <TodayPage /> },
      { path: '/clients', element: <ClientsPage /> },
      { path: '/clients/new', element: <ClientFormPage /> },
      { path: '/clients/:clientId', element: <ClientDetailPage /> },
      { path: '/clients/:clientId/goal', element: <GoalPage /> },
      { path: '/clients/:clientId/edit', element: <ClientFormPage /> },
      { path: '/clients/:clientId/workouts', element: <ClientWorkoutsPage /> },
      { path: '/schedule', element: <SchedulePage /> },
      { path: '/workouts/:workoutId/history/:exerciseRef', element: <ExerciseHistoryPage /> },
      { path: '/progress/:clientId', element: <ProgressPage /> },
      { path: '/exercises', element: <ExercisesPage /> },
      { path: '/profile', element: <ProfilePage /> },
    ] },
  ] }] },
  { path: '*', element: <Navigate to="/" replace /> },
])

// Счётчик init уже отправил хит для первой загрузки — трекаем только
// последующие переходы между роутами SPA.
let isFirstRouterUpdate = true
router.subscribe((state) => {
  if (isFirstRouterUpdate) { isFirstRouterUpdate = false; return }
  trackPageView(state.location.pathname + state.location.search)
})

export function App() {
  return <RouterProvider router={router} />
}
