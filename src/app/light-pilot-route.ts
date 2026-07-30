// Светлый пилот (YAFIT-77). Чистое сопоставление маршрута экрана с пилотом —
// без флага и без тяжёлых импортов, чтобы юнит-тест не тянул Supabase-клиент.
// Этап 1 — 3 экрана (карточка клиента / live / прогресс); Этап 3 — раскатка по
// группам. Группа 1 (расписание + тренировки): /schedule, форма и детали
// тренировки, история тренировок клиента, цель клиента. Группа 2 (пикер +
// каталог): /exercises и карточка упражнения /workouts/:id/history/:ref.
export function isLightPilotPath(pathname: string): boolean {
  return (
    pathname === '/me' ||
    pathname === '/me/progress' ||
    pathname === '/me/workouts' ||
    pathname === '/schedule' ||
    pathname === '/exercises' ||
    /^\/clients\/[^/]+(\/(goal|workouts))?$/.test(pathname) ||
    /^\/progress\/[^/]+$/.test(pathname) ||
    /^\/workouts\/(new|[^/]+(\/edit|\/history\/[^/]+)?)$/.test(pathname) ||
    /\/live$/.test(pathname)
  )
}
