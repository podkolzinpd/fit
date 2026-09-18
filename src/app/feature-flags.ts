// Флаг позволяет включать новый стартовый путь постепенно и мгновенно
// возвращать прежнее поведение без изменения роутинга. По умолчанию новый
// экран включён; для отката в окружении сборки задаётся "false".
export function isTodayStartRedesignEnabled() {
  return import.meta.env.VITE_TODAY_START_REDESIGN !== 'false'
}

export function trainerHomePath() {
  return isTodayStartRedesignEnabled() ? '/today' : '/clients'
}

// Карточка поиска тренера открыта всем спортсменам. Явное значение "false"
// скрывает только карточку на главной; каталог в профиле остаётся доступен.
export function isTrainerDiscoveryHomeEnabled() {
  return import.meta.env.VITE_TRAINER_DISCOVERY_HOME_ENABLED !== 'false'
}

// Ассистент доступен обеим продуктовым ролям в production; серверные проверки
// роли и ownership остаются границами данных. VITE_ASSISTANT_NAV_ENABLED=false —
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

// Полноценная Yandex ID сессия открывается общим kill switch. Персональный
// доступ не дублируется в публичном frontend bundle: сервер выдаёт сессию
// только связанному профилю с активным read-write rollout assignment.
export function getYandexAppSessionEntryConfig(): YandexIdPilotConfig | null {
  if (import.meta.env.VITE_YANDEX_APP_SESSION_ENABLED !== 'true') return null
  return getYandexPublicConfig()
}

export function isYandexAppSessionEnabled(): boolean {
  return import.meta.env.VITE_YANDEX_APP_SESSION_ENABLED === 'true'
}

// Новая регистрация создаёт профиль только в Yandex PostgreSQL, поэтому она
// доступна лишь когда полноценная app-session и sticky routing включены вместе.
// Отдельный default-off switch позволяет доставить код до продуктового rollout.
export function getYandexNativeRegistrationConfig(): YandexIdPilotConfig | null {
  if (import.meta.env.VITE_YANDEX_NATIVE_REGISTRATION_ENABLED !== 'true') return null
  if (!isYandexAppSessionEnabled() || !isYandexMainRoutingEnabled()) return null
  return getYandexPublicConfig()
}

// Sticky routing основного Assistant — отдельный default-off rollout. Он не
// переиспользует allowlist входа: после включения выбранный профиль работает
// только с Yandex API и не откатывает отдельные запросы на Supabase.
export function isYandexAssistantRoutingPilotEnabled(userId: string): boolean {
  if (import.meta.env.VITE_YANDEX_ASSISTANT_ROUTING_ENABLED !== 'true') return false
  const pilotUserIds = String(
    import.meta.env.VITE_YANDEX_ASSISTANT_ROUTING_PILOT_USER_IDS ?? '',
  )
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
  return pilotUserIds.length === 1 && pilotUserIds[0] === userId
}

// Основной интерфейс выбирает один источник данных на всю Yandex ID сессию.
// Персональную границу задаёт серверный rollout assignment, а frontend хранит
// только общий kill switch. Ошибка Yandex API не переключает отдельный запрос
// обратно на Supabase.
export function isYandexMainRoutingEnabled(): boolean {
  return import.meta.env.VITE_YANDEX_MAIN_ROUTING_ENABLED === 'true'
}

export function getYandexMainRoutingConfig(): YandexIdPilotConfig | null {
  if (import.meta.env.VITE_YANDEX_MAIN_ROUTING_ENABLED !== 'true') return null
  return getYandexPublicConfig()
}

// Привязка существующего FIT-профиля к Yandex ID показывается всем
// авторизованным пользователям. Отдельный глобальный kill switch позволяет
// скрыть вход при массовой недоступности OAuth/API, но персонального allowlist
// здесь больше нет.
export function isYandexSessionLinkingEnabled(): boolean {
  return import.meta.env.VITE_YANDEX_SESSION_LINKING_ENABLED === 'true'
}

// Обязательная привязка — отдельный default-off gate поверх уже существующего
// linking flow. Она не включает Yandex app-session и не меняет data backend.
// Если gate включён без публичной linking-конфигурации, UI должен fail closed
// с явной ошибкой, а не молча пропустить пользователя в приложение.
export function isYandexAccountLinkRequired(): boolean {
  return import.meta.env.VITE_YANDEX_ACCOUNT_LINK_REQUIRED === 'true'
}

export function getYandexSessionLinkingConfig(): YandexIdPilotConfig | null {
  if (!isYandexSessionLinkingEnabled()) return null
  return getYandexPublicConfig()
}

// Available to both authenticated product roles; the server keeps trainer
// ownership and client self-only authorization separate from this UI switch.
export function isAssistantProgramEnabled(userId: string): boolean {
  return import.meta.env.VITE_ASSISTANT_PROGRAM_ENABLED === 'true' && userId.trim().length > 0
}
