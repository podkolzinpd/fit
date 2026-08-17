export type RunningFormat =
  | 'free'
  | 'easy'
  | 'long'
  | 'tempo'
  | 'recovery'
  | 'interval-passive'
  | 'interval-active'
  | 'interval-custom'

export interface RunningFormatOption {
  format: RunningFormat
  title: string
  description: string
}

export const CONTINUOUS_RUNNING_FORMATS: readonly RunningFormatOption[] = [
  { format: 'free', title: 'Свободный бег', description: 'Время и дистанция без заданного типа' },
  { format: 'easy', title: 'Лёгкий бег', description: 'Спокойный равномерный темп' },
  { format: 'long', title: 'Длительный бег', description: 'Основной беговой объём тренировки' },
  { format: 'tempo', title: 'Темповый бег', description: 'Устойчивый быстрый отрезок' },
  { format: 'recovery', title: 'Восстановительный бег', description: 'Очень лёгкая пробежка' },
] as const

export const INTERVAL_RUNNING_FORMATS: readonly RunningFormatOption[] = [
  { format: 'interval-passive', title: '6 × 400 м', description: 'По 1:40, между отрезками отдых 90 секунд' },
  { format: 'interval-active', title: '6 × 400 м + лёгкий бег', description: 'По 1:40, восстановление бегом 90 секунд' },
  { format: 'interval-custom', title: 'Своя схема', description: 'Начать с одного отрезка и настроить вручную' },
] as const

export function runningFormatExerciseName(format: RunningFormat): string {
  if (format === 'free') return 'Свободный бег'
  if (format === 'easy') return 'Лёгкий бег'
  if (format === 'long') return 'Длительный бег'
  if (format === 'tempo') return 'Темповый бег'
  if (format === 'recovery') return 'Восстановительный бег'
  return 'Бег — интервалы'
}
