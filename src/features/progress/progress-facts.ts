import type { TrainingProgressFactChange } from '../../shared/domain'

const metricLabels: Record<TrainingProgressFactChange['metric'], string> = {
  max_weight: 'Рабочий вес',
  volume: 'Объём за тренировку',
  total_reps: 'Повторы за тренировку',
  distance: 'Дистанция за тренировку',
  duration: 'Время за тренировку',
  pace: 'Темп',
}

function number(value: number): string {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(value)
}

function pace(value: number): string {
  const seconds = Math.round(value * 60)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

function value(change: TrainingProgressFactChange, amount: number): string {
  if (change.metric === 'pace') return pace(amount)
  return number(amount)
}

function unit(change: TrainingProgressFactChange): string {
  if (change.metric === 'max_weight' || change.metric === 'volume') return ' кг'
  if (change.metric === 'total_reps') return ' повт.'
  if (change.metric === 'distance') return ' км'
  if (change.metric === 'duration') return ' мин'
  return '/км'
}

export function progressFactChangeLabel(change: TrainingProgressFactChange): string {
  const comparison = `${value(change, change.from)} → ${value(change, change.to)}${unit(change)}`
  if (change.metric === 'pace') {
    const direction = change.changePercent < 0 ? 'быстрее' : 'медленнее'
    return `${metricLabels[change.metric]}: ${comparison} · ${direction} на ${Math.abs(change.changePercent)}%`
  }
  const sign = change.changePercent > 0 ? '+' : '−'
  return `${metricLabels[change.metric]}: ${comparison} · ${sign}${Math.abs(change.changePercent)}%`
}

export function progressFactComparisonLabel(change: TrainingProgressFactChange): string {
  return `${metricLabels[change.metric]}: ${value(change, change.from)} → ${value(change, change.to)}${unit(change)}`
}
