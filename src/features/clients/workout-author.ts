import { truncateFavoriteTitle } from '../../data/repositories/workout-rules'
import type { TrainerMembership, UUID, Workout } from '../../shared/domain'

export function clientWorkoutAuthorLabel(createdBy: UUID | null | undefined, origin: 'manual' | 'ai' | undefined, clientUserId: UUID | undefined, trainers: TrainerMembership[] | undefined) {
  if (!createdBy || createdBy === clientUserId) return origin === 'ai' ? 'Создана ИИ' : 'Создана вами'
  const trainer = trainers?.find((item) => item.trainerId === createdBy)
  const name = trainer ? [trainer.firstName, trainer.lastName].filter(Boolean).join(' ') : ''
  return name ? `Назначил ${name}` : 'Назначена тренером'
}

// Карточка тренировки (вариант C3): звёздочка + название избранного в той
// же строке, что и автор — а не отдельная пилюля-бейдж (единственный
// прецедент такого паттерна в приложении — «👑 Бренд-тренер», решили не
// множить его для карточек тренировок).
export function clientWorkoutCardLabel(workout: Workout, clientUserId: UUID | undefined, trainers: TrainerMembership[] | undefined): string {
  const author = clientWorkoutAuthorLabel(workout.createdBy, workout.origin, clientUserId, trainers)
  return workout.favoriteTitle ? `⭐ ${truncateFavoriteTitle(workout.favoriteTitle)} · ${author}` : author
}
