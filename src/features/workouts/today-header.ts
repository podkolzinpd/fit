import type { SessionActor } from '../../shared/domain'

// Ассистент — дополнительный пункт существующего нижнего таб-бара. Шапка
// стартового экрана остаётся неизменной для всех ролей и вариантов пилота.
export function todayHeaderProps(clientMode: boolean, actor: SessionActor | null) {
  void clientMode
  void actor
  return {
    title: 'Сегодня',
    hideTitle: false,
    showProfileAvatar: true,
  }
}
