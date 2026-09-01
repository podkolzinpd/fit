import { Navigate, Outlet, RouterProvider, createBrowserRouter, useLocation } from 'react-router-dom'
import { useAuth } from './auth-context'
import { trackPageView } from '../shared/yandex-metrika'
import { AppLayout } from './AppLayout'
import { AppViewportProvider } from './app-viewport'
import { isAssistantNavPilotEnabled, trainerHomePath } from './feature-flags'
import { AuthCallbackPage, AuthPage, ForgotPasswordPage, JoinPage, ResetPasswordPage, YandexAppSessionPage, YandexPilotCallbackPage } from '../features/auth'
import { ClientDetailPage, ClientFormPage, ClientProfilePage, ClientsPage, GoalPage, MyClientEditPage, MyClientPage, MyGoalPage, MyProgressPage, MyWorkoutsPage } from '../features/clients'
import { ExercisesPage } from '../features/exercises'
import { ProgressPage } from '../features/progress'
import { ProfilePage } from '../features/profile'
import { AssistantHistoryPage } from '../features/assistant'
import { ClientWorkoutsPage, ExerciseHistoryPage, LiveWorkoutPage, SchedulePage, TodayPage, WorkoutDetailPage, WorkoutFormPage } from '../features/workouts'
import { CanonicalClientParamRoute, CanonicalWorkoutClientRoute } from './canonical-client-route'

function Protected() {
  const { actor, loading, error } = useAuth(); const location = useLocation()
  const systemStateClass = 'state ui-identity system-state-identity'
  if (loading) return <main className={systemStateClass}>Восстанавливаем сессию…</main>
  if (!actor) return <Navigate to="/auth" state={{ from: `${location.pathname}${location.search}` }} replace />
  if (error) return <main className={`${systemStateClass} error`}>{error}</main>
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

function AssistantPilotOnly() {
  const { actor } = useAuth()
  return actor && isAssistantNavPilotEnabled(actor.userId, actor.email)
    ? <Outlet />
    : <Navigate to={actor?.role === 'client' ? '/me' : trainerHomePath()} replace />
}

function Home() {
  const { actor } = useAuth()
  return <Navigate to={actor?.role === 'client' ? '/me' : trainerHomePath()} replace />
}

function AssistantPage() {
  return <AssistantHistoryPage />
}

const router = createBrowserRouter([
  { path: '/auth', element: <AuthPage /> },
  { path: '/auth/forgot', element: <ForgotPasswordPage /> },
  { path: '/auth/reset', element: <ResetPasswordPage /> },
  { path: '/auth/callback', element: <AuthCallbackPage /> },
  { path: '/auth/yandex/callback', element: <YandexPilotCallbackPage /> },
  { path: '/auth/yandex/session', element: <YandexAppSessionPage /> },
  { element: <Protected />, children: [{ element: <AppLayout />, children: [
    { index: true, element: <Home /> },
    { path: '/join', element: <JoinPage /> },
    { element: <ClientOnly />, children: [
      { path: '/me', element: <MyClientPage /> },
      { path: '/me/edit', element: <MyClientEditPage /> },
      { path: '/me/workouts', element: <MyWorkoutsPage /> },
      { path: '/me/progress', element: <MyProgressPage /> },
      { path: '/me/goal', element: <MyGoalPage /> },
      { path: '/me/profile', element: <ClientProfilePage /> },
    ] },
    { element: <CanonicalWorkoutClientRoute />, children: [
      { path: '/workouts/new', element: <WorkoutFormPage /> },
    ] },
    { path: '/workouts/:workoutId/edit', element: <WorkoutFormPage /> },
    { path: '/workouts/:workoutId', element: <WorkoutDetailPage /> },
    { path: '/workouts/:workoutId/live', element: <LiveWorkoutPage /> },
    { path: '/workouts/:workoutId/history/:exerciseRef', element: <ExerciseHistoryPage /> },
    { element: <TrainerOnly />, children: [{ element: <AssistantPilotOnly />, children: [
      { path: '/assistant', element: <AssistantPage /> },
    ] }] },
    { element: <TrainerOnly />, children: [
      { path: '/today', element: <TodayPage /> },
      { path: '/clients', element: <ClientsPage /> },
      { path: '/clients/new', element: <ClientFormPage /> },
      { element: <CanonicalClientParamRoute />, children: [
        { path: '/clients/:clientId', element: <ClientDetailPage /> },
        { path: '/clients/:clientId/goal', element: <GoalPage /> },
        { path: '/clients/:clientId/edit', element: <ClientFormPage /> },
        { path: '/clients/:clientId/workouts', element: <ClientWorkoutsPage /> },
        { path: '/progress/:clientId', element: <ProgressPage /> },
      ] },
      { path: '/schedule', element: <SchedulePage /> },
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
  return <AppViewportProvider><RouterProvider router={router} /></AppViewportProvider>
}
