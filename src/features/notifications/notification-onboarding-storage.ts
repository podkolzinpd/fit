// Тот же паттерн, что installPromptDismissed в features/install/app-install.ts
// — чисто localStorage, без похода в БД. Отдельный модуль, а не общие
// экспорты с app-install.ts: предметная область другая (уведомления, не
// установка PWA), даже если паттерн хранения совпадает.
export function onboardingSeenStorageKey(userId: string) {
  return `fit.pushOnboardingSeen:v1:${userId}`
}

export function pushOnboardingSeen(userId: string): boolean {
  return localStorage.getItem(onboardingSeenStorageKey(userId)) === 'true'
}

export function markPushOnboardingSeen(userId: string) {
  localStorage.setItem(onboardingSeenStorageKey(userId), 'true')
}
