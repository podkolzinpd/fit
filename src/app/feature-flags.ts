// Флаг позволяет включать новый стартовый путь постепенно и мгновенно
// возвращать прежнее поведение без изменения роутинга. По умолчанию новый
// экран включён; для отката в окружении сборки задаётся "false".
export function isTodayStartRedesignEnabled() {
  return import.meta.env.VITE_TODAY_START_REDESIGN !== 'false'
}

export function trainerHomePath() {
  return isTodayStartRedesignEnabled() ? '/today' : '/clients'
}

// Верхняя навигация тренера «Ассистент» (возврат YAFIT-276 после отката
// YAFIT-279) открывается только участникам пилота. В production безопасный
// default — единственный тестовый e-mail; VITE_ASSISTANT_NAV_ENABLED=false
// остаётся мгновенным kill switch. Allowlist не является границей авторизации:
// данные защищаются существующими RLS/ownership-проверками.
export function isProductionAssistantPilotEmail(email?: string | null) {
  return email?.trim().toLowerCase() === 'test@test.com'
}

export function isAssistantNavPilotEnabled(userId: string, email?: string | null) {
  const enabledValue = String(import.meta.env.VITE_ASSISTANT_NAV_ENABLED ?? '').trim()
  const enabled = enabledValue === 'true' || (import.meta.env.PROD && enabledValue !== 'false')
  if (!enabled) return false
  // Production must never inherit an old UUID allowlist from Vercel. The
  // public pilot is deliberately one account wide until the next rollout.
  if (import.meta.env.PROD) return isProductionAssistantPilotEmail(email)
  const allowedUserIds = String(import.meta.env.VITE_ASSISTANT_NAV_PILOT_USER_IDS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
  const allowedEmails = String(import.meta.env.VITE_ASSISTANT_NAV_PILOT_EMAILS ?? '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
  return allowedUserIds.includes(userId) || (email ? allowedEmails.includes(email.toLowerCase()) : false)
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

export interface YandexIdPilotConfig {
  apiBaseUrl: string
  clientId: string
}

function isSafePilotApiUrl(value: string): boolean {
  try {
    const url = new URL(value)
    if (url.protocol === 'https:') return true
    return url.protocol === 'http:'
      && (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]')
  } catch {
    return false
  }
}

// Yandex ID пока открывает только изолированный read-only pilot. Одного флага
// недостаточно: кнопка появляется лишь при наличии публичного client ID и
// безопасного API URL. Client secret во frontend не используется.
export function getYandexIdPilotConfig(): YandexIdPilotConfig | null {
  if (import.meta.env.VITE_YANDEX_ID_PILOT_ENABLED !== 'true') return null
  const clientId = String(import.meta.env.VITE_YANDEX_OAUTH_CLIENT_ID ?? '').trim()
  const apiBaseUrl = String(import.meta.env.VITE_YANDEX_API_BASE_URL ?? '').trim().replace(/\/$/, '')
  if (clientId.length === 0 || clientId.length > 200 || !isSafePilotApiUrl(apiBaseUrl)) return null
  return { apiBaseUrl, clientId }
}
