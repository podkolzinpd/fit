// Флаг позволяет включать новый стартовый путь постепенно и мгновенно
// возвращать прежнее поведение без изменения роутинга. По умолчанию новый
// экран включён; для отката в окружении сборки задаётся "false".
export function isTodayStartRedesignEnabled() {
  return import.meta.env.VITE_TODAY_START_REDESIGN !== 'false'
}

export function trainerHomePath() {
  return isTodayStartRedesignEnabled() ? '/today' : '/clients'
}
