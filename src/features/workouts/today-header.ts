import { isAssistantNavPilotEnabled } from '../../app/feature-flags'
import type { SessionActor } from '../../shared/domain'

// Шапка «Сегодня»/«Ассистент» (пилот YAFIT-317). У тренера из allowlist
// активный верхний таб заменяет заголовок (h1 остаётся для скринридеров),
// а вход в профиль переезжает в шестерёнку строки табов — аватар из шапки
// убирается. Вне пилота и для клиента шапка не меняется.
export function todayHeaderProps(clientMode: boolean, actor: SessionActor | null) {
  const assistantNav = !clientMode && actor !== null && isAssistantNavPilotEnabled(actor.userId)
  return {
    title: assistantNav ? 'Ассистент' : 'Сегодня',
    hideTitle: assistantNav,
    showProfileAvatar: !assistantNav,
  }
}
