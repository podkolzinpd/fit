// Светлый пилот (YAFIT-77). Чистое сопоставление маршрута экрана с пилотом —
// без флага и без тяжёлых импортов, чтобы юнит-тест не тянул Supabase-клиент.
// Этап 1 — 3 экрана (карточка клиента / live / прогресс); Этап 3 — раскатка по
// группам. Группа 1 (расписание + тренировки): /schedule, форма и детали
// тренировки, история тренировок клиента, цель клиента.
export function isLightPilotPath(pathname: string): boolean {
  return (
    pathname === '/me' ||
    pathname === '/me/progress' ||
    pathname === '/me/workouts' ||
    pathname === '/schedule' ||
    /^\/clients\/[^/]+(\/(goal|workouts))?$/.test(pathname) ||
    /^\/progress\/[^/]+$/.test(pathname) ||
    /^\/workouts\/(new|[^/]+(\/edit)?)$/.test(pathname) ||
    /\/live$/.test(pathname)
  )
}
