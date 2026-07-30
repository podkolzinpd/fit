// Светлый пилот (YAFIT-77). Чистое сопоставление маршрута экрана с пилотом —
// без флага и без тяжёлых импортов, чтобы юнит-тест не тянул Supabase-клиент.
// Этап 1 — 3 экрана (карточка клиента / live / прогресс); Этап 3 — раскатка по
// группам. Группа 1: расписание и тренировки. Группа 2: пикер и каталог.
// Группа 3: оболочка, авторизация, клиенты, аналитика и профиль — после неё
// флаг включает светлую тему во всём приложении, но неизвестные URL не считаем
// покрытыми, чтобы тест явно фиксировал список поддержанных маршрутов.
export function isLightPilotPath(pathname: string): boolean {
  return (
    pathname === '/' ||
    pathname === '/auth' ||
    pathname === '/auth/forgot' ||
    pathname === '/auth/reset' ||
    pathname === '/auth/callback' ||
    pathname === '/join' ||
    pathname === '/clients' ||
    pathname === '/clients/new' ||
    pathname === '/analytics' ||
    pathname === '/profile' ||
    pathname === '/me' ||
    pathname === '/me/edit' ||
    pathname === '/me/progress' ||
    pathname === '/me/workouts' ||
    pathname === '/schedule' ||
    pathname === '/exercises' ||
    /^\/clients\/[^/]+(\/(goal|workouts|edit))?$/.test(pathname) ||
    /^\/progress\/[^/]+$/.test(pathname) ||
    /^\/workouts\/(new|[^/]+(\/edit|\/history\/[^/]+)?)$/.test(pathname) ||
    /\/live$/.test(pathname)
  )
}
