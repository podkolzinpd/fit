// Флаг позволяет включать новый стартовый путь постепенно и мгновенно
// возвращать прежнее поведение без изменения роутинга. По умолчанию новый
// экран включён; для отката в окружении сборки задаётся "false".
export function isTodayStartRedesignEnabled() {
  return import.meta.env.VITE_TODAY_START_REDESIGN !== 'false'
}

export function trainerHomePath() {
  return isTodayStartRedesignEnabled() ? '/today' : '/clients'
}

// HealthKit поставляется в общем iOS-бинарнике, но permission flow открываем
// только участникам пилота. Флаг намеренно default-off; allowlist не является
// границей авторизации и содержит только публичные UUID аккаунтов.
export function isWearablesPilotEnabled(userId: string) {
  if (import.meta.env.VITE_WEARABLES_ENABLED !== 'true') return false
  const allowedUserIds = String(import.meta.env.VITE_WEARABLES_PILOT_USER_IDS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
  return allowedUserIds.includes(userId)
}
