import type { TrainerMembership, UUID } from '../../shared/domain'

export function clientWorkoutAuthorLabel(createdBy: UUID | null | undefined, clientUserId: UUID | undefined, trainers: TrainerMembership[] | undefined) {
  if (!createdBy || createdBy === clientUserId) return 'Создана вами'
  const trainer = trainers?.find((item) => item.trainerId === createdBy)
  const name = trainer ? [trainer.firstName, trainer.lastName].filter(Boolean).join(' ') : ''
  return name ? `Назначил ${name}` : 'Назначена тренером'
}
