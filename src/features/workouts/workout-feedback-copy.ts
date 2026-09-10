export function workoutFeedbackConfirmation(hasActiveTrainer: boolean): string {
  return hasActiveTrainer
    ? '✓ Спасибо, тренер увидит ваш отзыв.'
    : '✓ Спасибо, данные о самочувствии сохранены.'
}
