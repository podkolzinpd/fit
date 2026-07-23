export function workoutCountLabel(count: number): string {
  const mod100 = count % 100
  const mod10 = count % 10
  const noun = mod100 >= 11 && mod100 <= 14
    ? 'тренировок'
    : mod10 === 1
      ? 'тренировка'
      : mod10 >= 2 && mod10 <= 4
        ? 'тренировки'
        : 'тренировок'
  return `${count} ${noun}`
}
