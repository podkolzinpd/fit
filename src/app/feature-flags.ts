// Флаг позволяет включать новый стартовый путь постепенно и мгновенно
// возвращать прежнее поведение без изменения роутинга. По умолчанию новый
// экран включён; для отката в окружении сборки задаётся "false".
export function isTodayStartRedesignEnabled() {
  return import.meta.env.VITE_TODAY_START_REDESIGN !== 'false'
}

export function trainerHomePath() {
  return isTodayStartRedesignEnabled() ? '/today' : '/clients'
}

// Ассистент доступен всем тренерам в production; TrainerOnly и RLS/ownership
// остаются границами роли и данных. VITE_ASSISTANT_NAV_ENABLED=false —
// мгновенный production kill switch. В development allowlist сохраняет
// изолированный локальный пилот.
export function isAssistantNavPilotEnabled(userId: string, email?: string | null) {
  const enabledValue = String(import.meta.env.VITE_ASSISTANT_NAV_ENABLED ?? '').trim()
  const enabled = enabledValue === 'true' || (import.meta.env.PROD && enabledValue !== 'false')
  if (!enabled) return false
  // Production must never inherit an old UUID/e-mail allowlist from Vercel.
  if (import.meta.env.PROD) return true
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

// Шапка «Сегодня»/«Кабинет» заменяет заголовок вкладки на персональное
// приветствие, чтобы освободить вертикальное место и поднять контент выше.
// Флаг намеренно default-off; allowlist не является границей авторизации и
// содержит только публичные UUID аккаунтов. Независимый rollout — не
// переиспользует allowlist других пилотов (Wearables, Assistant nav).
export function isTodayGreetingPilotEnabled(userId: string) {
  if (import.meta.env.VITE_TODAY_GREETING_ENABLED !== 'true') return false
  const allowedUserIds = String(import.meta.env.VITE_TODAY_GREETING_PILOT_USER_IDS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
  return allowedUserIds.includes(userId)
}

function isUserInPublicAllowlist(userId: string, value: unknown): boolean {
  const allowedUserIds = String(value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
  return allowedUserIds.includes(userId)
}

export interface YandexIdPilotConfig {
  apiBaseUrl: string
  clientId: string
}

function getYandexPublicConfig(): YandexIdPilotConfig | null {
  const clientId = String(import.meta.env.VITE_YANDEX_OAUTH_CLIENT_ID ?? '').trim()
  const apiBaseUrl = String(import.meta.env.VITE_YANDEX_API_BASE_URL ?? '').trim().replace(/\/$/, '')
  if (clientId.length === 0 || clientId.length > 200 || !isSafePilotApiUrl(apiBaseUrl)) return null
  return { apiBaseUrl, clientId }
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
  return getYandexPublicConfig()
}

// Полноценная Yandex ID сессия — отдельный default-off rollout. До завершения
// OAuth внутренний UUID профиля неизвестен, поэтому entry point защищён
// глобальным kill switch и серверным rollout assignment. Публичный UUID
// allowlist дополнительно проверяется сразу после обмена кода и при restore.
export function getYandexAppSessionEntryConfig(): YandexIdPilotConfig | null {
  if (import.meta.env.VITE_YANDEX_APP_SESSION_ENABLED !== 'true') return null
  return getYandexPublicConfig()
}

export function isYandexAppSessionPilotEnabled(userId: string): boolean {
  if (import.meta.env.VITE_YANDEX_APP_SESSION_ENABLED !== 'true') return false
  return isUserInPublicAllowlist(userId, import.meta.env.VITE_YANDEX_APP_SESSION_PILOT_USER_IDS)
}

// Привязка существующего FIT-профиля к Yandex ID — отдельный default-off
// rollout. Он намеренно не переиспользует read-only pilot и Apple Health
// allowlist: UUID видны во frontend bundle и служат только для показа UI.
export function isYandexSessionLinkingPilotEnabled(userId: string): boolean {
  if (import.meta.env.VITE_YANDEX_SESSION_LINKING_ENABLED !== 'true') return false
  return isUserInPublicAllowlist(userId, import.meta.env.VITE_YANDEX_SESSION_LINKING_PILOT_USER_IDS)
}

export function getYandexSessionLinkingConfig(userId: string): YandexIdPilotConfig | null {
  if (!isYandexSessionLinkingPilotEnabled(userId)) return null
  return getYandexIdPilotConfig()
}
